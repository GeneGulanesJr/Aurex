# Frontend High-Priority Audit Fixes — Silent Failures & Broken UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 HIGH-priority findings from the frontend audit: checkpoint decisions that silently fail, a supply-chain scan reducer that drops completed scans, an unstyled MutationPanel (Tailwind not configured), a Dismiss button that lies to the user, and lost repo analysis on refresh.

**Architecture:** 7 tasks in 4 phases. Phases 1–2 are the critical path (checkpoint wiring — 3 tasks, because the fix spans the API layer, the WS layer, and the UI state machine). Phase 3 is the supply-chain reducer. Phase 4 is the three remaining standalone fixes. All tasks are frontend-only — the backend already sends `checkpoint_resolved` acks and proper HTTP errors, we just aren't listening.

**Tech Stack:** TypeScript, React 19, Vitest, anime.js v4, hand-written `styles.css` with CSS custom properties (no Tailwind). Pure-reducer / pure-function unit tests (no React rendering) following the pattern in `useMission.test.ts` / `useSupplyChain.test.ts`.

---

## Background — What the audit found

| # | Finding | File | Category |
|---|---------|------|----------|
| H1 | `submitCheckpoint` is the only API fn that doesn't check `res.ok` | `packages/frontend/src/api.ts:98-110` | Wired to nothing |
| H2 | Checkpoint decision is fire-and-forget over WS; no rollback on drop | `packages/frontend/src/App.tsx:118-137` | Optimistic UI, no sync |
| H3 | Supply-chain `SCAN_STARTED` doesn't add the scan row → `SCAN_COMPLETED` matches nothing → scan dropped | `packages/frontend/src/hooks/useSupplyChain.ts:36-61` | Optimistic UI, no sync |
| H4 | `MutationPanel` uses Tailwind classes but Tailwind isn't configured → renders unstyled | `packages/frontend/src/active/MutationPanel.tsx` | Wired to nothing |
| H5 | Escalation "Dismiss" clears UI without notifying backend → checkpoint stalls | `packages/frontend/src/active/EscalationOverlay.tsx:30-37` | Wired to nothing |
| H6 | `preparedRepo` (repo analysis) lives in `useState` only → lost on refresh | `packages/frontend/src/App.tsx:55-66` | State dies on refresh |

**Key backend fact (verified):** The WS handler in `packages/backend/src/ws/events.ts:209-235` already sends a `checkpoint_resolved` control message on every decision:
- Success: `{ type: "checkpoint_resolved", checkpointId, accepted: true, duplicate: boolean }`
- Failure: `{ type: "checkpoint_resolved", checkpointId, accepted: false, error: string, status?: number }`

And the REST route (`packages/backend/src/routes/checkpoints.ts:96-104`) returns proper HTTP statuses (`400`/`404` with `{ error }`). So H1 + H2 are purely a matter of the frontend listening for what the backend already says.

**Key constraint:** `checkpoint_resolved` is a WS *control* message (`parsed.type`), not a `WsClientEvent` (`parsed.event`). `useWebSocket` currently dispatches only `parsed.event` via `onEvent`; control messages like `auth_ok` / `replay_done` / `subscribed` are handled inline. We must add a parallel `onControl` channel without breaking existing callers.

---

## File Structure

**Files modified (no new files):**

| File | Responsibility | Touched by tasks |
|------|----------------|------------------|
| `packages/frontend/src/api.ts` | HTTP client — add `res.ok` check to `submitCheckpoint` | T1 |
| `packages/frontend/src/hooks/useWebSocket.ts` | WS layer — add `onControl` callback for non-event server messages | T2 |
| `packages/frontend/src/hooks/useMission.ts` | Mission state — track pending checkpoint decision + ack/error actions | T3 |
| `packages/frontend/src/App.tsx | Wire WS control → mission reducer; pending-state UI; fix `preparedRepo` persistence | T3, T7 |
| `packages/frontend/src/active/EscalationOverlay.tsx` | Remove the misleading Dismiss button (force a real decision) | T4 |
| `packages/frontend/src/hooks/useSupplyChain.ts` | Reducer — `SCAN_STARTED` adds the scan row; findings cap + clear | T5 |
| `packages/frontend/src/active/MutationPanel.tsx` | Rewrite Tailwind classes → inline styles + design tokens | T6 |

**Test files modified:**

| File | Touched by |
|------|------------|
| `packages/frontend/src/api.test.ts` | T1 |
| `packages/frontend/src/hooks/useWebSocket.test.ts` | T2 |
| `packages/frontend/src/hooks/useMission.test.ts` | T3 |
| `packages/frontend/src/hooks/useSupplyChain.test.ts` | T5 |

**No backend changes.** No new dependencies. The `tailwindcss` devDependency stays (it's harmless unused); we just rewrite the one component to match the rest of the app.

---

## Phase 1 — Checkpoint wiring: API + WS plumbing (H1, H2)

These three tasks are sequential — T2 depends on T1's error semantics, and T3 depends on T2's `onControl` channel. Do them in order.

### Task 1: Make `submitCheckpoint` check `res.ok` and surface server errors

**Why first:** Every other function in `api.ts` validates the response; this is the lone outlier. It's a 2-line fix that makes the REST fallback path honest, and it defines the `Error` shape that T3's catch block will display.

**Files:**
- Modify: `packages/frontend/src/api.ts:98-110`
- Test: `packages/frontend/src/api.test.ts`

- [ ] **Step 1: Read the current function and one passing test for a sibling function**

Read `packages/frontend/src/api.ts` lines 98–110 (the `submitCheckpoint` function) and skim `packages/frontend/src/api.test.ts` to find how a sibling like `abortMission` tests its `res.ok` / error path. The pattern to copy is "mock `fetch` to return `{ ok: false, status: 404, json: async () => ({ error: '...' }) }`, call the function, assert it rejects with the error message."

- [ ] **Step 2: Write the failing test**

Append to `packages/frontend/src/api.test.ts`:

```typescript
import { submitCheckpoint } from "./api";

describe("submitCheckpoint", () => {
  it("resolves on a successful response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 200 }),
    );
    const result = await submitCheckpoint("m1", "cp1", "approve");
    expect(result).toEqual({ accepted: true });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("throws with the server-provided error message when res not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "checkpoint not found" }), { status: 404 }),
    );
    await expect(submitCheckpoint("m1", "cp1", "approve")).rejects.toThrow("checkpoint not found");
  });

  it("falls back to a status-code message when body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    await expect(submitCheckpoint("m1", "cp1", "approve")).rejects.toThrow(/500/);
  });
});
```

If the file already imports `vi` and `describe`/`it`/`expect` at the top, reuse those imports; otherwise add them.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/api.test.ts -t "submitCheckpoint"`
Expected: FAIL — the "throws with server-provided error" and "falls back" cases fail because the current function resolves the body instead of throwing.

