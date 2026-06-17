# Aurex — Dead / Incomplete / Stub Code Audit

**Scope:** `packages/backend`, `packages/frontend`, `packages/shared` (excluding `node_modules`).
**Method:** every candidate was verified by repo-wide grep + targeted file reads. "0 refs" means the symbol appears nowhere outside its own file. "Test-only" means the only references outside the defining file are in `*.test.ts`.

Findings are grouped by category and ordered **by runtime impact** (silent failures / missing features first).

---

## Resolution status (follow-up work)

A follow-up pass acted on these findings. Direction chosen: prune/delete dead code and surface undocumented config, but **do not** add new behaviour to the experimental durable control plane. Verified clean with `pnpm run typecheck` + `pnpm test` (887 passing).

**Resolved by pruning / wiring-down (no runtime behaviour added):**

- **2.4** — Removed the two unhandled WS emissions (`execution_job_claimed`, `stale_reconciliation_completed`), their union members, and the now-unused `eventBus` plumbing in the execution worker + queue routes.
- **2.5** — Removed the unreachable `bumblebeeRunner.cancelScan` (interface, impl, and tests).
- **2.6** — Removed the unused `POST /api/github/config` route, the `saveGitHubConfig` frontend client + `GitHubConfigPayload`, and their tests.
- **2.7** — Added the 8 missing env vars to `.env.example` and documented them in `docs/configuration.md` (flagged experimental/reserved).
- **3.1** — Deleted the two unused queue modules (`failure-codes.ts`, `execution-queue-service.ts`).
- **3.2** — Deleted `computePostCommitScope` and `recordValidatorCapFailure`.
- **3.3** — Removed test-only exports `detectOverlap`, `enforceBroadcastTransition`, `getQuotaStatusDisplay` (+ orphaned `QuotaStatusDisplay`), `AgentLogger.getRecent`, `AGENT_SKILL`, `resolveModel`; deleted the dead enforcement modules `branch-guard.ts` and `contract-immutability.ts` (+ tests + the stale `validateContractAppend` comment in `planner.ts`). **Kept** `getActiveCount`/`getActiveSessions` as test-only observation helpers — they are woven into the spawn/shutdown lifecycle assertions, so removing them would require rewriting those assertions for zero runtime benefit.
- **3.4** — Deleted dead frontend exports: `triggerRepoScan`, `getBumblebeeStatus`, `getScanResults`, `getExposureCatalog`, `saveExposureCatalog`, `exitActive`, `getCurrentMission`.
- **3.5** — Removed the unconsumed `removeMission` hook action (callback, `REMOVE` action type, and reducer case).
- **3.6** — Deleted dead `@aurex/shared` exports: `AgentSpec`, `PlannedMilestone`, `PlannedWorkingUnit`, `StreamingChunk`, `WsServerMessage`, `WsClientMessage`, `AgentSessionMessageResponse`, `TriggerScanRequest`, `ExposureCatalogResponse`, `CreateMissionRequest`, `CheckpointRequest`.
- **3.7** — Pruned the 7 unused `ExecutionFailureCode` members and the 3 unused `PreparedAgentRole` members.
- **4.1** — Fixed the broken `LaPisClient as _LC` import in `worker-finding-tools.test.ts`.

**Intentionally deferred (need a product/design decision — rationale below):**

- **2.1 / 2.2 / 2.3** — The durable prepared-session / execution-queue subsystem is **entirely default-off** (`AUREX_DURABLE_QUEUE_ENABLED`, `AUREX_PREPARED_SESSIONS_ENABLED` both `false`); its routes and worker are not mounted unless an operator opts in. The launcher path already fails loudly with a flag-referencing message (it does not fail silently). Wiring a real `launchAgent`, scheduling a reconciler timer, or enqueueing the lifecycle job types are feature decisions, so they were left untouched; the flags are now documented as experimental/reserved instead.
- **2.8** (agent-status rendering) and **4.2** (hardcoded indexing status) — cosmetic / low-impact; left for a UX pass.

---

## Category 1 — STUB / PLACEHOLDER IMPLEMENTATIONS

**No pure stubs found.** The app code contains no empty `pass` bodies, no `throw new Error("not implemented")`, and no abstract methods without a concrete implementation. The closest thing to a stub is a deliberately self-failing code path (see **2.1**), which fails loudly rather than silently.

---

## Category 2 — INCOMPLETE WIRING / HALF-FINISHED FEATURES (highest runtime impact)

These are the most important: they define a feature surface that is reachable but does not actually do what it implies, so the failure can be silent or confusing.

