# Implementation Tracker

> Single source of truth for unimplemented features, code quality issues, and deferred items. Updated as work progresses. Check items off when completed.

**Last audited:** 2026-05-28
**Spec compliance:** ~98% (193 tests, 41 files)

---

## P0 — Critical Functional Gaps

- [x] **Wire anime.js animations to React components** *(completed 2026-05-28)*
  - All 6 components now use anime.js: `AgentNode` (pulse/spin/idle), `CostCounter` (animateCounter), `MilestoneBar` (animateProgress), `StatusFeed` (staggerEntrance), `StatusBoard` (dimPassive/restorePassive), `EscalationOverlay` (enterActive/exitActive)

- [x] **Validator agent spawning subsystem** *(already implemented)*
  - `packages/backend/src/agents/validator-tools.ts` — `write_verdict` tool
  - `packages/backend/src/orchestrator/milestone-loop.ts` lines 217-261 — spawns scrutiny + user_testing validators

- [x] **Research agent spawning subsystem** *(already implemented)*
  - `packages/backend/src/agents/research-tools.ts` — `write_finding` + `search_memory` tools
  - `packages/backend/src/orchestrator/milestone-loop.ts` lines 182-215 — research agent phase

- [x] **`milestone_complete` checkpoint trigger** *(already implemented)*
  - `packages/backend/src/orchestrator/milestone-loop.ts` lines 336-351 — fires after validators pass + integration complete
  - Integration lifecycle creates release branch, then triggers human approval checkpoint

---

## P1 — Integration Gaps

- [x] **Cost tracking integration** *(already implemented)*
  - `packages/backend/src/agents/agent-spawner.ts` lines 189-216 — parses Pi SDK usage events, calls `lapis.logCost()`, fires `onCost` callback

- [ ] **State compression subsystem**
  - `state_compression_artifacts` table reserved but structure not defined
  - LaPis client `runCompression` is stubbed (logs skip, never silent)
  - Deferred per spec section 12

- [x] **Rescope replan logic** *(already implemented)*
  - `packages/backend/src/orchestrator/milestone-loop.ts` lines 288-318 — re-plans via PiNyx when negotiator returns `rescope`
  - `packages/backend/src/orchestrator/mission-runner.ts` — handles rescope checkpoint by re-running loop with updated milestones

- [x] **WebSocket client-to-server message handling** *(completed 2026-05-28)*
  - `packages/backend/src/ws/events.ts` — now handles `subscribe_mission` (filters events by missionId) and `checkpoint_decision` messages
  - Added `WsRouteDeps` interface for dependency injection of handlers

---

## P2 — Planned But Not Started

- [ ] **E2E integration tests against real services** (ref: `.kilo/plans/1779921253474-.md`)
  - 10 new test files + 3 helpers
  - Spin up real LaPis HTTP server, PiNyx stub, and real git operations
  - No code written yet

- [x] **Agent spawner observability & robustness** *(already implemented)*
  - `packages/backend/src/agents/agent-logger.ts` — structured agent lifecycle events
  - `packages/backend/src/agents/agent-spawner.ts` — tracks active handles in `Map`, implements `shutdown()`, enforces `maxConcurrent` limit

---

## P3 — Code Quality

- [x] **Fix shell injection in `worktree.ts`** *(already implemented)*
  - `packages/backend/src/orchestrator/worktree.ts` line 17-21 — `sanitizeGitArg()` validates against injection characters

- [x] **Remove unused dependencies** *(already cleaned)*
  - `better-sqlite3`, `uuid`, `@fastify/cors`, `@fastify/rate-limit` not in current `packages/backend/package.json`

- [x] **Remove dead code** *(already cleaned)*
  - No migration SQL files, `shared/src/api.ts`, or `frontend/src/websocket.ts` exist

- [x] **Remove unused config** *(already cleaned)*
  - No `wsPort` in current `packages/backend/src/config.ts`

---

## P4 — Spec Deviations

The following values extend the original spec. They are **intentional** — all are actively used by the running code:

- [x] **`WorkerStatus` extra `"planned"` value** — used in rescope flow (`milestone-loop.ts:280`)
- [x] **`CheckpointTrigger` extra `"cost_cap_exceeded"` value** — used in cost cap checkpoint (`milestone-loop.ts:177`)
- [x] **`WsClientEvent` extra `mission_queued` / `mission_completed` types** — used by mission runner pool
- [x] **LaPis `runCompression` calls API** — correct behavior, spec "stub" requirement was aspirational

---

## P5 — Performance (Low Severity)

- [x] **EventBus `getEventsSince()` linear scan** *(completed 2026-05-28)* — simplified to direct index calculation (O(1) lookup into ring buffer)
- [x] **Overlap detection quadratic** *(completed 2026-05-28)* — replaced `.some().some()` with explicit for-loops for early exit
- [x] **WebSocket replay batching** *(already implemented)* — batches of 100 with `setImmediate` yield

- [ ] **EventBus `emit()` O(n) on full ring** — when ring is full, old entries are overwritten in-place (not shifted), so this is O(1) amortized. No fix needed.
- [ ] **WorkingUnit struct bloat** — 10 fields, only 4 hot in overlap/batch loops. Low priority; would require separate hot-path type.

---

## Explicitly Out of Scope (Per Spec)

These are documented as not planned per the design specs:
- No code diff viewing in frontend
- No streaming logs panel
- No agent configuration UI
- No direct LaPis/PiNyx access from frontend
- No Docker socket mount (future if needed)