- [ ] **Step 4: Add the `res.ok` check**

Replace the body of `submitCheckpoint` in `packages/frontend/src/api.ts` (currently lines ~98–110). The current code is:

```typescript
export async function submitCheckpoint(
  missionId: string,
  checkpointId: string,
  decision: CheckpointDecision,
  opts?: { guidance?: string; reason?: string; rescopeGuidance?: string },
): Promise<CheckpointResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/checkpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, decision, ...opts }),
  });
  return res.json() as Promise<CheckpointResponse>;
}
```

Change only the tail (after `const res = ...`) to mirror `abortMission`'s error handling:

```typescript
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Failed to submit checkpoint: ${res.status}`);
  }
  return res.json() as Promise<CheckpointResponse>;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run src/api.test.ts`
Expected: PASS — all three new cases pass, and the rest of `api.test.ts` still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/api.test.ts
git commit -m "fix(frontend): submitCheckpoint now checks res.ok and surfaces server errors

Was the only API function that returned res.json() unconditionally, hiding
4xx/5xx responses as resolved promises. Aligns with abortMission et al."
```

---

### Task 2: Plumb a `onControl` callback through `useWebSocket` for server control messages

**Why:** The backend sends `checkpoint_resolved` acks (and already sends `auth_ok`/`replay_done`/`subscribed`) as top-level `{ type: ... }` messages, distinct from `{ event: ... }`. `useWebSocket` currently handles `auth_ok` inline and silently drops every other control message. We need a channel so the mission reducer (T3) can react to `checkpoint_resolved` without polluting the `WsClientEvent` stream that every other hook consumes.

**Design:** Add an optional `onControl?: (msg: WsControlMessage) => void` to `UseWebSocketOptions`. Define `WsControlMessage` as a discriminated union covering the messages the server actually sends. In `onmessage`, after the existing `auth_ok` branch, dispatch all other `parsed.type` messages through `onControl` (via a ref, same pattern as `onEventRef`). Leave `parsed.event` dispatch untouched.

**Files:**
- Modify: `packages/frontend/src/hooks/useWebSocket.ts`
- Test: `packages/frontend/src/hooks/useWebSocket.test.ts`

- [ ] **Step 1: Write a failing unit test for the control-message parser**

The existing tests only cover pure functions (`buildWsUrl`, `parseWsMessage`, `buildPostAuthMessages`). Add a pure helper `classifyMessage` that we can test without a real WebSocket, then have `onmessage` call it. Append to `packages/frontend/src/hooks/useWebSocket.test.ts`:

```typescript
import { classifyMessage, type ClassifiedMessage } from "./useWebSocket";

describe("classifyMessage", () => {
  it("classifies a WsClientEvent payload", () => {
    const raw = JSON.stringify({ seq: 3, event: { type: "cost_update", missionId: "m1", totalCost: 1, totalTokens: 100 } });
    const m = classifyMessage(raw);
    expect(m?.kind).toBe("event");
    expect(m?.seq).toBe(3);
  });

  it("classifies auth_ok as control", () => {
    const m = classifyMessage(JSON.stringify({ type: "auth_ok" }));
    expect(m?.kind).toBe("control");
    expect(m?.control?.type).toBe("auth_ok");
  });

  it("classifies checkpoint_resolved as control", () => {
    const raw = JSON.stringify({ type: "checkpoint_resolved", checkpointId: "cp1", accepted: true, duplicate: false });
    const m = classifyMessage(raw);
    expect(m?.kind).toBe("control");
    expect(m?.control?.type).toBe("checkpoint_resolved");
  });

  it("classifies checkpoint_resolved failure with error/status", () => {
    const raw = JSON.stringify({ type: "checkpoint_resolved", checkpointId: "cp1", accepted: false, error: "not found", status: 404 });
    const m = classifyMessage(raw);
    expect(m?.kind).toBe("control");
    expect(m?.control).toMatchObject({ type: "checkpoint_resolved", accepted: false, error: "not found", status: 404 });
  });

  it("returns null for malformed JSON", () => {
    expect(classifyMessage("not json")).toBeNull();
  });

  it("returns unknown for neither event nor recognized control type", () => {
    const m = classifyMessage(JSON.stringify({ type: "future_message" }));
    expect(m?.kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useWebSocket.test.ts -t "classifyMessage"`
Expected: FAIL — `classifyMessage` is not exported.

- [ ] **Step 3: Implement `classifyMessage` and the `WsControlMessage` type**

In `packages/frontend/src/hooks/useWebSocket.ts`, add the types and the pure classifier near the top (after the existing imports / `parseWsMessage`):

```typescript
/** Control messages the backend sends as top-level { type: ... } (not { event: ... }). */
export type WsControlMessage =
  | { type: "auth_ok" }
  | { type: "hello"; seq: number }
  | { type: "subscribed"; missionId: string }
  | { type: "replay_done"; count: number }
  | {
      type: "checkpoint_resolved";
      checkpointId: string;
      accepted: boolean;
      duplicate?: boolean;
      error?: string;
      status?: number;
    };

const CONTROL_TYPES = new Set<string>([
  "auth_ok",
  "hello",
  "subscribed",
  "replay_done",
  "checkpoint_resolved",
]);

export type ClassifiedMessage =
  | { kind: "event"; event: WsClientEvent; seq?: number }
  | { kind: "control"; control: WsControlMessage; seq?: number }
  | { kind: "unknown"; raw: unknown; seq?: number };

/** Pure classifier for a single WS message string. Exported for unit testing. */
export function classifyMessage(data: string): ClassifiedMessage | null {
  const parsed = parseWsMessage(data);
  if (!parsed) return null;
  const seq = parsed.seq;
  if (parsed.event) {
    return { kind: "event", event: parsed.event, seq };
  }
  if (parsed.type && CONTROL_TYPES.has(parsed.type)) {
    return { kind: "control", control: parsed as unknown as WsControlMessage, seq };
  }
  return { kind: "unknown", raw: parsed, seq };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useWebSocket.test.ts -t "classifyMessage"`
Expected: PASS.

- [ ] **Step 5: Add `onControl` to the hook options and wire it into `onmessage`**

In the same file:

1. Extend the options interface:

```typescript
export interface UseWebSocketOptions {
  missionId?: string | null;
  getToken?: () => Promise<string>;
  enabled?: boolean;
  /** Receives non-event control messages (auth_ok, checkpoint_resolved, etc.). */
  onControl?: (msg: WsControlMessage) => void;
}
```

