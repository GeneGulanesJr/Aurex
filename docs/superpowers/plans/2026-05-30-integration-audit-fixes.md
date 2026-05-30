# Integration Audit Issues — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all inconsistencies and missing implementations found during codebase audit after the UI-only integrations refactor.

---

### Issue 1: `EscalationTrigger` type missing `cost_cap_exceeded` variant

**Severity:** Critical — backend emits `cost_cap_exceeded` escalation events but frontend can't handle them

**Problem:**
- `packages/shared/src/events.ts` `EscalationTrigger` type has 3 variants: `milestone_complete`, `rescope_limit`, `unclassifiable_error`
- Backend milestone-loop emits `"cost_cap_exceeded"` as a `CheckpointTrigger` and constructs escalation events
- Frontend `CheckpointPanel.tsx` only handles 3 trigger kinds — `cost_cap_exceeded` falls through with no UI
- Frontend `DecisionActions.tsx` only renders buttons for 3 trigger kinds — `cost_cap_exceeded` shows no actions (stuck overlay)

**Files:**
- Modify: `packages/shared/src/events.ts` — add `{ kind: "cost_cap_exceeded"; milestoneId: string }` to `EscalationTrigger`
- Modify: `packages/frontend/src/active/CheckpointPanel.tsx` — add case for `cost_cap_exceeded`
- Modify: `packages/frontend/src/active/DecisionActions.tsx` — add approve/abort buttons for `cost_cap_exceeded`

- [ ] **Step 1: Add `cost_cap_exceeded` to `EscalationTrigger` in shared/events.ts**

In `packages/shared/src/events.ts`, add to the `EscalationTrigger` union:

```ts
| { kind: "cost_cap_exceeded"; milestoneId: string }
```

- [ ] **Step 2: Add case in `CheckpointPanel.tsx`**

Add a case before the closing brace of the switch:

```tsx
case "cost_cap_exceeded":
  return (
    <div style={{ marginBottom: "24px" }}>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--warning)", marginBottom: "8px" }}>Cost Cap Exceeded</h2>
      <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Mission spending has reached the cost limit. Approve to continue or abort the mission.</p>
    </div>
  );
```

- [ ] **Step 3: Add case in `DecisionActions.tsx`**

Add after the `milestone_complete` block:

```tsx
{trigger.kind === "cost_cap_exceeded" && (
  <>
    <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--warning)", color: "var(--bg-deep)" }}>Approve Over Budget</button>
    <button onClick={() => onDecision("reject", undefined, "cost_exceeded")} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
  </>
)}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: ALL pass

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/events.ts packages/frontend/src/active/CheckpointPanel.tsx packages/frontend/src/active/DecisionActions.tsx
git commit -m "fix: add cost_cap_exceeded to EscalationTrigger and handle in frontend"
```

---

### Issue 2: `TopBar` shows "PINYX CONNECTED" based on WS connection, not actual PiNyx config status

**Severity:** Important — misleading UI after PiNyx became UI-configurable

**Problem:**
- `TopBar` shows "PINYX CONNECTED" using the WebSocket `connected` boolean
- After the PiNyx refactor, "connected" means WS is connected to the Aurex backend, NOT that PiNyx is configured
- Should show PiNyx integration status (configured or not)

**Files:**
- Modify: `packages/frontend/src/frame/TopBar.tsx` — add `pinyxConfigured` prop, use for status dot
- Modify: `packages/frontend/src/App.tsx` — pass `pinyxStatus.configured` to TopBar

- [ ] **Step 1: Update TopBar props and status**

In `packages/frontend/src/frame/TopBar.tsx`:
1. Add `pinyxConfigured?: boolean` to `TopBarProps`
2. Change "PINYX CONNECTED" to use `pinyxConfigured` for its dot color:

```tsx
<StatusItem color={pinyxConfigured ? "var(--success)" : "var(--warning)"} label={pinyxConfigured ? "PINYX CONNECTED" : "PINYX OFFLINE"} />
```

- [ ] **Step 2: Pass pinyxConfigured from App.tsx**

In `packages/frontend/src/App.tsx`, pass `pinyxStatus.configured` to `TopBar`:

```tsx
<TopBar
  ...
  pinyxConfigured={pinyxStatus.configured}
/>
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/frame/TopBar.tsx packages/frontend/src/App.tsx
git commit -m "fix: TopBar PiNyx status reflects actual config, not WS connection"
```

---

### Issue 3: `docker-compose.e2e.yml` still has stale `PINYX_ENDPOINT` env var

**Severity:** Minor — E2E tests will fail if backend rejects unknown env vars (currently it doesn't, but it's misleading)

**Files:**
- Modify: `docker-compose.e2e.yml`

- [ ] **Step 1: Remove PINYX_ENDPOINT from e2e compose**

In `docker-compose.e2e.yml`, remove the line `- PINYX_ENDPOINT=http://pinyx-stub:7331` from the backend environment.

- [ ] **Step 2: Commit**

```bash
git add docker-compose.e2e.yml
git commit -m "chore: remove stale PINYX_ENDPOINT from e2e docker-compose"
```

---

### Issue 4: Frontend `api.test.ts` `connectGitHub` test doesn't match actual response shape

**Severity:** Minor — test passes but doesn't validate the actual response shape from the new PAT flow

**Problem:**
- The test mocks the response as `{ connected: true, user: {...} }` which is correct
- But the old `getGitHubConfig` test was replaced correctly
- Verify the `PinyxConfigResponse` type still matches what `GET /api/pinyx/config` returns after removing env defaults (it now returns empty string for endpoint when unconfigured)

**Files:**
- Verify only — no change needed if types align

- [ ] **Step 1: Verify alignment**

The backend `GET /api/pinyx/config` returns `{ endpoint: "", modelHints: defaultModelHints, providers: [] }` when unconfigured. The frontend `PinyxConfigResponse` has `endpoint: string` — this is fine, empty string is valid.

---

### Task 5: Full verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit any remaining fixes**
