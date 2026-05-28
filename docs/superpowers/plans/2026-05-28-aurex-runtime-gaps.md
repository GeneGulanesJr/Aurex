# Aurex Runtime Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the known Aurex runtime gaps: mission hydration, live dashboard updates, checkpoint decisions, abort propagation, frontend WebSocket protocol support, compression observability, and broken test mocks.

**Architecture:** Treat LaPis as the source of persisted mission state, the backend runner as the source of live orchestration events, and the frontend as a hydrated-plus-streamed projection. Checkpoint escalations must carry the backend-created checkpoint id. Abort must flow from mission pool to runner to milestone loop to active agent handles.

**Tech Stack:** TypeScript, Fastify, React 19, Vite, Vitest, `@aurex/shared`, existing LaPis HTTP client, existing WebSocket event bus.

---

## File Structure

- Modify `packages/shared/src/events.ts` — add `checkpointId` to escalation events; optionally add compression event type if tests reveal frontend needs it.
- Modify `packages/shared/src/rest.ts` — ensure current mission payload types include hydrated milestones and active workers.
- Modify `packages/backend/src/clients/lapis-client.ts` — add mission hydration methods: `getMilestonesForMission`; keep `getWorkingUnitsForMilestone`; make `runCompression` typed and no longer described as stubbed.
- Modify `packages/backend/src/routes/missions.ts` — return real `milestones` and `activeWorkers` for `/current` and `/:id`.
- Modify `packages/backend/src/orchestrator/mission-runner.ts` — create authoritative checkpoint escalation events with `checkpointId`; pass abort signal into milestone loop.
- Modify `packages/backend/src/orchestrator/milestone-loop.ts` — remove duplicate pre-checkpoint UI escalation emits; accept `AbortSignal`; abort active agent handles.
- Modify `packages/backend/src/orchestrator/mission-runner-pool.ts` — ensure abort updates queued/running mission behavior and emits completion consistently.
- Modify `packages/frontend/src/hooks/useMission.ts` — apply `milestone_progress`, `agent_status`, `mission_completed`, and checkpoint-bearing escalations.
- Modify `packages/frontend/src/hooks/useWebSocket.ts` — support auth, replay, selected mission subscription, and last sequence tracking.
- Modify `packages/frontend/src/App.tsx` — submit backend checkpoint id instead of a random id; pass selected mission id into WebSocket hook.
- Modify `packages/frontend/src/api.ts` — include Authorization header when configured, matching backend auth.
- Modify affected tests under `packages/backend/__tests__` and `packages/frontend/src/*.test.ts` — add red/green coverage for every gap.

---

## Task 1: Fix Vitest `node:child_process` Mock Breakage

**Files:**
- Modify: backend tests that mock `node:child_process`, especially worktree and milestone/runner tests.
- Test: `packages/backend/__tests__/worktree.test.ts`
- Test: `packages/backend/__tests__/mission-runner.test.ts`
- Test: `packages/backend/__tests__/milestone-loop.test.ts`

- [ ] **Step 1: Find all `node:child_process` mocks**

Run:
```bash
awk '/node:child_process|vi.mock\(.*child_process/{print FILENAME ":" FNR ":" $0}' packages/backend/__tests__/*.ts packages/backend/__tests__/**/*.ts
```
Expected: list of files whose mock must export both `exec` and `execFile` if they import worktree code.

- [ ] **Step 2: Update mocks to include `execFile`**

Use this pattern in each affected test file:
```ts
const execFileMock = vi.fn((cmd: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
  cb(null, "", "");
});

vi.mock("node:child_process", () => ({
  exec: vi.fn((cmd: string, cb: (err: Error | null, stdout: string, stderr: string) => void) => cb(null, "", "")),
  execFile: execFileMock,
}));
```

- [ ] **Step 3: Verify imports no longer fail**