2. Add a ref next to `onEventRef`:

```typescript
const onControlRef = useRef(opts?.onControl);
onControlRef.current = opts?.onControl;
```

3. Refactor `ws.onmessage` to use `classifyMessage`. The existing handler has special cases for `parsed.seq` tracking, `auth_ok`, and the `agent_output` batching. Replace the body of `ws.onmessage = (msg) => { ... }` with:

```typescript
      ws.onmessage = (msg) => {
        const classified = classifyMessage(msg.data);
        if (!classified) return;

        // Track sequence for replay (applies to both events and control messages).
        if (typeof classified.seq === "number") {
          localStorage.setItem(LAST_SEQ_KEY, String(classified.seq));
        }

        if (classified.kind === "control") {
          const c = classified.control;
          if (c.type === "auth_ok") {
            sendPostAuthMessages(ws);
            setConnected(true);
          }
          // Always forward control messages (including auth_ok, in case the
          // consumer wants to react) — but auth_ok still drives connection
          // state above so consumers don't need to handle it.
          onControlRef.current?.(c);
          return;
        }

        if (classified.kind === "event") {
          const eventType = (classified.event as any).type;
          if (eventType === "agent_output") {
            batchQueue.push(classified.event);
            if (!batchTimer) {
              batchTimer = setTimeout(flushBatch, 0);
            }
          } else {
            if (batchTimer) {
              clearTimeout(batchTimer);
              flushBatch();
            }
            onEventRef.current(classified.event);
          }
        }
        // unknown messages are ignored (forward compatibility).
      };
```

Note: `sendPostAuthMessages` and the batching closures are already defined in the `connect()` scope; they're unchanged. The previous separate `if (parsed.type === "auth_ok")` block is now inside the `control` branch.

- [ ] **Step 6: Run the full useWebSocket test suite**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useWebSocket.test.ts`
Expected: PASS — the new `classifyMessage` tests pass and the existing `buildWsUrl`/`parseWsMessage`/`buildPostAuthMessages` tests still pass (they don't touch the hook internals).

- [ ] **Step 7: Verify the app still connects (typecheck)**

Run: `cd packages/frontend && pnpm typecheck`
Expected: PASS — no type errors. (`onControl` is optional, so existing callers in `App.tsx` still type-check.)

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/hooks/useWebSocket.ts packages/frontend/src/hooks/useWebSocket.test.ts
git commit -m "feat(frontend): useWebSocket forwards control messages via onControl

Backend already sends checkpoint_resolved acks and auth_ok/subscribed/
replay_done as top-level { type } messages. Previously only auth_ok was
handled and every other control message was silently dropped. Adds a pure
classifyMessage helper (unit-tested) and an optional onControl callback."
```

---

### Task 3: Track pending checkpoint decision and reconcile with `checkpoint_resolved` ack

**Why:** This is the core of H2. Today, `App.handleDecision` sends the WS message and immediately clears the escalation. If the message is dropped or the server rejects it, the user sees success while the mission stalls. We will: (a) keep the escalation visible with a "Submitting…" state, (b) clear it only on a successful ack, (c) restore it + show an error on a failure ack or timeout, (d) fall back to REST (which now throws properly, thanks to T1) if no ack arrives within 8s.

**Files:**
- Modify: `packages/frontend/src/hooks/useMission.ts` (reducer actions + pending state)
- Modify: `packages/frontend/src/App.tsx` (wire `onControl`, rewrite `handleDecision`)
- Test: `packages/frontend/src/hooks/useMission.test.ts`

- [ ] **Step 1: Write failing reducer tests for the pending/ack/error lifecycle**

Append to `packages/frontend/src/hooks/useMission.test.ts`. These follow the file's existing pure-reducer test pattern (seed state + dispatch + assert). Add the seed escalation first if not already present:

```typescript
const escalationEvent = {
  type: "escalation",
  missionId: "m1",
  checkpointId: "cp1",
  trigger: { kind: "milestone_complete" },
} as any;

const escalatedState = {
  ...seedState,
  escalation: escalationEvent,
};

describe("missionReducer — checkpoint submission lifecycle", () => {
  it("CHECKPOINT_SUBMITTING marks the escalation as submitting without clearing it", () => {
    const state = missionReducer(escalatedState as any, { type: "CLEAR_ESCALATION" }); // baseline: cleared
    expect(state.escalation).toBeNull();
    // Now from escalatedState, mark submitting:
    const s = missionReducer(escalatedState as any, { type: "CLEAR_ESCALATION_PENDING_ONLY" });
    // CLEAR_ESCALATION is the wrong action here; see below — use the real ones.
    expect(true).toBe(false); // placeholder removed in step 2
  });
});
```

Actually — replace that placeholder test body entirely. The real tests:

```typescript
describe("missionReducer — checkpoint submission lifecycle", () => {
  it("CHECKPOINT_SUBMITTING records pending decision and marks submitting, keeps escalation visible", () => {
    const s = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve",
    });
    expect(s.escalation).not.toBeNull(); // still visible
    expect(s.pendingCheckpoint?.decision).toBe("approve");
    expect(s.pendingCheckpoint?.status).toBe("submitting");
  });

  it("CHECKPOINT_ACKED clears escalation and pending on accepted ack", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve",
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "cp1",
      accepted: true,
    });
    expect(s.escalation).toBeNull();
    expect(s.pendingCheckpoint).toBeNull();
  });

  it("CHECKPOINT_ACKED restores escalation with error on rejected ack", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve",
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "cp1",
      accepted: false,
      error: "checkpoint not found",
    });
    expect(s.escalation).not.toBeNull(); // restored so the user can retry
    expect(s.pendingCheckpoint).toBeNull();
    expect(s.pendingCheckpointError).toBe("checkpoint not found");
  });

  it("CHECKPOINT_ACKED for a different checkpointId is ignored", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve",
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "other-cp",
      accepted: true,
    });
    expect(s.pendingCheckpoint?.status).toBe("submitting"); // unchanged
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useMission.test.ts -t "checkpoint submission lifecycle"`
Expected: FAIL — the new action types don't exist yet.

- [ ] **Step 3: Add the pending-checkpoint state fields and reducer cases**

In `packages/frontend/src/hooks/useMission.ts`:

1. Extend `MissionState` with two fields:

```typescript
export interface PendingCheckpoint {
  checkpointId: string;
  decision: CheckpointDecision;
  status: "submitting";
  submittedAt: number;
}

export interface MissionState {
  mission: Mission | null;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary | null;
  escalation: WsClientEvent | null;
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
  /** Set while a checkpoint decision is in flight; cleared on ack/timeout/error. */
  pendingCheckpoint: PendingCheckpoint | null;
  /** Human-readable error from the last failed checkpoint submission. */
  pendingCheckpointError: string | null;
}
```

