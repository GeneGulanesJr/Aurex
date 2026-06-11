# Prepared Agent Sessions + Durable Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Aurex's in-process-only mission dispatch path with a durable execution control plane built from prepared agent sessions, persisted queue jobs, and stale-work reconciliation. The first rollout keeps the existing mission API stable while moving mission start, worker launch, validator launch, heartbeat tracking, and stuck-work recovery into durable state.

**Architecture:** Add a `sessions` domain for prepared agent sessions and a `queue` domain for durable execution jobs. `POST /api/missions` still returns `{ missionId, status }`, but internally creates a `mission_start` queue job instead of relying only on `MissionRunnerPool.submit`. Queue workers claim jobs with claim tokens, update heartbeats, prepare/start agent sessions, and transition jobs to terminal states. A stale reconciler scans queue jobs and prepared sessions for expired claims, missing heartbeats, and no-progress missions, then requeues, marks lost, fails terminally, or escalates to a checkpoint.

**Tech Stack:** TypeScript, Fastify, Vitest, existing LaPis client/shared-state API, existing WebSocket mission event stream, existing mission runner/orchestrator modules.

**Repo root:** `/workspace/Aurex/`

**Reviewer update:** This PR is intentionally a design-plan PR, not the runtime implementation. The first executable implementation should stop at shared contracts, stores/services, dry-run reconciliation, and tests with all behavior-changing feature flags defaulted off. Any follow-up PR that changes `POST /api/missions` dispatch must include a direct-runner fallback and restart/stale-work integration tests before enabling the durable path by default.

**Primary constraints:**

- Preserve the public mission creation API and dashboard behavior during early rollout.
- Keep direct runner fallback available behind a feature flag until the durable path proves stable.
- Never auto-retry ambiguous work after file changes or partial handoff evidence; escalate instead.
- Use structured failure codes everywhere instead of opaque strings.

---

## Background

Current state verified in this repo:

- `docs/api.md` documents `POST /api/missions` as creating a mission in LaPis and submitting it to the in-process mission runner pool.
- `packages/shared/src/types.ts` has `AgentSessionRecord`, but it only captures spawned/terminated audit metadata and is not sufficient as a durable prepared-session source of truth.
- `packages/backend/src/orchestrator/mission-runner-pool.ts`, `mission-runner.ts`, `milestone-loop.ts`, and `agents/agent-spawner.ts` are the core integration points for session preparation and launch.
- `packages/backend/src/ws/events.ts` already owns the live event stream used by the dashboard.

---

## Target flow

```text
POST /api/missions
  -> create mission in LaPis
  -> create execution_queue_jobs(type = mission_start, status = queued)
  -> durable queue worker claims mission_start with claimToken
  -> durable mission runner plans/reconciles mission work
  -> runner creates prepared_agent_sessions for workers/validators/researchers
  -> runner queues agent_session_start jobs
  -> agent start job launches the concrete Pi SDK/agent process
  -> session heartbeats and lifecycle events update durable state
  -> stale reconciler repairs, retries, marks lost, or escalates stuck work
```

---

## State machines

### Prepared agent session states

| State               | Meaning                                                           | Terminal? |
| ------------------- | ----------------------------------------------------------------- | --------: |
| `prepared`          | Durable config exists, but no launch job is queued.               |        No |
| `queued`            | A start/resume job exists for the session.                        |        No |
| `starting`          | A queue worker is launching the underlying agent process/session. |        No |
| `running`           | The agent is active and heartbeating.                             |        No |
| `waiting_for_input` | The agent is blocked on checkpoint/user/system input.             |        No |
| `completed`         | Agent completed successfully.                                     |       Yes |
| `failed`            | Agent failed terminally.                                          |       Yes |
| `cancelled`         | User/system cancelled the session.                                |       Yes |
| `lost`              | Heartbeat disappeared and the session cannot be safely resumed.   |       Yes |

Allowed transitions:

```text
prepared -> queued -> starting -> running -> completed
prepared -> queued -> starting -> failed
running -> waiting_for_input -> running
running -> failed
running -> lost
queued -> cancelled
starting -> cancelled
running -> cancelled
```

### Execution queue job states

| State       | Meaning                                                            | Terminal? |
| ----------- | ------------------------------------------------------------------ | --------: |
| `queued`    | Due or future work waiting to be claimed.                          |        No |
| `claimed`   | Worker has reserved the job but has not started execution.         |        No |
| `running`   | Worker is executing and heartbeating.                              |        No |
| `succeeded` | Job completed successfully.                                        |       Yes |
| `failed`    | Job failed terminally.                                             |       Yes |
| `cancelled` | Job cancelled by user/system.                                      |       Yes |
| `stale`     | Reconciler detected stale ownership.                               |        No |
| `requeued`  | Historical marker before creating/updating a fresh queued attempt. |        No |