Run:
```bash
npx vitest --run packages/backend/__tests__/worktree.test.ts packages/backend/__tests__/mission-runner.test.ts packages/backend/__tests__/milestone-loop.test.ts
```
Expected: suites execute tests instead of failing at import time with `No "execFile" export`.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/__tests__
git commit -m "test: fix child_process mocks for worktree imports"
```

---

## Task 2: Hydrate Mission REST Payloads

**Files:**
- Modify: `packages/backend/src/clients/lapis-client.ts`
- Modify: `packages/backend/src/routes/missions.ts`
- Modify: `packages/shared/src/rest.ts`
- Test: `packages/backend/__tests__/routes/missions.test.ts`

- [ ] **Step 1: Write failing route test**

Add a test that proves `/api/missions/:id` returns actual milestones and active workers:
```ts
it("hydrates mission details with milestones and active workers", async () => {
  const lapis = createMockLapis({
    mission: { id: "m1", description: "Ship feature", status: "running", configJson: defaultConfig },
    milestones: [{ id: "ms1", missionId: "m1", title: "Build", description: "Build", orderIndex: 0, status: "in_progress", validationContractId: "c1" }],
    unitsByMilestone: {
      ms1: [
        { id: "u1", milestoneId: "ms1", description: "Active", status: "running", declaredPaths: [], declaredModules: [] },
        { id: "u2", milestoneId: "ms1", description: "Done", status: "completed", declaredPaths: [], declaredModules: [] },
      ],
    },
  });
  const app = await buildApp({ lapis });

  const res = await app.inject({ method: "GET", url: "/api/missions/m1" });

  expect(res.statusCode).toBe(200);
  expect(res.json().milestones).toHaveLength(1);
  expect(res.json().activeWorkers.map((u: any) => u.id)).toEqual(["u1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run packages/backend/__tests__/routes/missions.test.ts -t "hydrates mission details"
```
Expected: FAIL because payload currently returns empty arrays or mock lacks `getMilestonesForMission`.

- [ ] **Step 3: Add LaPis method**

In `LaPisClient`:
```ts
getMilestonesForMission(missionId: string): Promise<Milestone[]>;
```

In `createLaPisClient`:
```ts
getMilestonesForMission(missionId) {
  return get(`/missions/${missionId}/milestones`);
},
```

- [ ] **Step 4: Implement hydration helper in mission routes**

Add inside `missionRoutes`:
```ts
async function hydrateMissionPayload(missionId: string) {
  const [mission, milestones, cost] = await Promise.all([
    lapis.getMission(missionId),
    lapis.getMilestonesForMission(missionId),
    lapis.getMissionCost(missionId),
  ]);

  const unitsByMilestone = await Promise.all(
    milestones.map((milestone) => lapis.getWorkingUnitsForMilestone(milestone.id)),
  );
  const activeWorkers = unitsByMilestone
    .flat()
    .filter((unit) => !["completed", "failed", "timed_out"].includes(unit.status));

  return { mission, milestones, activeWorkers, cost };
}
```

Replace both empty-array responses with:
```ts
return hydrateMissionPayload(missionId);
```

- [ ] **Step 5: Run route tests**

```bash
npx vitest --run packages/backend/__tests__/routes/missions.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/clients/lapis-client.ts packages/backend/src/routes/missions.ts packages/shared/src/rest.ts packages/backend/__tests__/routes/missions.test.ts
git commit -m "feat: hydrate mission REST payloads"
```

---

## Task 3: Make Checkpoint Escalations Use Backend Checkpoint IDs

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/backend/__tests__/mission-runner.test.ts`
- Test: frontend App or hook test if existing setup supports it.

- [ ] **Step 1: Write failing backend test**

Add or update a mission-runner test:
```ts
it("emits escalation events with the created checkpoint id", async () => {
  const emitted: any[] = [];
  const lapis = createMockLapis({ createdCheckpointId: "cp-real" });
  const runner = createMissionRunner({ ...deps, lapis, eventBus: { emit: (e) => emitted.push(e), subscribe: vi.fn(), getEventsSince: vi.fn(), getCurrentSeq: vi.fn() } });

  runner.start("m1");
  await waitFor(() => emitted.some((e) => e.type === "escalation"));

  expect(emitted.find((e) => e.type === "escalation").checkpointId).toBe("cp-real");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run packages/backend/__tests__/mission-runner.test.ts -t "checkpoint id"
```
Expected: FAIL because current escalation events do not include `checkpointId`.

- [ ] **Step 3: Update shared event type**

Change escalation event in `packages/shared/src/events.ts`:
```ts
| { type: "escalation"; missionId: string; checkpointId: string; trigger: EscalationTrigger; context: EscalationContext }
```

- [ ] **Step 4: Emit only authoritative runner escalation events**

In `mission-runner.ts`, after `checkpointManager.create`, emit:
```ts
eventBus.emit({
  type: "escalation",
  missionId,
  checkpointId,
  trigger: { kind: loopResult.trigger, milestoneId: loopResult.milestoneId } as EscalationTrigger,
  context: { summary: loopResult.summary } as EscalationContext,
});
```

In `milestone-loop.ts`, remove duplicate `callbacks.onEscalation(...)` calls that immediately precede returning `checkpoint_needed`. The loop should return the checkpoint request; the runner should create and announce the checkpoint.

- [ ] **Step 5: Submit the received checkpoint id in App**

In `App.tsx`:
```ts
const checkpointId = state.escalation?.type === "escalation" ? state.escalation.checkpointId : null;
if (!checkpointId) return;
await submitCheckpoint(state.mission.id, checkpointId, decision, guidance, reason);
```

- [ ] **Step 6: Run tests**

```bash
npx vitest --run packages/backend/__tests__/mission-runner.test.ts packages/backend/__tests__/milestone-loop-checkpoint.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/events.ts packages/backend/src/orchestrator/mission-runner.ts packages/backend/src/orchestrator/milestone-loop.ts packages/frontend/src/App.tsx packages/backend/__tests__
git commit -m "fix: wire checkpoint ids through escalations"
```

---

## Task 4: Apply Live Mission Updates in Frontend State

**Files:**
- Modify: `packages/frontend/src/hooks/useMission.ts`
- Test: add `packages/frontend/src/hooks/useMission.test.ts` if hook tests exist, otherwise add reducer tests in a focused exported reducer module.

- [ ] **Step 1: Extract reducer for direct tests**

If hook testing infrastructure is absent, export the reducer and initial state:
```ts
export const initialMissionState: MissionState = {
  mission: null,
  milestones: [], activeWorkers: [], cost: null, escalation: null,
};

export function missionReducer(state: MissionState, action: Action): MissionState {
  // existing switch body
}
```

- [ ] **Step 2: Write failing reducer tests**

```ts
it("updates milestone progress from websocket events", () => {
  const state = missionReducer(seedState, {
    type: "MILESTONE_PROGRESS",
    milestoneId: "ms1",
    status: "validating",
    completedUnits: 2,
    totalUnits: 3,
  });
  expect(state.milestones.find((m) => m.id === "ms1")?.status).toBe("validating");
});

it("upserts active worker status from websocket events", () => {
  const state = missionReducer(seedState, {
    type: "AGENT_STATUS",
    agentId: "worker-u1",
    agentType: "worker",
    status: "working",
    milestoneId: "ms1",
  });
  expect(state.activeWorkers.some((w: any) => w.id === "worker-u1" || w.agentId === "worker-u1")).toBe(true);
});
```

- [ ] **Step 3: Implement actions**

Add action variants:
```ts
| { type: "MILESTONE_PROGRESS"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
| { type: "AGENT_STATUS"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
| { type: "MISSION_COMPLETED"; finalState: string };
```

Handle them by updating matching milestone status, upserting worker display records, and updating mission status on completion.

- [ ] **Step 4: Dispatch from WebSocket handler**

In `handleWsEvent`, add cases for `milestone_progress`, `agent_status`, and `mission_completed`.

- [ ] **Step 5: Run frontend tests**

```bash
npx vitest --run packages/frontend/src/hooks/useMission.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useMission.ts packages/frontend/src/hooks/useMission.test.ts
git commit -m "feat: apply live mission websocket updates"
```

---

## Task 5: Propagate Abort to Active Agent Work

**Files:**
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Modify: `packages/backend/src/agents/agent-spawner.ts` if handle abort does not currently stop sessions strongly enough.
- Test: `packages/backend/__tests__/mission-runner.test.ts`
- Test: `packages/backend/__tests__/milestone-loop.test.ts`

- [ ] **Step 1: Write failing abort test**

```ts
it("aborts active worker handles when mission abort is requested", async () => {
  const abortSpy = vi.fn();
  mockSpawnerSpawn.mockResolvedValue({
    completed: new Promise(() => {}),
    abort: abortSpy,
    dispose: vi.fn(),
  });

  const runner = createMissionRunner(deps);
  runner.start("m1");
  await waitForWorkerSpawn();
  runner.abort();

  expect(abortSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run packages/backend/__tests__/mission-runner.test.ts -t "aborts active worker"
```
Expected: FAIL because abort signal is not wired into the loop or handles.

- [ ] **Step 3: Pass signal into milestone loop**

Change loop call:
```ts
loopResult = await loop.run(refreshedMission, currentMilestones, abortController.signal);
```

Change signature:
```ts
async run(mission: Mission, milestones: Milestone[], signal?: AbortSignal): Promise<MilestoneLoopResult>
```

- [ ] **Step 4: Track and abort active handles**

In `milestone-loop.ts`:
```ts
const activeHandles = new Set<SpawnHandle>();
function throwIfAborted() {
  if (signal?.aborted) throw new Error("Mission aborted");
}
const abortListener = () => {
  for (const handle of activeHandles) handle.abort();
};
signal?.addEventListener("abort", abortListener, { once: true });
try {
  // call throwIfAborted before each phase and after each await that can block
  activeHandles.add(handle);
  const result = await handle.completed;
  activeHandles.delete(handle);
} finally {
  signal?.removeEventListener("abort", abortListener);
}
```

- [ ] **Step 5: Mark aborted missions as aborted**

In `mission-runner.ts` catch block:
```ts
if (abortController?.signal.aborted) {
  await lapis.updateMissionStatus(missionId, "aborted").catch(() => {});
  setStatus("failed", missionId);
  return;
}
```

- [ ] **Step 6: Run abort tests**

```bash
npx vitest --run packages/backend/__tests__/mission-runner.test.ts packages/backend/__tests__/milestone-loop.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/orchestrator/mission-runner.ts packages/backend/src/orchestrator/milestone-loop.ts packages/backend/src/agents/agent-spawner.ts packages/backend/__tests__
git commit -m "fix: propagate mission abort to active agents"
```

---

## Task 6: Implement Frontend WebSocket Auth, Replay, and Subscription

**Files:**
- Modify: `packages/frontend/src/hooks/useWebSocket.ts`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/api.ts`
- Test: `packages/frontend/src/hooks/useWebSocket.test.ts` if hook/socket tests exist; otherwise add focused tests for message handling helpers.

- [ ] **Step 1: Extract message handling helpers**

Create testable helpers in `useWebSocket.ts`:
```ts
export function buildWsUrl(location: Location): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export function parseWsMessage(data: string): { seq?: number; event?: WsClientEvent; type?: string } | null {
  try { return JSON.parse(data); } catch { return null; }
}
```

- [ ] **Step 2: Write failing tests for replay and subscription messages**

```ts
it("sends replay and mission subscription after hello", () => {
  const sent: unknown[] = [];
  handleOpenProtocol({
    apiKey: "secret",
    selectedMissionId: "m1",
    lastSeq: 12,
    send: (msg) => sent.push(JSON.parse(msg)),
  });

  expect(sent).toContainEqual({ type: "auth", token: "secret" });
  expect(sent).toContainEqual({ type: "replay", lastSeq: 12 });
  expect(sent).toContainEqual({ event: "subscribe_mission", missionId: "m1" });
});
```

- [ ] **Step 3: Add hook options**

Change signature:
```ts
export function useWebSocket(onEvent: (event: WsClientEvent) => void, opts?: { missionId?: string | null; apiKey?: string })
```

On open, send auth if `apiKey`, replay from `localStorage.getItem("aurex:lastSeq")`, and subscription if `missionId`.

- [ ] **Step 4: Persist sequence and ignore non-event protocol messages**

In `onmessage`:
```ts
const parsed = parseWsMessage(msg.data);
if (!parsed) return;
if (typeof parsed.seq === "number") localStorage.setItem("aurex:lastSeq", String(parsed.seq));
if (parsed.event) onEventRef.current(parsed.event);
```

- [ ] **Step 5: Pass selected mission from App**

```ts
const { connected } = useWebSocket(combinedHandler, {
  missionId: missionsState.selectedMissionId,
  apiKey: import.meta.env.VITE_AUREX_API_KEY,
});
```

- [ ] **Step 6: Add REST auth header**

In `api.ts`, centralize fetch:
```ts
function authHeaders(): HeadersInit {
  const token = import.meta.env.VITE_AUREX_API_KEY;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```
Use it in every fetch call.

- [ ] **Step 7: Run frontend tests**

```bash
npx vitest --run packages/frontend/src
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/hooks/useWebSocket.ts packages/frontend/src/App.tsx packages/frontend/src/api.ts packages/frontend/src/hooks/useWebSocket.test.ts
git commit -m "feat: support websocket auth replay and subscriptions"
```

---

## Task 7: Make Compression Behavior Explicit and Verified

**Files:**
- Modify: `packages/backend/src/clients/lapis-client.ts`
- Create: `packages/backend/src/orchestrator/compression.ts`
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Test: `packages/backend/__tests__/compression.test.ts`
- Test: existing milestone loop cost/post milestone tests.

- [ ] **Step 1: Write compression service tests**

```ts
it("runs compression and reports success", async () => {
  const lapis = { runCompression: vi.fn().mockResolvedValue({ compressed: true }) } as any;
  const compression = createCompressionService(lapis, { emit: vi.fn() } as any);

  await compression.run("m1", "post_milestone");

  expect(lapis.runCompression).toHaveBeenCalledWith("m1", "post_milestone");
});

it("does not fail the mission when compression endpoint fails", async () => {
  const emit = vi.fn();
  const lapis = { runCompression: vi.fn().mockRejectedValue(new Error("offline")) } as any;
  const compression = createCompressionService(lapis, { emit } as any);

  await expect(compression.run("m1", "budget_threshold")).resolves.toBeUndefined();
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_status" }));
});
```

- [ ] **Step 2: Create compression service**

`packages/backend/src/orchestrator/compression.ts`:
```ts
import type { CompressionTrigger } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";

export function createCompressionService(lapis: LaPisClient, eventBus: Pick<EventBus, "emit">) {
  return {
    async run(missionId: string, trigger: CompressionTrigger): Promise<void> {
      try {
        await lapis.runCompression(missionId, trigger);
      } catch (error) {
        eventBus.emit({
          type: "agent_status",
          agentId: `compression-${missionId}`,
          agentType: "orchestrator",
          status: "failed",
          milestoneId: missionId,
        } as any);
        console.warn(`[compression] ${trigger} failed for ${missionId}:`, error instanceof Error ? error.message : error);
      }
    },
  };
}
```

- [ ] **Step 3: Use service instead of direct LaPis calls**

Create service in runner/loop wiring and replace direct calls:
```ts
await compression.run(mission.id, "post_milestone");
```

For budget threshold:
```ts
compression.run(mId, "budget_threshold").catch(() => {});
```

- [ ] **Step 4: Update client comment and return type**

Change comment from `State compression (stubbed)` to:
```ts
// State compression delegated to LaPis.
```
Keep method:
```ts
runCompression(missionId: string, trigger: CompressionTrigger): Promise<void>;
```

- [ ] **Step 5: Run tests**

```bash
npx vitest --run packages/backend/__tests__/compression.test.ts packages/backend/__tests__/milestone-loop-costcap.test.ts packages/backend/__tests__/milestone-loop-checkpoint.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/orchestrator/compression.ts packages/backend/src/clients/lapis-client.ts packages/backend/src/orchestrator/mission-runner.ts packages/backend/src/orchestrator/milestone-loop.ts packages/backend/__tests__/compression.test.ts packages/backend/__tests__/milestone-loop-costcap.test.ts packages/backend/__tests__/milestone-loop-checkpoint.test.ts
git commit -m "feat: make compression explicit and observable"
```

---

## Task 8: Full Verification and Memory Update

**Files:**
- Modify only if verification exposes failures.

- [ ] **Step 1: Reindex after code changes**

```bash
# via Pi tool
memory-code reindex-repo --repo aurex
```
Expected: fresh index.

- [ ] **Step 2: Run typecheck**

```bash
pnpm -s run typecheck
```
Expected: exit code 0.

- [ ] **Step 3: Run all tests**

```bash
npx vitest --run
```
Expected: all test files pass.

- [ ] **Step 4: Run build**

```bash
pnpm -s run build
```
Expected: backend, shared, and frontend build successfully.

- [ ] **Step 5: Save completion memory**

Save a project memory with this content:
```md
**What**: Completed Aurex runtime gap fixes: hydrated mission payloads, checkpoint IDs in escalation events, frontend live updates, abort propagation, WebSocket auth/replay/subscription, explicit compression service, and fixed child_process test mocks.
**Why**: These changes make mission state visible and controllable end-to-end from backend orchestration through the dashboard.
**Where**: packages/shared/src/events.ts, packages/backend/src/routes/missions.ts, packages/backend/src/orchestrator/*, packages/frontend/src/hooks/*, packages/frontend/src/App.tsx, packages/frontend/src/api.ts.
**Learned**: [replace with any concrete test or integration lessons discovered during implementation]
```

- [ ] **Step 6: Final commit**

```bash
git status --short
git log --oneline -8
```
Expected: clean working tree after task commits, or only intentional uncommitted plan/docs changes.

---

## Self-Review

- **Spec coverage:** Covers all six audited gaps plus the currently broken Vitest import suites.
- **Placeholder scan:** No deferred implementation steps; each task includes exact files, commands, and expected outcomes.
- **Type consistency:** Uses existing domain names: mission, milestone, working unit, checkpoint, escalation, compression, LaPis, PiNyx.
- **Risk:** Compression is delegated to LaPis by architecture. This plan makes it explicit and observable inside Aurex, but does not implement LaPis internals in this repository.