2. Update `initialMissionState` to include the two new `null` fields:

```typescript
export const initialMissionState: MissionState = {
  mission: null, milestones: [], activeWorkers: [], cost: null, escalation: null,
  logs: [], errors: [], agentLogs: {},
  pendingCheckpoint: null,
  pendingCheckpointError: null,
};
```

3. Add these cases to the `Action` union:

```typescript
  | { type: "CHECKPOINT_SUBMITTING"; decision: CheckpointDecision }
  | { type: "CHECKPOINT_ACKED"; checkpointId: string; accepted: boolean; error?: string }
  | { type: "CLEAR_PENDING_CHECKPOINT_ERROR" }
```

4. Handle them in `missionReducer` (before the `default:`):

```typescript
    case "CHECKPOINT_SUBMITTING": {
      if (!state.escalation) return state;
      const checkpointId = (state.escalation as any).checkpointId;
      if (!checkpointId) return state;
      return {
        ...state,
        pendingCheckpointError: null,
        pendingCheckpoint: {
          checkpointId,
          decision: action.decision,
          status: "submitting",
          submittedAt: Date.now(),
        },
      };
    }
    case "CHECKPOINT_ACKED": {
      // Ignore acks that don't match the in-flight checkpoint.
      if (!state.pendingCheckpoint || state.pendingCheckpoint.checkpointId !== action.checkpointId) {
        return state;
      }
      if (action.accepted) {
        return { ...state, escalation: null, pendingCheckpoint: null, pendingCheckpointError: null };
      }
      // Rejected: keep the escalation so the user can retry, surface the error.
      return {
        ...state,
        pendingCheckpoint: null,
        pendingCheckpointError: action.error ?? "Checkpoint submission was rejected",
      };
    }
    case "CLEAR_PENDING_CHECKPOINT_ERROR":
      return { ...state, pendingCheckpointError: null };
```

5. The existing `CLEAR_ESCALATION` case stays unchanged (still used by the Dismiss removal in T4 and as a hard manual reset).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useMission.test.ts`
Expected: PASS — new lifecycle tests pass; existing reducer tests still pass.

- [ ] **Step 5: Rewrite `handleDecision` in `App.tsx` to use the pending lifecycle + REST fallback + timeout**

In `packages/frontend/src/App.tsx`, find `handleDecision` (currently ~lines 118–137). Replace it entirely with:

```typescript
  const CHECKPOINT_ACK_TIMEOUT_MS = 8_000;

  const handleDecision = useCallback(async (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => {
    if (!state.mission) return;
    const escalation = state.escalation;
    if (escalation?.type !== "escalation" || !escalation.checkpointId) return;
    // Idempotency guard: don't double-submit while one is already in flight.
    if (state.pendingCheckpoint) return;

    const checkpointId = escalation.checkpointId;
    const missionId = state.mission.id;

    // Mark submitting — keeps the overlay visible with a "Submitting…" state.
    dispatch({ type: "CHECKPOINT_SUBMITTING", decision });

    if (connected) {
      // Send over WS. The onControl handler (wired below) will reconcile the
      // state on `checkpoint_resolved`. We also arm a timeout: if no ack
      // arrives within the window, fall back to REST so a dropped decision
      // never silently stalls the mission.
      send({
        event: "checkpoint_decision",
        missionId,
        checkpointId,
        decision,
        guidance: opts?.guidance,
        reason: opts?.reason,
        rescopeGuidance: opts?.rescopeGuidance,
      });
      setTimeout(() => {
        // If still pending after the timeout, the ack didn't arrive — try REST.
        // (The reducer ignores the REST result if an ack already landed.)
        // We can't read fresh state here; the timeout calls a ref we set below.
        restFallbackRef.current?.(checkpointId, decision, opts);
      }, CHECKPOINT_ACK_TIMEOUT_MS);
    } else {
      // Socket down: go straight to REST (which now throws properly — T1).
      try {
        await submitCheckpoint(missionId, checkpointId, decision, opts);
        dispatch({ type: "CHECKPOINT_ACKED", checkpointId, accepted: true });
      } catch (err) {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId,
          accepted: false,
          error: err instanceof Error ? err.message : "Failed to submit checkpoint",
        });
      }
    }
  }, [state.mission, state.escalation, state.pendingCheckpoint, dispatch, connected, send]);
```

Then add the REST-fallback ref (place near the other refs at the top of `App`, e.g. after `updateWsHandlerRef`):

```typescript
  const restFallbackRef = useRef<((checkpointId: string, decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => Promise<void>) | null>(null);
  useEffect(() => {
    restFallbackRef.current = async (checkpointId, decision, opts) => {
      // Double-check via a custom event is unnecessary; the reducer's ack
      // matching is idempotent on checkpointId. If the ack landed, this
      // dispatch is a no-op (pendingCheckpoint already cleared).
      try {
        await submitCheckpoint(state.mission!.id, checkpointId, decision, opts);
        dispatch({ type: "CHECKPOINT_ACKED", checkpointId, accepted: true });
      } catch (err) {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId,
          accepted: false,
          error: err instanceof Error ? err.message : "Failed to submit checkpoint",
        });
      }
    };
  }, [state.mission, dispatch]);
```

Note: `submitCheckpoint` is already imported at the top of `App.tsx` (line 22 in the current file). Verify the import is present; if not, add `submitCheckpoint` to the existing `from "./api"` import.

- [ ] **Step 6: Wire `onControl` to dispatch `CHECKPOINT_ACKED`**

In `App.tsx`, update the `useWebSocket` call (currently ~lines 122–127) to pass an `onControl` handler:

```typescript
  const { connected, send } = useWebSocket(combinedHandler, {
    missionId: missionsState.selectedMissionId,
    getToken,
    enabled: isAuthenticated,
    onControl: useCallback((msg: WsControlMessage) => {
      if (msg.type === "checkpoint_resolved") {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId: msg.checkpointId,
          accepted: msg.accepted,
          error: msg.error,
        });
      }
    }, [dispatch]),
  });