Allowed transitions:

```text
queued -> claimed -> running -> succeeded
queued -> claimed -> running -> failed
queued -> claimed -> stale -> queued
running -> stale -> queued
queued -> cancelled
claimed -> cancelled
running -> cancelled
```

---

## Shared type additions

**Files:**

- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/rest.ts`

- [ ] **Step 1: Add enum/string-union exports**

Add shared status/failure-code exports:

```ts
export type PreparedAgentRole =
  | "orchestrator"
  | "researcher"
  | "worker"
  | "validator_scrutiny"
  | "validator_user_testing"
  | "merge_manager"
  | "final_audit";

export type PreparedAgentSessionStatus =
  | "prepared"
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

export type ExecutionJobType =
  | "mission_start"
  | "mission_resume"
  | "mission_abort"
  | "agent_session_start"
  | "agent_session_resume"
  | "agent_session_cancel"
  | "validator_start"
  | "checkpoint_timeout"
  | "stale_reconciliation";

export type ExecutionJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale"
  | "requeued";

export type ExecutionFailureCode =
  | "CLAIM_EXPIRED"
  | "HEARTBEAT_TIMEOUT"
  | "SESSION_START_TIMEOUT"
  | "SESSION_LOST"
  | "MISSION_NO_PROGRESS"
  | "WORKTREE_PREP_FAILED"
  | "REPO_PREP_FAILED"
  | "SETUP_COMMAND_FAILED"
  | "PINYX_UNAVAILABLE"
  | "LAPIS_UNAVAILABLE"
  | "QUOTA_EXHAUSTED"
  | "MODEL_UNAVAILABLE"
  | "VALIDATION_TIMEOUT"
  | "USER_ABORTED"
  | "MAX_ATTEMPTS_EXHAUSTED"
  | "UNKNOWN";
```

- [ ] **Step 2: Add durable record types**

Add `PreparedAgentSession`, `PreparedAgentSessionConfig`, `ExecutionQueueJob`, and `ReconciliationRunSummary` to `packages/shared/src/types.ts`.

Required fields:

- mission/milestone/unit linkage
- role/status
- model/provider
- repo/branch/worktree
- prompt/system prompt reference
- env var map and secret refs
- setup commands and allowed tool/MCP config placeholders
- queue job linkage
- timestamps (`createdAt`, `queuedAt`, `startedAt`, `lastHeartbeatAt`, `completedAt`)
- failure code/message
- attempt/maxAttempts
- claim token metadata for jobs

- [ ] **Step 3: Add WebSocket event variants**

Add events for:

- `agent_session_prepared`
- `agent_session_queued`
- `agent_session_started`
- `agent_session_heartbeat`
- `agent_session_completed`
- `agent_session_failed`
- `agent_session_lost`
- `execution_job_queued`
- `execution_job_claimed`
- `execution_job_requeued`
- `execution_job_failed`
- `stale_reconciliation_completed`

- [ ] **Step 4: Add REST shapes**

Add request/response types for:

- `POST /api/agent-sessions/prepare`
- `POST /api/agent-sessions/:sessionId/start`
- `GET /api/agent-sessions/:sessionId`
- `POST /api/agent-sessions/:sessionId/messages`
- `POST /api/agent-sessions/:sessionId/cancel`
- `GET /api/execution-queue`
- `POST /api/execution-queue/reconcile`

- [ ] **Step 5: Test shared package**

Run:

```bash
cd /workspace/Aurex
pnpm --filter @aurex/shared run typecheck
pnpm --filter @aurex/shared test
```

Expected: shared typecheck and tests pass.

---

## Backend module map

**Files to create:**

| File                                                          | Purpose                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/backend/src/sessions/prepared-session-types.ts`     | Backend-only helper types and transition guards.                |
| `packages/backend/src/sessions/prepared-session-store.ts`     | LaPis-backed persistence adapter for prepared sessions.         |
| `packages/backend/src/sessions/prepared-session-service.ts`   | Prepare/start/cancel/message business logic.                    |
| `packages/backend/src/sessions/session-heartbeat.ts`          | Heartbeat update helpers and timeout calculations.              |
| `packages/backend/src/sessions/session-recovery.ts`           | Safe retry/resume/lost classification helpers.                  |
| `packages/backend/src/queue/queue-types.ts`                   | Backend-only queue helper types.                                |
| `packages/backend/src/queue/failure-codes.ts`                 | Failure-code classification and retryability helpers.           |
| `packages/backend/src/queue/execution-queue-store.ts`         | LaPis-backed queue persistence and atomic-ish claim operations. |
| `packages/backend/src/queue/execution-queue-service.ts`       | Enqueue, claim, heartbeat, complete, fail, requeue API.         |
| `packages/backend/src/queue/execution-worker.ts`              | Polling worker that runs due queue jobs.                        |
| `packages/backend/src/queue/stale-reconciler.ts`              | Stale scan and remediation logic.                               |
| `packages/backend/src/routes/agent-sessions.ts`               | Session debug/admin API.                                        |
| `packages/backend/src/routes/execution-queue.ts`              | Queue debug/admin API.                                          |
| `packages/backend/src/orchestrator/durable-mission-runner.ts` | Adapter from queue jobs into existing mission-runner behavior.  |

