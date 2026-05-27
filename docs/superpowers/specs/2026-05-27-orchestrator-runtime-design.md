# Orchestrator Runtime Design

Date: 2026-05-27
Status: Approved

## Overview

A deterministic TypeScript state machine that drives the full mission lifecycle as a background async task. Single mission at a time. Created by `POST /api/missions`, returns immediately. Polls LaPis for checkpoint resolutions when paused.

**Not a Pi SDK session.** The planner already calls PiNyx for decomposition, the milestone loop already handles spawning/negotiation. A persistent LLM session would be an expensive wrapper around deterministic code.

## Architecture

```
POST /api/missions
  → LaPis: createMission (status: "planning")
  → Return { missionId, status: "planning" }
  → Background: MissionRunner.start()

MissionRunner.start():
  1. PLANNING phase
     → Planner: decompose mission → milestones → units → contracts
     → LaPis: updateMissionStatus("running")
     
  2. EXECUTION phase  
     → For each milestone:
       → MilestoneLoop.run(mission, [milestone])
       → If checkpoint_needed:
         → Emit WS escalation event
         → Create checkpoint in LaPis
         → Poll for resolution
         → If reject → abort mission
         → If rescope → replan this milestone
         → If approve → continue
       → If failed → update mission status, return
     
  3. COMPLETION
     → LaPis: updateMissionStatus("completed")

Server startup recovery:
  → Check LaPis for paused missions with pending checkpoints
  → Resume the runner from checkpoint
```

## Key Decisions

1. **Deterministic state machine** — no persistent LLM session. Intelligence lives in planner + negotiator.
2. **Background task** — POST returns immediately. Runner is an async function.
3. **Single mission** — runner rejects new missions while one is active.
4. **LaPis polling for checkpoints** — resilient to restarts. Checkpoints stored in LaPis, not in-memory.
5. **Runner owns AppConfig** — passes config through to milestone loop and spawner.

## Milestone Loop Return Type

The milestone loop currently returns `boolean`. It needs to return a richer result:

```typescript
type MilestoneLoopResult = 
  | { status: "completed" }
  | { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string }
  | { status: "failed"; reason: string }
```

This supports all three checkpoint triggers from the spec:
- `milestone_complete` — after negotiation passes, human approves release
- `rescope_limit` — 5x rescope limit hit
- `unclassifiable_error` — unknown verdict state

## Checkpoint Manager

Manages checkpoint lifecycle through LaPis:

```typescript
interface CheckpointRecord {
  id: string;
  missionId: string;
  trigger: CheckpointTrigger;
  milestoneId: string;
  summary: string;
  status: "pending" | "resolved";
  decision?: CheckpointDecision;
  guidance?: string;
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface CheckpointManager {
  create(record: Omit<CheckpointRecord, "id" | "status" | "createdAt">): Promise<string>;
  waitForResolution(checkpointId: string, pollIntervalMs?: number): Promise<CheckpointRecord>;
  resolve(checkpointId: string, decision: CheckpointDecision, guidance?: string, reason?: string): Promise<void>;
  getPendingForMission(missionId: string): Promise<CheckpointRecord[]>;
}
```

### Polling Flow

```typescript
// In mission-runner, when milestone loop returns checkpoint_needed:
const checkpointId = await checkpointManager.create({
  missionId, trigger, milestoneId, summary
});
// Emits WS escalation event to frontend
eventBus.emit({ type: "escalation", missionId, trigger, context: { milestoneId, summary } });

// Polls LaPis every 2s until resolved
const resolved = await checkpointManager.waitForResolution(checkpointId, 2000);

// Process decision
if (resolved.decision === "reject") → abort mission
if (resolved.decision === "rescope") → replan milestone
if (resolved.decision === "approve") → continue to next milestone
```

### Checkpoints Route

The existing `POST /api/missions/:id/checkpoints` route writes the decision to LaPis via `CheckpointManager.resolve()`:

```typescript
// Before: in-memory callback
// After: writes to LaPis
await checkpointManager.resolve(checkpointId, body.decision, body.guidance, body.reason);
```

## Mission Runner