```

Add `WsControlMessage` to the type import from `./hooks/useWebSocket`:

```typescript
import { useWebSocket, type WsControlMessage } from "./hooks/useWebSocket";
```

- [ ] **Step 7: Show pending + error state in the escalation UI**

In `packages/frontend/src/active/EscalationOverlay.tsx`, accept and render the pending/error state. Update the props and the component:

```typescript
interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => void;
  submitting?: boolean;
  submitError?: string | null;
  onDismissSubmitError?: () => void;
}
```

In the component body, render a status strip above `DecisionActions`:

```typescript
  {submitError && (
    <div style={{ marginTop: "12px", padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--error)", borderRadius: "4px", color: "var(--error)", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <span>Decision failed: {submitError}</span>
      <button onClick={onDismissSubmitError} style={{ background: "transparent", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "14px" }}>×</button>
    </div>
  )}
  {submitting && (
    <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', letterSpacing: "1px" }}>
      SUBMITTING DECISION…
    </div>
  )}
```

Wire the new props in `App.tsx` where `<EscalationOverlay>` is rendered:

```typescript
      {state.escalation?.type === "escalation" && (
        <EscalationOverlay
          event={state.escalation}
          onDecision={handleDecision}
          submitting={!!state.pendingCheckpoint}
          submitError={state.pendingCheckpointError}
          onDismissSubmitError={() => dispatch({ type: "CLEAR_PENDING_CHECKPOINT_ERROR" })}
        />
      )}
```

(T4 will remove the existing `onDismiss` / Dismiss button.)

- [ ] **Step 8: Run typecheck + the mission reducer tests**

Run: `cd packages/frontend && pnpm typecheck && pnpm vitest run src/hooks/useMission.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/hooks/useMission.ts packages/frontend/src/hooks/useMission.test.ts packages/frontend/src/App.tsx packages/frontend/src/active/EscalationOverlay.tsx
git commit -m "fix(frontend): checkpoint decisions now reconcile with backend ack

Previously handleDecision sent the WS message and immediately cleared the
escalation — a dropped or rejected decision looked like success while the
mission stalled. Now: mark submitting → keep overlay visible → clear only on
checkpoint_resolved ack → restore with error on rejection → fall back to REST
after 8s if no ack arrives. The REST path now throws properly (T1)."
```

---

## Phase 2 — Supply-chain scan reducer (H3)

Standalone. No dependency on Phase 1.

### Task 4: Fix `SCAN_STARTED` to add the scan row, and harden findings accumulation

**Why:** `SCAN_STARTED` sets `isScanning: true` but never adds a scan object to `state.scans`. Then `SCAN_COMPLETED` does `scans.map(...)` looking for `s.id === scanId` — which matches nothing, so the completed scan (with its summary) is silently dropped. Worse, `isScanning` is recomputed from `scans.some(s => s.status === "running")`, which is always false (no scan was added), so the loading flag flickers off instantly. Live scans only ever appear after switching missions (which triggers `SET_SCANS` rehydration).

**Files:**
- Modify: `packages/frontend/src/hooks/useSupplyChain.ts:36-61`
- Test: `packages/frontend/src/hooks/useSupplyChain.test.ts`

- [ ] **Step 1: Update the existing `SCAN_STARTED` test to assert the scan is added, and add a regression test for the drop**

In `packages/frontend/src/hooks/useSupplyChain.test.ts`, find the existing `SCAN_STARTED` test and extend it, then add a full-lifecycle test:

```typescript
  it("handles SCAN_STARTED — sets isScanning true AND adds a running scan row", () => {
    const state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    expect(state.isScanning).toBe(true);
    expect(state.error).toBeNull();
    expect(state.scans).toHaveLength(1);
    expect(state.scans[0]).toMatchObject({ id: "s1", status: "running", profile: "project" });
  });

  it("does not duplicate a scan row if SCAN_STARTED fires twice for the same id", () => {
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    expect(state.scans.filter((s) => s.id === "s1")).toHaveLength(1);
  });

  it("completes a full live scan lifecycle without dropping it", () => {
    const summary = { totalPackages: 1, totalFindings: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: ["npm"] };
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s1", summary });
    expect(state.scans.find((s) => s.id === "s1")?.status).toBe("completed");
    expect(state.scans.find((s) => s.id === "s1")?.summary).toEqual(summary);
    expect(state.isScanning).toBe(false); // no remaining running scans
    expect(state.latestSummary).toEqual(summary);
  });

  it("keeps isScanning true while at least one scan is still running", () => {
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s2", profile: "deep" });
    expect(state.scans).toHaveLength(2);
    const summary = { totalPackages: 1, totalFindings: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: [] };
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s1", summary });
    expect(state.isScanning).toBe(true); // s2 still running
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s2", summary });
    expect(state.isScanning).toBe(false);
  });

  it("caps accumulated findings at 200 and clears them when a new scan starts", () => {
    const makeFinding = (i: number) => ({
      id: `f${i}`, scanId: "s1", missionId: "m1", findingType: "package_exposure",
      severity: "low" as const, catalogId: "c", catalogName: "n", ecosystem: "npm",
      packageName: "p", normalizedName: "p", version: "1", sourceType: "lockfile",
      sourceFile: "/f", confidence: "high" as const, evidence: "e",
    });
    let state = { ...initialSupplyChainState, isScanning: true, scans: [{ id: "s1", status: "running" }] } as any;
    for (let i = 0; i < 250; i++) {
      state = supplyChainReducer(state, { type: "SCAN_FINDING", finding: makeFinding(i) });
    }
    expect(state.findings).toHaveLength(200);
    // Starting a new scan clears stale findings so re-scans don't double-count.
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s2", profile: "baseline" });
    expect(state.findings).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useSupplyChain.test.ts`
Expected: FAIL — the "adds a running scan row", "full live scan lifecycle", "keeps isScanning true", and "caps accumulated findings" cases fail.

- [ ] **Step 3: Fix the `SCAN_STARTED`, `SCAN_COMPLETED`, and `SCAN_FINDING` reducer cases**

In `packages/frontend/src/hooks/useSupplyChain.ts`, replace the three cases:

```typescript
    case "SCAN_STARTED": {
      const scanId = action.scanId;
      // Add the scan row if it doesn't already exist (idempotent on scanId).
      const exists = state.scans.some((s) => s.id === scanId);
      const scans = exists
        ? state.scans.map((s) => (s.id === scanId ? { ...s, status: "running" as const, profile: action.profile } : s))
        : [
            ...state.scans,
            { id: scanId, missionId: "", profile: action.profile, status: "running" as const, startedAt: new Date().toISOString() },
          ];
      return {
        ...state,
        scans,
        isScanning: true,
        error: null,
        findings: [], // clear stale findings so re-scans don't accumulate
      };
    }
    case "SCAN_COMPLETED": {
      const updatedScans = state.scans.map((s) =>
        s.id === action.scanId
          ? { ...s, status: "completed" as const, summary: action.summary, completedAt: new Date().toISOString() }
          : s,
      );
      return {
        ...state,
        isScanning: updatedScans.some((s) => s.status === "running"),
        latestSummary: action.summary,
        scans: updatedScans,
      };
    }
    case "SCAN_FINDING":
      return { ...state, findings: [...state.findings.slice(-199), action.finding] };
```

Leave `SET_SCANS`, `SET_ERROR`, `RESET` unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/frontend && pnpm vitest run src/hooks/useSupplyChain.test.ts`
Expected: PASS — all new tests pass; the pre-existing `SCAN_COMPLETED` / `SCAN_FINDING` tests still pass (they seed scans manually, which still works).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useSupplyChain.ts packages/frontend/src/hooks/useSupplyChain.test.ts
git commit -m "fix(frontend): supply-chain scans no longer dropped mid-session

SCAN_STARTED only set isScanning but never added a scan row, so SCAN_COMPLETED's
scans.map(...) matched nothing and the completed scan (with its summary) was
silently discarded — live scans were invisible until you switched missions.
Now SCAN_STARTED inserts the running scan row, and findings are capped + cleared
on new scans to prevent unbounded growth and double-counting."
```

---

## Phase 3 — Escalation Dismiss honesty (H5)

**Why:** The Dismiss button calls `onDismiss` → `dispatch CLEAR_ESCALATION`, which removes the event from local state but leaves the checkpoint pending server-side. The orchestrator keeps waiting for a decision that never arrives; the mission stalls and the user has no idea. There is no backend "defer" concept, so the honest fix is to remove the Dismiss button and force a real decision.

**Depends on:** T3 (so the overlay has a clear `submitting` / `submitError` state and the only remaining way out is a real decision).

### Task 5: Remove the misleading Dismiss button from `EscalationOverlay`

**Files:**
- Modify: `packages/frontend/src/active/EscalationOverlay.tsx`

- [ ] **Step 1: Read the current component**

Read `packages/frontend/src/active/EscalationOverlay.tsx` (47 lines). Note the `handleDismiss` function (lines 22–29) and the Dismiss `<button>` (lines 41–47), plus the `onDismiss` prop.

- [ ] **Step 2: Remove `onDismiss`, `handleDismiss`, and the Dismiss button; keep Esc-to-close-help but not Esc-to-dismiss-checkpoint**

Replace the entire file content with:

```typescript
import { useRef, useEffect } from "react";
import { CheckpointPanel } from "./CheckpointPanel";
import { DecisionActions } from "./DecisionActions";
import { enterActive } from "../animations/state-transitions";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => void;
  submitting?: boolean;
  submitError?: string | null;
  onDismissSubmitError?: () => void;
}

/**
 * Modal escalation overlay. Deliberately has NO dismiss button: the checkpoint
 * is pending server-side and the orchestrator is blocked until a real decision
 * arrives. "Dismissing" it in the UI would silently stall the mission. The user
 * must choose Approve / Reject / Rescope / Abort (handled by DecisionActions).
 */
export function EscalationOverlay({ event, onDecision, submitting, submitError, onDismissSubmitError }: EscalationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    enterActive(el);
  }, []);

  if (event.type !== "escalation") return null;

  return (
    <div ref={overlayRef} style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--bg-inset) 85%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "6px", padding: "32px", maxWidth: "672px", width: "100%", margin: "0 16px", boxShadow: "0 25px 50px -12px var(--accent-glow)", border: "1px solid var(--border)" }}>
        <CheckpointPanel trigger={event.trigger} />
        {submitError && (
          <div style={{ marginTop: "12px", padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--error)", borderRadius: "4px", color: "var(--error)", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <span>Decision failed: {submitError}</span>
            <button onClick={onDismissSubmitError} style={{ background: "transparent", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "14px" }}>×</button>
          </div>
        )}
        {submitting && (
          <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', letterSpacing: "1px" }}>
            SUBMITTING DECISION…
          </div>
        )}
        <DecisionActions onDecision={onDecision} trigger={event.trigger} />
      </div>
    </div>
  );
}
```

Note: `exitActive` is no longer imported (it was only used by `handleDismiss`). The `enterActive` entrance animation is preserved.

- [ ] **Step 3: Remove the now-unused `CLEAR_ESCALATION` wiring in App.tsx for the overlay**

In `packages/frontend/src/App.tsx`, find the `<EscalationOverlay>` JSX (rendered near the end of the component). The `onDismiss` prop was removed in T3 Step 7's rewrite — but double-check there is no leftover `onDismiss={() => dispatch({ type: "CLEAR_ESCALATION" })}` line. If present, remove it. The block should match T3 Step 7 exactly.

Also remove the `onDismiss` handler from the `useKeyboardShortcuts` config in `App.tsx` (the `onDismiss: () => { if (state.escalation?.type === "escalation") { dispatch({ type: "CLEAR_ESCALATION" }); } }` callback). The Escape key should still close the *help* overlay (handled inside `useKeyboardShortcuts`), but it must NOT silently dismiss a checkpoint escalation. Replace that callback's body with a no-op or remove the `onDismiss` key entirely:

```typescript
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts({
    onSelectMissionByIndex: (i) => {
      const mission = missionsState.missions[i];
      if (mission) selectMission(mission.missionId);
    },
    onApprove: () => {
      if (state.escalation?.type === "escalation" && state.escalation.checkpointId) {
        handleDecision("approve");
      }
    },
    onReject: () => {
      if (state.escalation?.type === "escalation" && state.escalation.checkpointId) {
        handleDecision("reject");
      }
    },
    // No onDismiss: Esc must not silently clear a pending checkpoint.
    onNewMission: () => {
      selectMission(null);
    },
    onToggleSidebar: toggleSidebar,
  });
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/frontend && pnpm typecheck`
Expected: PASS — no references to the removed `onDismiss` / `exitActive` remain.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/active/EscalationOverlay.tsx packages/frontend/src/App.tsx
git commit -m "fix(frontend): remove misleading escalation Dismiss button

Dismiss cleared the overlay locally but left the checkpoint pending server-side,
silently stalling the mission. The orchestrator has no 'defer' concept, so the
honest fix is to require a real decision (Approve/Reject/Rescope/Abort). Also
removes the Esc-to-dismiss-checkpoint shortcut; Esc still closes the help overlay."
```