### 2.1 Prepared-agent-session launcher is never wired — durable sessions always fail
- **Files:**
  - `packages/backend/src/sessions/prepared-session-service.ts:219-230` (explicit fail-and-throw branch when `launchAgent` is absent)
  - `packages/backend/src/orchestrator/mission-queue-handlers.ts:31,54-59` (`launchAgent?: LaunchAgent` forwarded as optional)
  - `packages/backend/src/server.ts:232-237` (calls `createMissionQueueHandlers({ pool, sessions, queue, messages })` **without `launchAgent`**)
- **Category:** half-finished / incomplete-wiring
- **Intended purpose:** queue-backed launching of "prepared" agent sessions — the entire `AUREX_DURABLE_QUEUE_ENABLED` / `AUREX_PREPARED_SESSIONS_ENABLED` subsystem (`routes/agent-sessions.ts`, `routes/execution-queue.ts`, `sessions/*`, `queue/*`).
- **Why broken:** `launchAgent` is supplied **only in tests**. In production no launcher is registered, so any `agent_session_start` / `agent_session_resume` job hits the fail branch and the session ends `failed` with `"Agent launcher not wired — durable session start is not yet connected to a real agent process."` The REST routes (`prepare`/`start`/`cancel`/`messages`) all work, but no agent process is ever launched. The feature is gated behind default-off, undocumented flags and is documented as "Reserved" (`docs/api.md:321-323`).
- **Suggested fix:** Either (a) wire a real `launchAgent` (drive a Pi agent process via the spawner in `agent-spawner.ts`) in `server.ts`, or (b) if this is intentionally deferred, mark the routes experimental and short-circuit `start` with a clear 501 until the launcher exists, so callers don't observe a "queued → failed" cycle.

### 2.2 Stale-reconciler watchdog is never scheduled — dead sessions/jobs hang forever
- **Files:**
  - `packages/backend/src/queue/stale-reconciler.ts:60` (`export async function reconcileStaleWork`)
  - `packages/backend/src/routes/execution-queue.ts:43-60` (the only non-test caller — a manual `POST /api/execution-queue/reconcile`)
- **Category:** incomplete-wiring (background job defined but never scheduled)
- **Intended purpose:** detect claimed/running jobs and starting/running sessions whose heartbeats expired, then requeue / fail / mark-lost so dead work doesn't strand missions.
- **Why broken:** `reconcileStaleWork` is invoked from exactly one place — the manual reconcile REST endpoint. Repo-wide grep for `setInterval|cron|scheduler` near the reconciler returns nothing; the `AUREX_STALE_RECONCILER_ENABLED` flag only toggles dry-run vs active on that manual route (`server.ts:252`), it does **not** start a timer. So a session marked `running` with a dead agent, or a stuck `claimed` job, is never reclaimed automatically.
- **Suggested fix:** Start a periodic `setInterval(reconcileStaleWork, …)` in `server.ts` when `staleReconcilerEnabled` is on (mirroring the self-update interval in `routes/update.ts:88`), or document that reconciliation is manual-only.

### 2.3 Five durable job types have handlers but are never enqueued
- **Files:**
  - Handlers: `packages/backend/src/orchestrator/mission-queue-handlers.ts:63-96` (`mission_start`, `mission_resume`, `mission_abort`, `agent_session_resume`, `agent_session_cancel`)
  - Only production enqueue: `packages/backend/src/sessions/prepared-session-service.ts:138-146` (type `agent_session_start`)
- **Category:** incomplete-wiring (queue job types declared & handled but never enqueued)
- **Intended purpose:** an async, queue-backed alternative to the synchronous REST/mission-pool path for mission lifecycle and session resume/cancel.
- **Why broken:** grep for `enqueue(` across backend `src` shows the **only** production enqueue is `agent_session_start`. The 5 handlers above are unreachable at runtime, and there is **no enqueue REST endpoint** (`routes/execution-queue.ts` exposes only `GET /api/execution-queue` and `POST /reconcile`). (The 3 "inline-owned" types `validator_start` / `checkpoint_timeout` / `stale_reconciliation` are intentionally fail-fast by design and are **not** findings.) Together with 2.1/2.2, the durable execution control plane is effectively inert.
- **Suggested fix:** Either enqueue these job types on the relevant REST/loop paths, or remove the handlers and document the queue as single-purpose until the migration is done.