```typescript
interface MissionRunnerConfig {
  lapis: LaPisClient;
  pinyx: PinyxClient;
  eventBus: EventBus;
  config: AppConfig;
  checkpointManager: CheckpointManager;
}

interface RunnerStatus {
  state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed";
  missionId: string | null;
}

class MissionRunner {
  constructor(config: MissionRunnerConfig);
  start(missionId: string): void;        // Fire-and-forget background task
  abort(): void;                          // Cancel running mission
  get status(): RunnerStatus;             // Current state
  getActiveMissionId(): string | null;    // For GET /api/missions/current
}
```

## LaPis Checkpoint API

New endpoints in LaPis HTTP server (PiMemoryExtension):

```
POST   /checkpoints              Create checkpoint (status: pending)
GET    /checkpoints/:id          Get checkpoint (poll for status change)
PATCH  /checkpoints/:id          Resolve checkpoint (writes decision, status: resolved)
GET    /missions/:id/checkpoints Get checkpoints for mission (startup recovery)
GET    /missions?status=pending  List missions by status (for startup recovery)
```

New migration in PiMemoryExtension:

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  guidance TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (mission_id) REFERENCES missions(id)
);
```

## Gated Checkpoint Triggers

The full spec has three checkpoint triggers, but `milestone_complete` requires validator spawning + release branch cutting which aren't built yet. The runner will support all three trigger types in the `MilestoneLoopResult`, but only `rescope_limit` and `unclassifiable_error` will fire in practice until validators are implemented.

- `rescope_limit` — **active now**. Emitted when the negotiator's 5x rescope limit is hit.
- `unclassifiable_error` — **active now**. Emitted when the negotiator hits an unknown verdict state.
- `milestone_complete` — **deferred**. Will fire after validators pass and a release branch is cut, requiring human approval to merge to main. Currently the runner treats a pass verdict as continuing to the next milestone without a checkpoint.

## File Changes

### New Files

| File | Responsibility |
|------|----------------|
| `packages/backend/src/orchestrator/mission-runner.ts` | MissionRunner class — drives planning → execution → completion |
| `packages/backend/src/orchestrator/checkpoint-manager.ts` | Creates checkpoints in LaPis, polls for resolution |
| `packages/backend/__tests__/mission-runner.test.ts` | Lifecycle tests |
| `packages/backend/__tests__/checkpoint-manager.test.ts` | Checkpoint poll/resolve tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/backend/src/orchestrator/milestone-loop.ts` | Return `MilestoneLoopResult` instead of `boolean` |
| `packages/backend/src/server.ts` | Wire MissionRunner — create on POST, inject into routes, startup recovery |
| `packages/backend/src/routes/missions.ts` | Trigger runner on mission creation, return active mission for GET /current |
| `packages/backend/src/routes/checkpoints.ts` | Write decisions to LaPis via CheckpointManager |
| `packages/backend/src/clients/lapis-client.ts` | Add checkpoint methods (createCheckpoint, getCheckpoint, resolveCheckpoint, getPendingCheckpoints, listMissions) |
| `packages/shared/src/types.ts` | Add CheckpointRecord type |
| `PiMemoryExtension: migration + handlers` | Checkpoints table + 4 endpoints + list missions by status endpoint |

## Startup Recovery

On server startup, after LaPis healthcheck passes:

```typescript
// Check for paused missions with pending checkpoints
const pausedMissions = await lapis.listMissions({ status: "paused" });
for (const mission of pausedMissions) {
  const pending = await checkpointManager.getPendingForMission(mission.id);
  if (pending.length > 0) {
    // Resume runner — it will pick up the pending checkpoint
    runner.start(mission.id);
  }
}
```

Note: `listMissions` is a new method on the LaPis client backed by `GET /missions?status=pending` in the LaPis HTTP server.

## What This Does NOT Do

- **No validator spawning** — that's a separate subsystem (validators run after workers merge to develop)
- **No research agent spawning** — separate subsystem
- **No cost tracking integration** — runner emits cost_update events but doesn't parse Pi SDK usage events
- **No state compression** — stubbed in LaPis client