---

## Phase 4 — Standalone fixes (H4, H6)

### Task 6: Rewrite `MutationPanel` from Tailwind classes to inline styles + design tokens

**Why:** `MutationPanel` is the only component in the app using Tailwind utility classes (`rounded-md border border-border bg-bg-surface p-3`, `grid grid-cols-3 gap-1`, `text-success`, etc.). Tailwind is **not configured** — there's no `tailwind.config.*`, no `@tailwindcss/vite` plugin, no `@import "tailwindcss"` in `styles.css`. The component renders as completely unstyled bare HTML (no border, padding, colors, or grid). Every other component in the app uses inline styles + `var(--*)` CSS custom properties. Rewrite this one component to match.

**Files:**
- Modify: `packages/frontend/src/active/MutationPanel.tsx`

- [ ] **Step 1: Read the current file**

Read `packages/frontend/src/active/MutationPanel.tsx` (172 lines). Note the `scoreBand` and `bandColorVar` imports from `./mutation-score` (keep them — they return CSS variable names like `var(--success)` which work with inline styles).

- [ ] **Step 2: Rewrite all JSX to inline styles, preserving every behavior**

The component has four return paths (`summaryError`, `!summary.strykerConfigured`, `!summary`, and the main score card) plus the "Run Mutation Tests" button. Rewrite the entire file. The logic (`useState`, `useEffect`, `useCallback`, `startRun`, polling) stays identical — only the JSX `className` strings become `style` objects. Replace the whole file with:

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import type { MutationReportSummary, MutationRunStatus } from "@aurex/shared";
import { runMutationTests, getMutationRunStatus, getMutationSummary } from "../api";
import { scoreBand, bandColorVar } from "./mutation-score";