### 2.4 WebSocket events emitted by the backend but never handled by the frontend
- **Files:**
  - `execution_job_claimed` — defined `packages/shared/src/events.ts:133-138`, emitted `packages/backend/src/queue/execution-worker.ts:33-38`; **0** frontend references.
  - `stale_reconciliation_completed` — defined `packages/shared/src/events.ts:139`, emitted `packages/backend/src/routes/execution-queue.ts:57`; **0** frontend references.
- **Category:** incomplete-wiring (events emitted but no consumer)
- **Why broken:** the literals never appear in `packages/frontend`, so the dashboard silently ignores both. (Also compounding: the emitting worker only exists when `AUREX_DURABLE_QUEUE_ENABLED=true`, which is off by default.)
- **Suggested fix:** add handlers in the relevant frontend hook (e.g. a toast/log line in the debug log) **or** drop the emissions if the UI doesn't need them.

### 2.5 `bumblebeeRunner.cancelScan` is implemented but has no HTTP route
- **Files:** impl `packages/backend/src/orchestrator/bumblebee-runner.ts:212-220` (+ interface `:21`); route file `packages/backend/src/routes/bumblebee.ts` (no DELETE/cancel endpoint).
- **Category:** half-finished
- **Intended purpose:** cancel an in-flight Bumblebee supply-chain scan.
- **Why broken:** `cancelScan` is implemented and tested, but `routes/bumblebee.ts` only exposes status / trigger / list / get-scan / catalog — there is no way to reach `cancelScan` from the API. `server.ts:214` injects `bumblebeeRunner` but the cancel capability is unreachable.
- **Suggested fix:** add `app.delete("/api/missions/:missionId/scans/:scanId", …)` delegating to `bumblebeeRunner.cancelScan`, or drop the method.

### 2.6 `POST /api/github/config` + frontend `saveGitHubConfig` exist but no UI calls them
- **Files:** route `packages/backend/src/routes/github.ts:95`; client `packages/frontend/src/api.ts:152-160` (+ `GitHubConfigPayload` at `:137-144`).
- **Category:** incomplete-wiring
- **Intended purpose:** save GitHub App credentials (`appId/clientId/clientSecret/privateKey/…`) from the UI.
- **Why broken:** the backend route and the frontend client function both exist and are tested, but `hooks/useGitHub.ts` does **not** import `saveGitHubConfig` and `IntegrationsPanel.tsx` only offers OAuth connect/disconnect. So the endpoint and client are wired to nothing in the app.
- **Suggested fix:** add a credentials form in the Integrations GitHub tab, or remove the route + client if OAuth-only is the intended UX.