**Files to modify:**

| File                                                       | Change                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/backend/src/server.ts`                           | Register routes and start/stop queue worker if feature flag enabled. |
| `packages/backend/src/routes/missions.ts`                  | Enqueue `mission_start` instead of direct pool submit when enabled.  |
| `packages/backend/src/orchestrator/mission-runner-pool.ts` | Keep fallback path and expose compatibility adapter.                 |
| `packages/backend/src/orchestrator/mission-runner.ts`      | Prepare sessions at worker/validator launch boundaries.              |
| `packages/backend/src/orchestrator/milestone-loop.ts`      | Queue worker/validator session starts.                               |
| `packages/backend/src/agents/agent-spawner.ts`             | Start prepared sessions and emit heartbeat hooks.                    |
| `packages/backend/src/ws/events.ts`                        | Broadcast new session/queue/reconciliation events.                   |
| `packages/backend/src/clients/lapis-client.ts`             | Add prepared session and queue persistence methods.                  |
| `docs/api.md`                                              | Document new admin/debug APIs and durable dispatch behavior.         |

---

## Persistence contract

The implementation should prefer LaPis-backed persistence so state survives backend restarts. If LaPis lacks a needed compare-and-set operation, implement a narrow adapter method first and keep the backend store interface stable.

Before active queue rollout, verify whether LaPis can support compare-and-set semantics for queue claims. If it cannot, add a small LaPis endpoint/operation for conditional `status + claimToken` updates rather than emulating locks only in Aurex memory.

### `prepared_agent_sessions`

Required indexes or query paths:

- `id`
- `mission_id`
- `milestone_id`
- `unit_id`
- `status`
- `last_heartbeat_at`
- `queue_job_id`

### `execution_queue_jobs`

Required indexes or query paths:

- `status, run_after, priority, created_at`
- `mission_id`
- `session_id`
- `claimed_by`
- `heartbeat_at`

### `session_events` optional table/resource

Append-only session lifecycle events. Useful for audit and replay, but not required in the first active rollout if WebSocket/mission activity already captures the same information.

### `reconciliation_runs` optional table/resource

Stores stale scan summaries for operations/debugging.

---

## Implementation cutline for the first code PR

The first code PR should be deliberately smaller than the full architecture. It should include only:

- shared type/event/REST contracts,
- queue and prepared-session store interfaces,
- in-memory fake stores for deterministic tests,
- LaPis-backed store adapters where current LaPis APIs are sufficient,
- claim-token transition helpers,
- dry-run stale reconciliation,
- admin/debug route skeletons if they can be added without changing mission behavior.

It should not include:

- default durable dispatch for `POST /api/missions`,
- dashboard changes,
- active stale-work mutation,
- validator/researcher migration,
- secret/env/MCP runtime injection.

Exit criteria for the first code PR:

- all new behavior is behind flags defaulted off,
- state transition helpers have unit coverage,
- stale reconciliation dry-run uses a fixed-clock test,
- no existing mission route behavior changes when flags are unset.

---

## Queue claiming and lock rules

- [ ] **Step 1: Implement claim token generation**

Use a cryptographically random claim token per claim attempt.

- [ ] **Step 2: Implement claim operation**

Claim only jobs where:

- `status = "queued"`
- `runAfter <= now`
- attempts remain

Claim mutation must set:

- `status = "claimed"`
- `claimToken`
- `claimedBy`
- `claimedAt`
- `heartbeatAt`
- `updatedAt`

- [ ] **Step 3: Enforce claim token on mutations**

The following operations must require the active claim token:

- mark running
- heartbeat
- succeed
- fail
- requeue from claimed/running

- [ ] **Step 4: Add duplicate-claim tests**

Two workers attempting to claim the same queued job must result in exactly one winner.

---

## Stale reconciliation policy

Initial thresholds:

| Object    | State                  |                   Stale after | Action                                                   |
| --------- | ---------------------- | ----------------------------: | -------------------------------------------------------- |
| Queue job | `claimed`              |                     2 minutes | release claim and requeue with `CLAIM_EXPIRED`           |
| Queue job | `running`              |   5 minutes without heartbeat | requeue if safe/attempts remain; otherwise fail          |
| Session   | `starting`             |                     5 minutes | fail attempt with `SESSION_START_TIMEOUT`; retry if safe |
| Session   | `running`              |  10 minutes without heartbeat | mark `lost`; escalate unless explicitly resumable        |
| Mission   | running with no events |                    15 minutes | create checkpoint/escalation                             |
| Validator | running                | validator timeout from config | fail validator attempt                                   |

- [ ] **Step 1: Implement dry-run reconciler**

Dry-run mode returns actions without mutating state:

```ts
{
  scanned: number;
  wouldRequeue: number;
  wouldMarkLost: number;
  wouldFail: number;
  wouldEscalate: number;
  actions: Array<{
    targetType: "queue_job" | "agent_session" | "mission";
    targetId: string;
    action:
      | "release_claim"
      | "requeue"
      | "mark_lost"
      | "fail_terminal"
      | "escalate_to_user";
    failureCode: ExecutionFailureCode;
    reason: string;
  }>;
}
```

- [ ] **Step 2: Enable active safe actions**

After dry-run tests pass, enable active mutation for:

- releasing expired claims
- requeueing never-started jobs
- failing jobs with exhausted attempts

- [ ] **Step 3: Escalate ambiguous sessions**

Do not auto-retry a lost session if:

- the worktree has changes,
- a handoff exists,
- commits exist on the task branch,
- validator output exists,
- checkpoint/user action is pending.

Instead, mark `lost` and create an escalation checkpoint.

---

## Feature flags

Add config flags with conservative defaults:

```text
AUREX_DURABLE_QUEUE_ENABLED=false
AUREX_PREPARED_SESSIONS_ENABLED=false
AUREX_STALE_RECONCILER_ENABLED=false
AUREX_STALE_RECONCILER_DRY_RUN=true
AUREX_QUEUE_WORKER_POLL_MS=1000
AUREX_QUEUE_WORKER_ID=<hostname/pid/random>
```

Rollout order:

1. types/stores with all flags off
2. dry-run reconciler with no behavior change
3. durable queue for mission start only
4. prepared sessions for workers
5. prepared sessions for validators
6. active reconciler safe actions
7. dashboard surfacing

---

## API additions

### `POST /api/agent-sessions/prepare`

Prepare a session without starting it.

Response:

```json
{ "sessionId": "session_123", "status": "prepared" }
```

### `POST /api/agent-sessions/:sessionId/start`

Queue a prepared session for startup.

Response:

```json
{ "sessionId": "session_123", "queueJobId": "job_123", "status": "queued" }
```

### `GET /api/agent-sessions/:sessionId`

Inspect session state.

### `POST /api/agent-sessions/:sessionId/messages`

Send follow-up input to a running or waiting session.

### `POST /api/agent-sessions/:sessionId/cancel`

Cancel a prepared/queued/running/waiting session.

### `GET /api/execution-queue`

Inspect queue state with filters for `status`, `missionId`, and `sessionId`.

### `POST /api/execution-queue/reconcile`

Trigger stale reconciliation manually. Request should support `{ "dryRun": true }`.

---

## Implementation tasks

### Task 1: Shared contracts

- [ ] Add status/failure-code unions.
- [ ] Add durable prepared-session and execution-job record types.
- [ ] Add REST request/response shapes.
- [ ] Add WebSocket event variants.
- [ ] Add shared type tests or compile-only assertions.
- [ ] Run shared typecheck/tests.

### Task 2: Queue store and state transitions

- [ ] Create queue store interface.
- [ ] Implement in-memory fake for tests.
- [ ] Implement LaPis-backed store methods.
- [ ] Add enqueue/claim/heartbeat/succeed/fail/requeue/cancel methods.
- [ ] Enforce claim token checks.
- [ ] Test invalid transitions and duplicate claim behavior.

### Task 3: Prepared session store and service

- [ ] Create prepared session store interface.
- [ ] Implement prepare/start/cancel/message lifecycle methods.
- [ ] Link session `queueJobId` on start.
- [ ] Add heartbeat update helper.
- [ ] Test state transitions and retry metadata.

### Task 4: Queue worker

- [ ] Add polling worker with graceful startup/shutdown.
- [ ] Add worker ID generation.
- [ ] Dispatch `mission_start` to durable mission runner.
- [ ] Dispatch `agent_session_start` to prepared session launcher.
- [ ] Emit queue lifecycle WebSocket events.
- [ ] Add worker unit tests using fake stores.

### Task 5: Durable mission runner adapter

- [ ] Create adapter that can run a mission from a `mission_start` queue job.
- [ ] Preserve current mission runner behavior behind the adapter.
- [ ] Prepare worker sessions at worker launch boundary.
- [ ] Prepare validator sessions at validator launch boundary, initially behind a separate flag if needed.
- [ ] Keep direct `MissionRunnerPool.submit` fallback when durable queue is disabled.

### Task 6: Stale reconciler

- [ ] Implement dry-run scan for queue jobs and sessions.
- [ ] Add manual route for dry-run reconciliation.
- [ ] Add active release/requeue/fail actions behind flags.
- [ ] Add escalation hook for lost/ambiguous sessions.
- [ ] Emit reconciliation summary event.
- [ ] Test stale thresholds with fixed clocks.

### Task 7: API routes and docs

- [ ] Add `agent-sessions` route.
- [ ] Add `execution-queue` route.
- [ ] Register routes in `server.ts`.
- [ ] Document routes and feature flags in `docs/api.md` or a new durable execution doc.
- [ ] Add REST route tests.

### Task 8: Integration tests

- [ ] `POST /api/missions` creates a `mission_start` job when durable queue is enabled.
- [ ] Queue worker claims mission job once.
- [ ] Mission job prepares at least one worker session.
- [ ] Worker session start creates/uses `agent_session_start` job.
- [ ] Heartbeats prevent stale marking.
- [ ] Missing heartbeat triggers dry-run stale action.
- [ ] Exhausted attempts fail and escalate.

---

## Acceptance criteria

### Prepared sessions

- [ ] Worker session can be prepared without launching.
- [ ] Prepared session config is persisted and reloadable.
- [ ] Starting a prepared session creates/links an execution queue job.
- [ ] Session lifecycle emits WebSocket events.
- [ ] Session heartbeat updates durable state.
- [ ] Completed/failed/lost states are persisted.

### Durable queue

- [ ] Mission start is represented as a durable job.
- [ ] Only one worker can claim a queued job.
- [ ] Claim tokens are required for claimed/running mutations.
- [ ] Jobs heartbeat while running.
- [ ] Jobs transition to terminal states.
- [ ] Retries are capped and failure codes are structured.
- [ ] Queue state survives backend restart when LaPis is available.

### Stale reconciliation

- [ ] Stale claimed jobs are requeued or failed according to attempt count.
- [ ] Stale starting sessions are retried or failed.
- [ ] Stale running sessions are marked lost.
- [ ] Ambiguous/lost work escalates to the user rather than being blindly retried.
- [ ] Reconciliation actions are logged and emitted.
- [ ] Reconciliation is covered by unit and integration tests.

---

## Test commands

Run as implementation progresses:

```bash
cd /workspace/Aurex
pnpm --filter @aurex/shared run typecheck
pnpm --filter @aurex/backend run typecheck
pnpm --filter @aurex/backend test
pnpm test
```

If routes or WebSocket events change, also run:

```bash
cd /workspace/Aurex
pnpm run test:e2e
```

---

## Rollback plan

- Keep `AUREX_DURABLE_QUEUE_ENABLED=false` as the default until integration tests pass.
- Preserve the current in-process `MissionRunnerPool.submit` path.
- If queue worker startup fails, log a clear warning and fall back to direct mission submission when explicitly configured.
- Keep stale reconciler dry-run until operators validate emitted actions.
- Make active reconciliation idempotent and claim-token guarded so repeated runs are safe.

---

## Out of scope for the first implementation

- Dashboard UI for queue/session inspection.
- MCP gateway implementation.
- Encrypted secret storage.
- Multi-region distributed scheduling.
- Replacing all validator/researcher launches in the first PR.
- Automatic retry after detected file changes or partial handoffs.