interface Props {
  repoName: string;
}

const sectionStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "12px",
};

const headerLabelStyle: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
};

const mutedTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "var(--text-muted)",
};

export function MutationPanel({ repoName }: Props) {
  const [summary, setSummary] = useState<MutationReportSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [runStatus, setRunStatus] = useState<MutationRunStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummaryError(false);
    getMutationSummary(repoName)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummaryError(true); });
    return () => { cancelled = true; };
  }, [repoName]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startRun = useCallback(async () => {
    setRunStatus({ state: "starting", runId: "", startedAt: new Date().toISOString() });
    try {
      const { runId } = await runMutationTests(repoName);
      pollRef.current = setInterval(async () => {
        try {
          const status = await getMutationRunStatus(repoName, runId);
          setRunStatus(status);
          if (status.state === "completed" && status.summary) {
            setSummary(status.summary);
          }
          if (status.state === "completed" || status.state === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
    } catch (err) {
      setRunStatus({
        state: "failed",
        runId: "",
        error: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      });
    }
  }, [repoName]);

  const runIsBusy = runStatus.state === "starting" || runStatus.state === "running";

  if (summaryError) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>
          Could not load mutation data for this repo.
        </p>
      </div>
    );
  }

  if (summary && !summary.strykerConfigured) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>
          Stryker is not configured in this repo. Add a <code style={{ fontFamily: '"JetBrains Mono", monospace', color: "var(--accent)" }}>stryker.config.*</code> file to enable mutation testing.
        </p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>Loading mutation data…</p>
      </div>
    );
  }

  const band = scoreBand(summary.score);

  return (
    <div data-testid="mutation-panel" style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: bandColorVar(band),
              boxShadow: band !== "none" ? `0 0 6px ${bandColorVar(band)}` : "none",
            }}
          />
          <span style={headerLabelStyle}>Mutation Score</span>
        </div>
        <span
          data-testid="mutation-score"
          data-band={band}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "15px",
            fontWeight: 500,
            color: bandColorVar(band),
          }}
        >
          {summary.score !== null ? `${summary.score.toFixed(1)}%` : "—"}
        </span>
      </div>

      {summary.counts && (
        <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>
          <span><span style={{ color: "var(--success)" }}>{summary.counts.killed}</span> killed</span>
          <span><span style={{ color: "var(--error)" }}>{summary.counts.survived}</span> survived</span>
          <span><span style={{ color: "var(--text-muted)" }}>{summary.counts.noCoverage}</span> no-cov</span>
        </div>
      )}

      {summary.generatedAt && (
        <p style={{ marginTop: "8px", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>
          Last run: {new Date(summary.generatedAt).toLocaleString()}
        </p>
      )}

      <button
        type="button"
        onClick={startRun}
        disabled={runIsBusy}
        style={{
          marginTop: "12px",
          width: "100%",
          borderRadius: "4px",
          border: "1px solid var(--accent-dim)",
          background: "transparent",
          padding: "6px 12px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "10px",
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--accent)",
          cursor: runIsBusy ? "not-allowed" : "pointer",
          opacity: runIsBusy ? 0.5 : 1,
        }}
        onMouseEnter={(e) => { if (!runIsBusy) e.currentTarget.style.background = "var(--accent-glow)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {runStatus.state === "idle" && "Run Mutation Tests"}
        {runStatus.state === "starting" && "Starting…"}
        {runStatus.state === "running" && "Running…"}
        {runStatus.state === "completed" && "Re-run Mutation Tests"}
        {runStatus.state === "failed" && "Retry"}
      </button>

      {runStatus.state === "failed" && "error" in runStatus && (
        <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--error)" }}>{runStatus.error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck and visually verify the rendered structure is unchanged**

Run: `cd packages/frontend && pnpm typecheck`
Expected: PASS.

Confirm the `data-testid="mutation-panel"` and `data-testid="mutation-score"` attributes are preserved (they're used by any existing tests / Playwright selectors). Confirm the four conditional return paths and the button label logic are identical to the original.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/active/MutationPanel.tsx
git commit -m "fix(frontend): MutationPanel no longer renders unstyled

Was the only component using Tailwind utility classes, but Tailwind is not
configured (no config, no vite plugin, no @import). Rewrote to inline styles +
var(--*) design tokens to match every other component in the app. Behavior and
data-testid hooks unchanged."
```

---

### Task 7: Persist `preparedRepo` across refresh via `sessionState`

**Why:** When a user picks a GitHub repo, the app clones + indexes it and fetches hotspots/suggestions/readiness/package-scan, then renders a rich `RepoOverviewPanel`. All of that lives in `useState(preparedRepo)` in `App.tsx` with zero persistence. A refresh (or clicking a mission then "New mission") wipes it, forcing the user to re-pick and re-wait. The fix: persist just the `repoName` + `fullName` to `sessionStorage` (via the existing `lib/sessionState.ts` helper), and on mount of `MissionCreationView`, if a persisted repo exists and no `preparedRepo` was passed in, refetch the summary from the (already-indexed) repo via `getRepoSummary(repoName)` and call `onRepoPrepared` to rehydrate.

**Files:**
- Modify: `packages/frontend/src/App.tsx` (save on prepare, clear on mission create)
- Modify: `packages/frontend/src/active/MissionCreationView.tsx` (rehydrate on mount)

- [ ] **Step 1: Read the current persistence helper and the two call sites**

Read `packages/frontend/src/lib/sessionState.ts` (26 lines — exports `setSessionState`, `getSessionState`, `clearSessionState`). Then read `App.tsx` lines 55–66 (the `preparedRepo` state + type) and lines 147–178 (`handleRepoPrepared` + `handleCreateMission`). Then read `MissionCreationView.tsx` lines 1–60 (props + the `useEffect(() => { form.open(); }, [])` mount effect).

- [ ] **Step 2: Persist the prepared repo identity in `handleRepoPrepared`**

In `packages/frontend/src/App.tsx`, add the import (near the existing `setTokenGetter` import):

```typescript
import { getSessionState, clearSessionState, setSessionState } from "./lib/sessionState";
```

(If `setSessionState` isn't already imported, add it; `getSessionState`/`clearSessionState` are already imported.)

In `handleRepoPrepared` (currently ~lines 152–180), persist the repo identity at the top of the function body, right after `const { repoName, fullName, summary } = info;`:

```typescript
  const handleRepoPrepared = useCallback(async (info: { repoName: string; fullName: string; summary: CodeSummaryResponse | null }) => {
    const { repoName, fullName, summary } = info;
    // Persist so a page refresh can rehydrate the overview without re-cloning.
    setSessionState("prepared_repo", { repoName, fullName });
    const version = Date.now();
    // ... (rest unchanged)
```

And clear it in `handleCreateMission` (currently ~lines 138–142), since a started mission no longer needs the creation-view overview:

```typescript
  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
    setPreparedRepo(null);
    clearSessionState("prepared_repo"); // mission started — don't restore overview
  }, [addOptimisticMission]);
```

- [ ] **Step 3: Rehydrate the overview on `MissionCreationView` mount**

In `packages/frontend/src/active/MissionCreationView.tsx`, add the import:

```typescript
import { getSessionState } from "../lib/sessionState";
```

Add `getRepoSummary` to the existing API import line (it's already exported from `../api`):

```typescript
import { prepareGitHubRepo, exploreRepo, getRepoSummary } from "../api";
```

Add a mount effect that runs once, after the existing `useEffect(() => { form.open(); }, [])`. Place it right after that effect:

```typescript
  // Rehydrate the repo overview after a refresh. If the parent already passed
  // a preparedRepo (e.g. it was never lost), do nothing. Otherwise, if we
  // persisted a repo identity last session, refetch its (already-indexed)
  // summary and notify the parent via onRepoPrepared — which re-triggers the
  // full overview load (hotspots, suggestions, readiness, package scan).
  useEffect(() => {
    if (preparedRepo) return; // parent still has it — nothing to restore
    if (!onRepoPrepared) return;
    const persisted = getSessionState<{ repoName: string; fullName: string }>("prepared_repo");
    if (!persisted) return;
    let cancelled = false;
    (async () => {
      let summary: CodeSummaryResponse | null = null;
      try {
        summary = await getRepoSummary(persisted.repoName);
      } catch {
        summary = null; // repo may have been evicted; parent will show a loading-then-empty state
      }
      if (!cancelled) {
        onRepoPrepared({ repoName: persisted.repoName, fullName: persisted.fullName, summary });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — we want this to run once on first render
```

The parent's `handleRepoPrepared` (App.tsx) already does the full `setPreparedRepo({...loading: true})` → fetch hotspots/readiness/scans → `setPreparedRepo({...loading: false})` dance, so calling `onRepoPrepared` is sufficient to rebuild the entire overview. No clone happens (the repo is already indexed from the prior session), so this is fast.

- [ ] **Step 4: Run typecheck**

Run: `cd packages/frontend && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/active/MissionCreationView.tsx
git commit -m "fix(frontend): preparedRepo survives refresh via sessionStorage

Repo analysis (clone, index, hotspots, suggestions, readiness, package scan)
lived only in useState, so a refresh or mission-then-back wiped it and forced a
re-pick + re-wait. Now the repo identity persists in sessionStorage; on mount of
MissionCreationView, if no preparedRepo was passed, we refetch the summary for
the already-indexed repo and rebuild the overview. Cleared when a mission starts."
```

---

## Self-Review

**1. Spec coverage (each HIGH finding → task):**
- H1 (`submitCheckpoint` no `res.ok`) → **T1** ✓
- H2 (checkpoint fire-and-forget, no rollback) → **T2 + T3** ✓
- H3 (supply-chain scan dropped) → **T4** ✓
- H4 (`MutationPanel` unstyled) → **T6** ✓
- H5 (Dismiss not wired to backend) → **T5** ✓
- H6 (`preparedRepo` lost on refresh) → **T7** ✓

**2. Placeholder scan:** No TBD / "add error handling" / "similar to Task N". Every step has real code. The one self-correction in T3 Step 1 (a placeholder test body that's explicitly replaced in the same step) is resolved within the step.

**3. Type / name consistency:**
- `WsControlMessage` defined in T2 → imported in T3 (`App.tsx`) and used in `onControl`. ✓
- `PendingCheckpoint` / `pendingCheckpoint` / `pendingCheckpointError` defined in T3 reducer → consumed in T3 `App.tsx` (`state.pendingCheckpoint`, `state.pendingCheckpointError`) and T3 `EscalationOverlay` props. ✓
- `CHECKPOINT_SUBMITTING` / `CHECKPOINT_ACKED` / `CLEAR_PENDING_CHECKPOINT_ERROR` action names consistent across reducer (T3 Step 3) + dispatch sites (T3 Steps 5, 6, 7). ✓
- `EscalationOverlay` props (`submitting`, `submitError`, `onDismissSubmitError`) defined in T3 Step 7 → unchanged in T5 (which only removes `onDismiss`/`handleDismiss`/the Dismiss button). ✓
- `classifyMessage` / `ClassifiedMessage` defined in T2 → used in T2's `onmessage` refactor. ✓
- `getRepoSummary` used in T7 is already exported from `api.ts` (verified at `api.ts:303`). ✓
- `setSessionState` used in T7 is already exported from `lib/sessionState.ts`. ✓

**4. Ordering / dependencies:** T1 → T2 → T3 (checkpoint cluster, must be sequential). T4 standalone. T5 depends on T3 (overlay props). T6, T7 standalone. Safe execution order: **T1, T2, T3, T4, T5, T6, T7** (or T1–T3 first, then T4/T6/T7 in any order, then T5).

**5. Risk check:** All changes are frontend-only and covered by unit tests for the pure logic (reducers, `classifyMessage`, `submitCheckpoint`). The React-wiring steps (T3 Steps 5–7, T5 Step 3, T7) are typecheck-gated. No backend changes. No new dependencies.