### 2.7 Environment variables referenced in code but missing from `.env.example`
- **Files:** `packages/backend/src/config.ts:78,119-128`; `packages/backend/src/server.ts:86`; config doc `packages/backend/src/config.ts`.
- **Category:** incomplete-wiring (config referenced but undocumented/unsurfaced)
- **Missing vars:** `AUTH_DISABLED`, `AUREX_DURABLE_QUEUE_ENABLED`, `AUREX_PREPARED_SESSIONS_ENABLED`, `AUREX_STALE_RECONCILER_ENABLED`, `AUREX_STALE_RECONCILER_DRY_RUN`, `AUREX_QUEUE_WORKER_POLL_MS`, `AUREX_QUEUE_WORKER_ID`, `PI_AGENT_DIR`.
- **Why broken:** none of these appear in the only `.env*` file in the repo (`.env.example`). The three `AUREX_*` subsystem flags default to `false` and are only mentioned in `docs/api.md` as "Reserved", so the entire durable-control-plane feature (2.1–2.4) is invisible unless an operator discovers the flags by reading source.
- **Suggested fix:** add the missing keys (with their defaults and a note that they're experimental/reserved) to `.env.example` and `docs/configuration.md`.

### 2.8 Agent statuses emitted by the backend with no dedicated frontend handling (low)
- **Files:** `packages/shared/src/enums.ts:25-26` (`AgentStatus` members `"reviewing"`, `"researching"`), emitted in `packages/backend/src/orchestrator/milestone-loop.ts:240,841`; `packages/frontend/src/passive/MissionPipeline.tsx:44-48,352` (`workerStatusColor` map has no entry for them).
- **Category:** incomplete-wiring (soft — status renders with the muted fallback color)
- **Why broken:** these statuses flow through `useMission.ts:289` (cast to a worker status) but the color/animation maps in `MissionPipeline.tsx` only cover `spawned|working|committing|timed_out|…`, so reviewing/researching agents render with `var(--text-muted)` and no animation. Cosmetic, not a silent failure.
- **Suggested fix:** add color/animation entries for the two statuses, or collapse them into an existing bucket.

---

## Category 3 — DEAD / UNREACHABLE CODE (zero production references)

### 3.1 Entire modules never imported anywhere
| File | Dead symbols | Evidence |
|---|---|---|
| `packages/backend/src/queue/failure-codes.ts` | `RETRYABLE_FAILURES`, `isRetryableFailure`, `attemptsExhausted` (whole file) | 0 refs anywhere (not even tests). Retry logic is done inline via `attempt >= maxAttempts`. |
| `packages/backend/src/queue/execution-queue-service.ts` | `ExecutionQueueService`, `createExecutionQueueService` (whole file) | 0 refs anywhere. `server.ts:51` constructs the store directly. |

**Suggested fix:** delete both files.

### 3.2 Dead backend exports with zero non-test references
| File:Line | Symbol | Evidence |
|---|---|---|
| `packages/backend/src/orchestrator/milestone-validator-verdicts.ts:117` | `recordValidatorCapFailure` | 0 refs anywhere (no app, no test). |
| `packages/backend/src/orchestrator/overlap.ts:91` | `computePostCommitScope` | 0 refs anywhere. (`milestone-loop.ts` uses only `checkPreSpawnOverlap`.) |

**Suggested fix:** delete both functions (or wire `computePostCommitScope` into the post-commit validation path it was intended for).

### 3.3 Backend exports referenced **only** by tests (never by the running app)
| File:Line | Symbol | Notes |
|---|---|---|
| `packages/backend/src/enforcement/branch-guard.ts:8,12` | `isBranchAllowed`, `validateCommitBranch` | Real enforcement is a shell `pre-commit` hook generated inline in `orchestrator/worktree.ts:212-248`; this TS module is orphaned from runtime. |
| `packages/backend/src/enforcement/contract-immutability.ts:16,39` | `validateContractAppend`, `validateSupersede` | `planner.ts:5` explicitly states *"validateContractAppend is intentionally NOT called here"*; the supersede path calls `lapis.supersedeContract` directly. |
| `packages/backend/src/enforcement/enforcement-gate.ts:6` | `enforceBroadcastTransition` | Sibling `enforceResearchTransition` (same file) **is** used (`agents/worker-tools.ts:292`); the broadcast variant has no caller. |
| `packages/backend/src/enforcement/quota-gate.ts:143` | `getQuotaStatusDisplay` | Superseded by per-provider `getProviderStatusDisplay` (used by `routes/quota.ts` + `clients/pinyx-quota-wrapper.ts`). |
| `packages/backend/src/orchestrator/overlap.ts:105` | `detectOverlap` | Replaced by `checkPreSpawnOverlap`. |
| `packages/backend/src/agents/agent-logger.ts:80` | `AgentLogger.getRecent` | App reads logs via `agentLogger.getEntries` (`routes/missions.ts:299`). |
| `packages/backend/src/agents/agent-spawner.ts:702` | `getActiveCount` (and `getActiveSessions`) | Only exercised by `__tests__/agents/agent-spawner.test.ts`; the pool doesn't expose/use them. |
| `packages/backend/src/agents/factory.ts:12,24` | `AGENT_SKILL`, `resolveModel` | Skills are injected via `skillsOverride` in `agent-spawner.ts`; models via `resolvePinyxModel`. |

**Suggested fix:** delete, or wire them into the runtime path they were meant to serve (esp. `branch-guard.ts` / `contract-immutability.ts` — having an un-enforced enforcement module is misleading).

### 3.4 Dead frontend exports
**Zero references anywhere (incl. tests):**
| File:Line | Symbol |
|---|---|
| `packages/frontend/src/api.ts:389` | `triggerRepoScan` |
| `packages/frontend/src/api.ts:409` | `getBumblebeeStatus` |
| `packages/frontend/src/api.ts:434` | `getScanResults` |
| `packages/frontend/src/api.ts:440` | `getExposureCatalog` |
| `packages/frontend/src/api.ts:446` | `saveExposureCatalog` |
| `packages/frontend/src/animations/state-transitions.ts:12` | `exitActive` (plan doc confirms "no longer imported") |

**Test-only (never used by the app):**
| File:Line | Symbol |
|---|---|
| `packages/frontend/src/api.ts:52` | `getCurrentMission` (app hydrates via `getActiveMissions` + `getMission`) |
| `packages/frontend/src/api.ts:152` | `saveGitHubConfig` (see 2.6) |

**Suggested fix:** delete the dead exports; for `getCurrentMission`/`saveGitHubConfig` either wire them or drop them.

### 3.5 Returned-but-unused hook action
- `packages/frontend/src/hooks/useMissions.ts:199-215` — `removeMission` is built and returned by the hook, but its sole consumer `App.tsx:75` does not destructure it. **Suggested fix:** remove it or consume it.

### 3.6 Dead `@aurex/shared` exports (zero references outside `shared/src`)
**Types/interfaces:**
| File:Line | Symbol |
|---|---|
| `packages/shared/src/types.ts:516` | `AgentSpec` (fully orphaned) |
| `packages/shared/src/types.ts:348,346` | `PlannedMilestone`, `PlannedWorkingUnit` (`planner.ts` defines its own `PlannedMilestoneRaw`) |
| `packages/shared/src/events.ts:142,164,168` | `StreamingChunk`, `WsServerMessage`, `WsClientMessage` (transport uses `WsClientEvent` + a backend `SequencedEvent` shape) |
| `packages/shared/src/rest.ts:32,103,131` | `AgentSessionMessageResponse`, `TriggerScanRequest`, `ExposureCatalogResponse` (routes inline these shapes) |

**Test-only (`packages/shared/__tests__/types.test.ts` only):** `CreateMissionRequest` (`rest.ts:47`), `CheckpointRequest` (`rest.ts:63`).

### 3.7 Dead enum members (defined, never produced or consumed)
- **`ExecutionFailureCode`** (`packages/shared/src/enums.ts:142-158`) — 7 members appear **only** in the definition: `MISSION_NO_PROGRESS`, `WORKTREE_PREP_FAILED`, `REPO_PREP_FAILED`, `SETUP_COMMAND_FAILED`, `QUOTA_EXHAUSTED`, `VALIDATION_TIMEOUT`, `USER_ABORTED`. (The other codes — `CLAIM_EXPIRED`, `HEARTBEAT_TIMEOUT`, `SESSION_START_TIMEOUT`, `SESSION_LOST`, `MAX_ATTEMPTS_EXHAUSTED`, `UNKNOWN` — are produced by `stale-reconciler.ts` / failure sites.)
- **`PreparedAgentRole`** (`packages/shared/src/enums.ts:101-108`) — 3 members appear **only** in the definition: `researcher`, `merge_manager`, `final_audit`. (Used roles: `orchestrator`, `worker`, `validator_scrutiny`, `validator_user_testing`.)

**Suggested fix:** prune the unused members (or implement the failure paths / agent roles they describe).

---

## Category 4 — HALF-FINISHED / BROKEN REFERENCES

### 4.1 Broken type import in a test (non-existent shared export)
- **File:** `packages/backend/__tests__/worker-finding-tools.test.ts:2`
  ```ts
  import type { ResearchFinding, LaPisClient as _LC } from "@aurex/shared";
  ```
- **Category:** half-finished / broken import
- **Why broken:** `LaPisClient` is **not** exported by `@aurex/shared` (it's a backend-local interface in `packages/backend/src/clients/lapis-client.ts`, correctly imported at line 10 of the same test). The dangling `_LC` alias is never used. This survives because Vitest runs tests via esbuild (strips types without checking); a strict `tsc` over test files would flag it (TS2305).
- **Suggested fix:** remove the `LaPisClient as _LC` member from the shared import.

### 4.2 `/api/github/repos/prepare` hardcodes indexing as `"unavailable"` (low)
- **File:** `packages/backend/src/routes/github.ts:261-262`
- **Category:** half-finished (likely intentional deferral)
- **Why it looks incomplete:** returns `indexed: false, indexingStatus: "unavailable"` after cloning; real indexing happens later in `mission-runner.ts` via `lapis.indexRepo`. Probably deliberate, flagged only because the literal implies an unfinished status integration.

---

## Summary

| Severity | Count | Examples |
|---|---|---|
| **Silent failure / missing feature** | 4 | durable session launcher unwired (2.1); reconciler never scheduled (2.2); job types never enqueued (2.3); unhandled WS events (2.4) |
| **Half-finished / unreachable capability** | 4 | `cancelScan` (2.5); `saveGitHubConfig` (2.6); missing env vars (2.7); broken test import (4.1) |
| **Definitely dead code** | many | two whole queue modules (3.1); dead exports across backend/frontend/shared (3.2–3.7) |
| **Low / cosmetic** | 2 | agent-status rendering (2.8); hardcoded indexing status (4.2) |

**Stubs:** none (the app has no `pass`/`throw not implemented`/placeholder-return bodies; the durable-session path fails loudly by design).
