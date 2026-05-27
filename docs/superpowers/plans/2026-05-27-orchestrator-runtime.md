# Orchestrator Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic mission runner that drives the full lifecycle — planning → execution → checkpointing → completion — connecting `POST /api/missions` to the planner, milestone loop, and checkpoint manager.

**Architecture:** A `MissionRunner` class runs as a background async task. `POST /api/missions` creates the mission in LaPis and returns immediately. The runner picks it up, calls the planner to decompose, then runs the milestone loop for each milestone. When escalation occurs, the runner creates a checkpoint in LaPis, emits a WebSocket escalation event, and polls until the human resolves it. Single mission at a time. Startup recovery checks for paused missions.

**Tech Stack:** TypeScript, Vitest, PiMemoryExtension (CommonJS, Node `http`), Fastify

---

## File Structure

### Aurex (packages/backend)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/orchestrator/checkpoint-manager.ts` | Creates checkpoints in LaPis, polls for resolution |
| Create | `src/orchestrator/mission-runner.ts` | MissionRunner class — drives planning → execution → completion |
| Create | `__tests__/checkpoint-manager.test.ts` | Checkpoint create/poll/resolve tests |
| Create | `__tests__/mission-runner.test.ts` | Lifecycle tests (plan → run → checkpoint → complete) |
| Modify | `src/orchestrator/milestone-loop.ts` | Return `MilestoneLoopResult` instead of `boolean` |
| Modify | `src/clients/lapis-client.ts` | Add checkpoint + listMissions methods |
| Modify | `src/routes/missions.ts` | Trigger runner on create, return active for GET /current |
| Modify | `src/routes/checkpoints.ts` | Write decisions to LaPis via CheckpointManager |
| Modify | `src/server.ts` | Wire MissionRunner, startup recovery |
| Modify | `packages/shared/src/types.ts` | Add CheckpointRecord type |
| Modify | `__tests__/milestone-loop.test.ts` | Update for MilestoneLoopResult return type |
| Modify | `__tests__/milestone-loop-spawn.test.ts` | Update for MilestoneLoopResult return type |

### PiMemoryExtension

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `db.js` | Add migration V12 (checkpoints table + missions list query) |
| Modify | `src/platform/storage/repositories/aurex.js` | Add checkpoint + listMissions repository methods |
| Create | `src/http/handlers/checkpoints.js` | HTTP handlers for checkpoint CRUD |
| Modify | `src/http/server.js` | Add checkpoint + list missions routes |
| Modify | `test/http-server.test.js` | Tests for checkpoint endpoints |

---

### Task 1: Shared Types — CheckpointRecord

Add the `CheckpointRecord` type to the shared package so both Aurex and LaPis can reference it.

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add CheckpointRecord to shared types**

Append to `packages/shared/src/types.ts` (after the `AgentSpec` interface):

```typescript
export interface CheckpointRecord {
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
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All 113 tests pass

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/shared/src/types.ts
git commit -m "feat: add CheckpointRecord type to shared package"
```

---

### Task 2: LaPis Client — Checkpoint + List Methods

Add the new LaPis client methods needed by the runner and checkpoint manager.

**Files:**
- Modify: `packages/backend/src/clients/lapis-client.ts`

- [ ] **Step 1: Add CheckpointRecord import**

At the top of `lapis-client.ts`, add `CheckpointRecord` to the import from `@aurex/shared`:

```typescript
import type {
  // ... existing imports ...
  CheckpointRecord,
} from "@aurex/shared";
```

- [ ] **Step 2: Add methods to LaPisClient interface**

Add these methods to the `LaPisClient` interface (after the `runCompression` method, before `ping`):

```typescript
  // Checkpoints
  createCheckpoint(checkpoint: Omit<CheckpointRecord, "id" | "status" | "createdAt" | "resolvedAt">): Promise<CheckpointRecord>;
  getCheckpoint(id: string): Promise<CheckpointRecord>;
  resolveCheckpoint(id: string, decision: CheckpointDecision, guidance?: string, reason?: string): Promise<CheckpointRecord>;
  getPendingCheckpoints(missionId: string): Promise<CheckpointRecord[]>;

  // Mission listing
  listMissions(opts?: { status?: string }): Promise<Mission[]>;
```

Also add `CheckpointDecision` to the type imports from `@aurex/shared`.

- [ ] **Step 3: Add implementations**

Add these to the returned object in `createLaPisClient` (after `runCompression`, before `ping`):

```typescript
    // Checkpoints
    createCheckpoint(checkpoint) {
      return post("/checkpoints", checkpoint);
    },
    getCheckpoint(id) {
      return get(`/checkpoints/${id}`);
    },
    resolveCheckpoint(id, decision, guidance, reason) {
      return patch(`/checkpoints/${id}`, { decision, guidance, reason });
    },
    getPendingCheckpoints(missionId) {
      return get(`/missions/${missionId}/checkpoints?status=pending`);
    },

    // Mission listing
    listMissions(opts) {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      const qs = params.toString();
      return get(`/missions${qs ? `?${qs}` : ""}`);
    },
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All 113 tests pass (new methods not called yet)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/clients/lapis-client.ts
git commit -m "feat: add checkpoint and listMissions methods to LaPis client"
```

---

### Task 3: PiMemoryExtension — Checkpoints Migration V12

Add the `checkpoints` table and the `list missions by status` query to the PiMemoryExtension DB.

**Files:**
- Modify: `db.js` (in PiMemoryExtension)

- [ ] **Step 1: Add migration V12**

In PiMemoryExtension's `db.js`, find the `runMigrationV11` function. After it, add:

```javascript
function runMigrationV12() {
  const tables = [
    [
      'checkpoints',
      `CREATE TABLE IF NOT EXISTS checkpoints (
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
      )`,
    ],
  ];

  for (const [name, ddl] of tables) {
    try {
      db.exec(ddl);
    } catch (e) {
      errors.push(`V12: ${e.message}`);
    }
  }
}
```

Then in the migrations array, add `{ to: 12, run: runMigrationV12 }` after the V11 entry.

- [ ] **Step 2: Write the failing test**

In PiMemoryExtension's `test/http-server.test.js`, add a test inside the existing `describe` block:

```javascript
  it('creates checkpoints table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'");
    expect(rows.length).toBe(1);
  });
```

- [ ] **Step 3: Run test to verify**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --experimental-vm-modules node_modules/.bin/vitest test/http-server.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension
git add db.js test/http-server.test.js
git commit -m "feat: add checkpoints table migration V12"
```

---

### Task 4: PiMemoryExtension — Checkpoint Repository + Handlers + Routes

Add the repository methods, HTTP handlers, and routes for checkpoints and mission listing.

**Files:**
- Modify: `src/platform/storage/repositories/aurex.js`
- Create: `src/http/handlers/checkpoints.js`
- Modify: `src/http/server.js`
- Modify: `test/http-server.test.js`

- [ ] **Step 1: Add repository methods**

In `src/platform/storage/repositories/aurex.js`, add these methods to the `repository` object (before the closing `};`):

```javascript
    // --- Checkpoints ---
    createCheckpoint({ id, missionId, trigger, milestoneId, summary }) {
      sqlRun(
        'INSERT INTO checkpoints (id, mission_id, trigger, milestone_id, summary) VALUES (?, ?, ?, ?, ?)',
        [id, missionId, trigger, milestoneId, summary],
      );
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    getCheckpoint(id) {
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    resolveCheckpoint(id, decision, guidance, reason) {
      sqlRun(
        "UPDATE checkpoints SET status = 'resolved', decision = ?, guidance = ?, reason = ?, resolved_at = datetime('now') WHERE id = ?",
        [decision, guidance || null, reason || null, id],
      );
      return sqlJson('SELECT * FROM checkpoints WHERE id = ?', [id]);
    },
    getPendingCheckpoints(missionId) {
      return sqlJson("SELECT * FROM checkpoints WHERE mission_id = ? AND status = 'pending'", [missionId]);
    },

    // --- Mission listing ---
    listMissions(status) {
      if (status) {
        return sqlJson('SELECT * FROM missions WHERE status = ?', [status]);
      }
      return sqlJson('SELECT * FROM missions');
    },
```

Note: The existing `createMission` generates IDs with `m-${Date.now()}-...`. Checkpoint IDs should follow a similar pattern.

- [ ] **Step 2: Create checkpoint handlers**

Create `src/http/handlers/checkpoints.js`:

```javascript
const { jsonOk, jsonCreated, jsonError } = require('../errors');

function createCheckpoint(repo) {
  return async (req, res, ctx) => {
    const { missionId, trigger, milestoneId, summary } = ctx.body;
    if (!missionId || !trigger || !milestoneId) {
      return jsonError(res, 400, 'bad_request', 'missionId, trigger, and milestoneId are required');
    }
    const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rows = repo.createCheckpoint({ id, missionId, trigger, milestoneId, summary: summary || '' });
    jsonCreated(res, rows[0] || { id });
  };
}

function getCheckpoint(repo) {
  return async (req, res, ctx) => {
    const rows = repo.getCheckpoint(ctx.params.id);
    if (!rows || rows.length === 0) {
      return jsonError(res, 404, 'not_found', 'Checkpoint not found');
    }
    jsonOk(res, rows[0]);
  };
}

function resolveCheckpoint(repo) {
  return async (req, res, ctx) => {
    const { decision, guidance, reason } = ctx.body;
    if (!decision) {
      return jsonError(res, 400, 'bad_request', 'decision is required');
    }
    const existing = repo.getCheckpoint(ctx.params.id);
    if (!existing || existing.length === 0) {
      return jsonError(res, 404, 'not_found', 'Checkpoint not found');
    }
    if (existing[0].status === 'resolved') {
      // Idempotent — return already-resolved checkpoint
      return jsonOk(res, existing[0]);
    }
    const rows = repo.resolveCheckpoint(ctx.params.id, decision, guidance, reason);
    jsonOk(res, rows[0]);
  };
}

function getPendingCheckpoints(repo) {
  return async (req, res, ctx) => {
    const missionId = ctx.params.missionId;
    const rows = repo.getPendingCheckpoints(missionId);
    jsonOk(res, rows);
  };
}

function listMissions(repo) {
  return async (req, res, ctx) => {
    const status = ctx.query.get('status') || undefined;
    const rows = repo.listMissions(status);
    jsonOk(res, rows);
  };
}

module.exports = { createCheckpoint, getCheckpoint, resolveCheckpoint, getPendingCheckpoints, listMissions };
```

- [ ] **Step 3: Add routes to server**

In `src/http/server.js`, add the import and routes. Find the line that requires handlers and add:

```javascript
const checkpoints = require('./handlers/checkpoints');
```

Then in the `buildRoutes` function's routes array, add these routes:

```javascript
    // Checkpoints
    { method: 'POST', pattern: '/checkpoints', handler: checkpoints.createCheckpoint(aurex) },
    { method: 'GET', pattern: '/checkpoints/:id', handler: checkpoints.getCheckpoint(aurex) },
    { method: 'PATCH', pattern: '/checkpoints/:id', handler: checkpoints.resolveCheckpoint(aurex) },
    { method: 'GET', pattern: '/missions/:missionId/checkpoints', handler: checkpoints.getPendingCheckpoints(aurex) },
    // Mission listing (before the /missions/:id route to avoid path collision)
    { method: 'GET', pattern: '/missions', handler: checkpoints.listMissions(aurex) },
```

**Important:** The `GET /missions` route MUST come before `GET /missions/:id` in the routes array. Since the server uses pattern matching with `:id`, `/missions` (no params) must be checked first. Place it right after the `POST /missions` route.

- [ ] **Step 4: Write the failing tests**

In `test/http-server.test.js`, add inside the existing `describe` block:

```javascript
  describe('checkpoints', () => {
    let missionId;

    beforeAll(() => {
      const rows = aurex.createMission({
        id: `m-test-${Date.now()}`,
        description: 'Test mission for checkpoints',
        status: 'running',
        configJson: {},
      });
      missionId = rows[0].id;
    });

    it('creates a checkpoint', () => {
      const rows = aurex.createCheckpoint({
        id: `cp-${Date.now()}`,
        missionId,
        trigger: 'rescope_limit',
        milestoneId: 'ms-1',
        summary: 'Test checkpoint',
      });
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].trigger).toBe('rescope_limit');
    });

    it('gets a checkpoint by id', () => {
      const id = `cp-${Date.now()}-2`;
      aurex.createCheckpoint({ id, missionId, trigger: 'unclassifiable_error', milestoneId: 'ms-2', summary: 'Test' });
      const rows = aurex.getCheckpoint(id);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(id);
    });

    it('resolves a checkpoint', () => {
      const id = `cp-${Date.now()}-3`;
      aurex.createCheckpoint({ id, missionId, trigger: 'rescope_limit', milestoneId: 'ms-3', summary: 'Test' });
      const rows = aurex.resolveCheckpoint(id, 'approve', undefined, undefined);
      expect(rows[0].status).toBe('resolved');
      expect(rows[0].decision).toBe('approve');
    });

    it('resolving an already-resolved checkpoint is idempotent', () => {
      const id = `cp-${Date.now()}-4`;
      aurex.createCheckpoint({ id, missionId, trigger: 'rescope_limit', milestoneId: 'ms-4', summary: 'Test' });
      aurex.resolveCheckpoint(id, 'approve');
      const rows = aurex.resolveCheckpoint(id, 'reject');
      // Should return the original resolution (approve), not update to reject
      expect(rows[0].decision).toBe('approve');
    });

    it('gets pending checkpoints for a mission', () => {
      const id = `cp-${Date.now()}-5`;
      aurex.createCheckpoint({ id, missionId, trigger: 'rescope_limit', milestoneId: 'ms-5', summary: 'Pending' });
      const rows = aurex.getPendingCheckpoints(missionId);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every(r => r.status === 'pending')).toBe(true);
    });

    it('lists missions by status', () => {
      const rows = aurex.listMissions('running');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every(r => r.status === 'running')).toBe(true);
    });
  });
```

- [ ] **Step 5: Run tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node --experimental-vm-modules node_modules/.bin/vitest test/http-server.test.js`
Expected: All existing tests + new checkpoint tests pass

Note: Ignore `context-injection-prompt.test.js` failures — pre-existing.

- [ ] **Step 6: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension
git add src/platform/storage/repositories/aurex.js src/http/handlers/checkpoints.js src/http/server.js test/http-server.test.js
git commit -m "feat: add checkpoint endpoints and list missions to LaPis HTTP server"
```

---

### Task 5: MilestoneLoopResult Return Type

Change the milestone loop to return a discriminated union instead of `boolean`.

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Modify: `packages/backend/__tests__/milestone-loop.test.ts`
- Modify: `packages/backend/__tests__/milestone-loop-spawn.test.ts`

- [ ] **Step 1: Add MilestoneLoopResult export to milestone-loop.ts**

At the top of `milestone-loop.ts`, add the type (before the interfaces):

```typescript
import type { CheckpointTrigger } from "@aurex/shared";

export type MilestoneLoopResult =
  | { status: "completed" }
  | { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string }
  | { status: "failed"; reason: string };
```

- [ ] **Step 2: Change return type of run() and update return statements**

Change the `run` method signature from `Promise<boolean>` to `Promise<MilestoneLoopResult>`. Then update each return:

- The `escalate` path (negotiator returns escalate):
  Change from `return false` to:
  ```typescript
  return {
    status: "checkpoint_needed",
    trigger: "rescope_limit" as CheckpointTrigger,
    milestoneId: milestone.id,
    summary: decision.reason,
  };
  ```

- The all-milestones-complete path:
  Change from `await lapis.updateMissionStatus(mission.id, "completed"); return true;` to:
  ```typescript
  await lapis.updateMissionStatus(mission.id, "completed");
  return { status: "completed" };
  ```

- The pass path (after negotiator passes):
  Keep the `updateMilestoneStatus("completed")` call, but don't return yet — let the loop continue to the next milestone. If this was the last milestone, it falls through to the completion return above.

- [ ] **Step 3: Update existing milestone-loop tests**

In `packages/backend/__tests__/milestone-loop.test.ts`:

Change `"skips completed milestones"` test:
```typescript
expect(result.status).toBe("completed");
// was: expect(result).toBe(true);
```

Change `"pauses on escalation"` test:
```typescript
expect(result.status).toBe("checkpoint_needed");
// was: expect(result).toBe(false);
```

- [ ] **Step 4: Update milestone-loop-spawn tests**

In `packages/backend/__tests__/milestone-loop-spawn.test.ts`:

Change `"skips completed milestones"` test:
```typescript
expect(result.status).toBe("completed");
// was: expect(result).toBe(true);
```

Change `"spawns a worker for each unit and processes the milestone"` test — no change needed since it doesn't assert on the return value, just checks that the loop ran without error.

- [ ] **Step 5: Run all backend tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All 113+ tests pass

- [ ] **Step 6: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/orchestrator/milestone-loop.ts packages/backend/__tests__/milestone-loop.test.ts packages/backend/__tests__/milestone-loop-spawn.test.ts
git commit -m "feat: change milestone loop to return MilestoneLoopResult union type"
```

---

### Task 6: Checkpoint Manager

Build the `CheckpointManager` that creates checkpoints in LaPis and polls for resolution.

**Files:**
- Create: `packages/backend/src/orchestrator/checkpoint-manager.ts`
- Create: `packages/backend/__tests__/checkpoint-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/checkpoint-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckpointManager, type CheckpointManager } from "../../src/orchestrator/checkpoint-manager";
import type { LaPisClient } from "../../src/clients/lapis-client";
import type { CheckpointRecord } from "@aurex/shared";

function createMockLapis(): LaPisClient {
  return {
    createCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1", missionId: "m-1", trigger: "rescope_limit", milestoneId: "ms-1",
      summary: "test", status: "pending", createdAt: "2026-01-01",
    }),
    getCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1", missionId: "m-1", trigger: "rescope_limit", milestoneId: "ms-1",
      summary: "test", status: "pending", createdAt: "2026-01-01",
    }),
    resolveCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1", missionId: "m-1", trigger: "rescope_limit", milestoneId: "ms-1",
      summary: "test", status: "resolved", decision: "approve", createdAt: "2026-01-01", resolvedAt: "2026-01-01",
    }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

describe("CheckpointManager", () => {
  it("creates a checkpoint in LaPis", async () => {
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis);
    const id = await manager.create({
      missionId: "m-1", trigger: "rescope_limit", milestoneId: "ms-1", summary: "too many rescopes",
    });
    expect(id).toBe("cp-test-1");
    expect(lapis.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "m-1", trigger: "rescope_limit" }),
    );
  });

  it("polls until checkpoint is resolved", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });

    // First poll: pending. Second poll: resolved.
    let pollCount = 0;
    (lapis.getCheckpoint as any).mockImplementation(async () => {
      pollCount++;
      if (pollCount < 3) {
        return { id: "cp-1", status: "pending" };
      }
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1");

    // Advance through polls
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result.status).toBe("resolved");
    expect(result.decision).toBe("approve");
    expect(pollCount).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  });

  it("resolves a checkpoint", async () => {
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis);
    await manager.resolve("cp-1", "rescope", "Try smaller units");
    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith("cp-1", "rescope", "Try smaller units", undefined);
  });

  it("gets pending checkpoints for a mission", async () => {
    const lapis = createMockLapis();
    (lapis.getPendingCheckpoints as any).mockResolvedValue([
      { id: "cp-1", missionId: "m-1", status: "pending" },
    ]);
    const manager = createCheckpointManager(lapis);
    const pending = await manager.getPendingForMission("m-1");
    expect(pending.length).toBe(1);
    expect(lapis.getPendingCheckpoints).toHaveBeenCalledWith("m-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/checkpoint-manager.test.ts`
Expected: FAIL — Cannot find module `../../src/orchestrator/checkpoint-manager`

- [ ] **Step 3: Write the implementation**

Create `packages/backend/src/orchestrator/checkpoint-manager.ts`:

```typescript
import type { LaPisClient } from "../clients/lapis-client";
import type { CheckpointTrigger, CheckpointDecision, CheckpointRecord } from "@aurex/shared";

export interface CheckpointManager {
  create(record: { missionId: string; trigger: CheckpointTrigger; milestoneId: string; summary: string }): Promise<string>;
  waitForResolution(checkpointId: string): Promise<CheckpointRecord>;
  resolve(checkpointId: string, decision: CheckpointDecision, guidance?: string, reason?: string): Promise<void>;
  getPendingForMission(missionId: string): Promise<CheckpointRecord[]>;
}

export function createCheckpointManager(lapis: LaPisClient, opts?: { pollIntervalMs?: number }): CheckpointManager {
  const pollInterval = opts?.pollIntervalMs ?? 2000;

  return {
    async create(record) {
      const result = await lapis.createCheckpoint(record);
      return result.id;
    },

    async waitForResolution(checkpointId) {
      return new Promise<CheckpointRecord>((resolve) => {
        const poll = async () => {
          const checkpoint = await lapis.getCheckpoint(checkpointId);
          if (checkpoint.status === "resolved") {
            resolve(checkpoint);
            return;
          }
          setTimeout(poll, pollInterval);
        };
        poll();
      });
    },

    async resolve(checkpointId, decision, guidance, reason) {
      await lapis.resolveCheckpoint(checkpointId, decision, guidance, reason);
    },

    async getPendingForMission(missionId) {
      return lapis.getPendingCheckpoints(missionId);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/checkpoint-manager.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/orchestrator/checkpoint-manager.ts packages/backend/__tests__/checkpoint-manager.test.ts
git commit -m "feat: add CheckpointManager with LaPis polling"
```

---

### Task 7: Mission Runner

The core runner that drives the full mission lifecycle.

**Files:**
- Create: `packages/backend/src/orchestrator/mission-runner.ts`
- Create: `packages/backend/__tests__/mission-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/mission-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Pi SDK (pulled in transitively by milestone-loop → agent-spawner)
vi.mock("@earendil-works/pi-coding-agent", () => {
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: { prompt: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockReturnValue(() => {}), abort: vi.fn(), dispose: vi.fn(), sessionId: "mock" },
    }),
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn(),
  };
});

// Mock git exec (pulled in by worktree manager)
vi.mock("node:child_process", () => ({ exec: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createMissionRunner, type RunnerStatus } from "../../src/orchestrator/mission-runner";
import type { LaPisClient } from "../../src/clients/lapis-client";
import type { PinyxClient } from "../../src/clients/pinyx-client";

function createMockLapis(): LaPisClient {
  return {
    getMission: vi.fn().mockResolvedValue({
      id: "m-1", description: "Build auth", status: "planning",
      configJson: {
        modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
        workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
        costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
      },
      createdAt: "2026-01-01",
    }),
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([]),
    getContractHistory: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue([]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    createCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    listMissions: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ milestones: [{ title: "M1", description: "First", units: [], criteria: [], testCommands: [] }] }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

const mockEventBus = { emit: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}) };

describe("MissionRunner", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("starts in idle state", () => {
    const runner = createMissionRunner({
      lapis: createMockLapis(), pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });
    expect(runner.getStatus().state).toBe("idle");
    expect(runner.getActiveMissionId()).toBeNull();
  });

  it("rejects start when already running", async () => {
    const lapis = createMockLapis();
    // Make the runner hang in planning
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));
    const runner = createMissionRunner({
      lapis, pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });
    runner.start("m-1");
    expect(() => runner.start("m-2")).toThrow(/already running/);
  });

  it("transitions through planning → executing → completed", async () => {
    const lapis = createMockLapis();
    const runner = createMissionRunner({
      lapis, pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // Plan produces 1 milestone, no units, verdicts pass
    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "running");
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
    expect(runner.getStatus().state).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/mission-runner.test.ts`
Expected: FAIL — Cannot find module `../../src/orchestrator/mission-runner`

- [ ] **Step 3: Write the implementation**

Create `packages/backend/src/orchestrator/mission-runner.ts`:

```typescript
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";
import type { EventBus } from "./events";
import type { AppConfig } from "../config";
import type { CheckpointTrigger, CheckpointDecision } from "@aurex/shared";
import { createPlanner } from "./planner";
import { createMilestoneLoop } from "./milestone-loop";
import { createCheckpointManager } from "./checkpoint-manager";

export interface RunnerStatus {
  state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed";
  missionId: string | null;
}

export interface MissionRunnerConfig {
  lapis: LaPisClient;
  pinyx: PinyxClient;
  eventBus: EventBus;
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
}

export function createMissionRunner(config: MissionRunnerConfig) {
  const { lapis, pinyx, eventBus, agentDir, repoRoot, gitMainBranch } = config;
  const checkpointManager = createCheckpointManager(lapis);

  let status: RunnerStatus = { state: "idle", missionId: null };
  let abortController: AbortController | null = null;
  let completionResolve: (() => void) | null = null;
  const completionPromise = new Promise<void>((resolve) => { completionResolve = resolve; });

  function setStatus(newState: RunnerStatus["state"]) {
    status = { ...status, state: newState };
  }

  return {
    start(missionId: string): void {
      if (status.state !== "idle" && status.state !== "completed" && status.state !== "failed") {
        throw new Error(`Runner already running (state: ${status.state}, mission: ${status.missionId})`);
      }

      abortController = new AbortController();
      status = { state: "planning", missionId };

      // Fire-and-forget background task
      runMission(missionId).catch((err: Error) => {
        console.error(`[runner] Mission ${missionId} failed:`, err.message);
        setStatus("failed");
        lapis.updateMissionStatus(missionId, "failed").catch(() => {});
        completionResolve?.();
      });
    },

    abort(): void {
      abortController?.abort();
    },

    getStatus(): RunnerStatus {
      return { ...status };
    },

    getActiveMissionId(): string | null {
      return status.missionId;
    },

    async waitForCompletion(): Promise<void> {
      return completionPromise;
    },
  };

  async function runMission(missionId: string): Promise<void> {
    // 1. PLANNING
    setStatus("planning");
    const mission = await lapis.getMission(missionId);
    const planner = createPlanner(lapis, pinyx);
    const planResult = await planner.plan(mission.description, missionId);

    await lapis.updateMissionStatus(missionId, "running");

    // 2. EXECUTION
    setStatus("executing");
    const loop = createMilestoneLoop(lapis, pinyx, {
      onEscalation: (mId, trigger, context) => {
        eventBus.emit({ type: "escalation", missionId: mId, trigger: trigger as any, context: context as any });
      },
      onAgentStatus: (agentId, agentType, agentStatus, milestoneId) => {
        eventBus.emit({ type: "agent_status", agentId, agentType: agentType as any, status: agentStatus as any, milestoneId } as any);
      },
      onMilestoneProgress: (milestoneId, msStatus, completed, total) => {
        eventBus.emit({ type: "milestone_progress", milestoneId, status: msStatus as any, completedUnits: completed as number, totalUnits: total as number } as any);
      },
      onCostUpdate: (mId, totalCost, totalTokens, delta) => {
        eventBus.emit({ type: "cost_update", missionId: mId, totalCost, totalTokens, delta } as any);
      },
    }, { agentDir, repoRoot, gitMainBranch });

    // Get the full milestones from LaPis (planner created them)
    const milestones = planResult.milestones;

    for (const milestoneSummary of milestones) {
      const mission = await lapis.getMission(missionId);
      const result = await loop.run(mission, [{ id: milestoneSummary.id, missionId, title: milestoneSummary.title, description: "", orderIndex: 0, status: "planned" as const, validationContractId: "" }]);

      if (result.status === "checkpoint_needed") {
        setStatus("waiting_checkpoint");
        await lapis.updateMissionStatus(missionId, "paused");

        const checkpointId = await checkpointManager.create({
          missionId,
          trigger: result.trigger,
          milestoneId: result.milestoneId,
          summary: result.summary,
        });

        eventBus.emit({
          type: "escalation",
          missionId,
          trigger: { kind: result.trigger, milestoneId: result.milestoneId } as any,
          context: { summary: result.summary } as any,
        } as any);

        const resolved = await checkpointManager.waitForResolution(checkpointId);

        if (resolved.decision === "reject") {
          await lapis.updateMissionStatus(missionId, "aborted");
          setStatus("failed");
          completionResolve?.();
          return;
        }

        if (resolved.decision === "rescope") {
          // TODO: replan this milestone — for now, mark as failed
          await lapis.updateMissionStatus(missionId, "failed");
          setStatus("failed");
          completionResolve?.();
          return;
        }

        // approve — continue
        await lapis.updateMissionStatus(missionId, "running");
        setStatus("executing");
      }

      if (result.status === "failed") {
        await lapis.updateMissionStatus(missionId, "failed");
        setStatus("failed");
        completionResolve?.();
        return;
      }
    }

    // 3. COMPLETION
    await lapis.updateMissionStatus(missionId, "completed");
    setStatus("completed");
    completionResolve?.();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/mission-runner.test.ts`
Expected: PASS (3 tests)

Note: Tests may need adjustment depending on how the async background task resolves. The `waitForCompletion()` method helps with test synchronization.

- [ ] **Step 5: Run all backend tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/orchestrator/mission-runner.ts packages/backend/__tests__/mission-runner.test.ts
git commit -m "feat: add MissionRunner with planning → execution → checkpoint → completion lifecycle"
```

---

### Task 8: Wire Server + Routes

Connect everything: server creates the runner, missions route triggers it, checkpoints route writes to LaPis, startup recovery.

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/routes/missions.ts`
- Modify: `packages/backend/src/routes/checkpoints.ts`

- [ ] **Step 1: Update server.ts**

Replace the current `server.ts` with the wired version. Key changes:
- Import and create `MissionRunner`
- Pass runner to routes
- Add startup recovery

```typescript
// packages/backend/src/server.ts
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createLaPisClient } from "./clients/lapis-client.js";
import { createPinyxClient } from "./clients/pinyx-client.js";
import { createEventBus } from "./ws/events.js";
import { createMissionRunner } from "./orchestrator/mission-runner.js";
import { missionRoutes } from "./routes/missions.js";
import { checkpointRoutes } from "./routes/checkpoints.js";

async function main() {
  const config = loadConfig();
  const lapis = createLaPisClient({ lapisEndpoint: config.lapisEndpoint });
  const pinyx = createPinyxClient({ endpoint: config.pinyxEndpoint });
  const eventBus = createEventBus();

  // Startup healthchecks
  try {
    await lapis.ping();
    console.log("[startup] LaPis connected");
  } catch {
    console.error("[startup] LaPis UNREACHABLE — exiting");
    process.exit(1);
  }

  try {
    await pinyx.ping();
    console.log("[startup] PiNyx connected");
  } catch {
    console.error("[startup] PiNyx UNREACHABLE — exiting");
    process.exit(1);
  }

  // Create mission runner
  const runner = createMissionRunner({
    lapis, pinyx, eventBus,
    agentDir: process.env.PI_AGENT_DIR || `${process.env.HOME}/.pi/agent`,
    repoRoot: config.repoRoot,
    gitMainBranch: config.gitMainBranch,
  });

  // Startup recovery — check for paused missions
  try {
    const paused = await lapis.listMissions({ status: "paused" });
    for (const mission of paused) {
      console.log(`[startup] Resuming paused mission: ${mission.id}`);
      runner.start(mission.id);
    }
  } catch (err) {
    console.warn("[startup] Could not check for paused missions:", (err as Error).message);
  }

  const app = Fastify({ logger: true });

  // Health endpoint
  app.get("/health", async () => {
    const lapisOk = await lapis.ping().then(() => true, () => false);
    const pinyxOk = await pinyx.ping().then(() => true, () => false);
    const ok = lapisOk && pinyxOk;
    return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
  });

  // REST routes
  await app.register(missionRoutes, { lapis, runner });
  await app.register(checkpointRoutes, { lapis });

  // Start
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`[server] Listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
```

- [ ] **Step 2: Update missions.ts route**

```typescript
// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client";
import type { MissionRunner } from "../orchestrator/mission-runner";

export async function missionRoutes(
  app: FastifyInstance,
  { lapis, runner }: { lapis: LaPisClient; runner: MissionRunner },
) {
  app.post("/api/missions", async (request, reply) => {
    const { description } = request.body as { description: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }
    const mission = await lapis.createMission(description, {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    });

    // Trigger the runner in the background
    runner.start(mission.id);

    return reply.status(201).send({ missionId: mission.id, status: mission.status });
  });

  app.get("/api/missions/current", async (_request, reply) => {
    const missionId = runner.getActiveMissionId();
    if (!missionId) {
      return reply.status(404).send({ error: "No active mission" });
    }
    try {
      const mission = await lapis.getMission(missionId);
      const cost = await lapis.getMissionCost(missionId);
      return { mission, milestones: [], activeWorkers: [], cost };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });

  app.get("/api/missions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const mission = await lapis.getMission(id);
      const cost = await lapis.getMissionCost(id);
      return { mission, milestones: [], activeWorkers: [], cost };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });
}
```

- [ ] **Step 3: Update checkpoints.ts route**

```typescript
// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client";

interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { lapis }: { lapis: LaPisClient },
) {
  // In-memory dedup tracker (per process)
  const processed = new Map<string, boolean>();

  app.post("/api/missions/:id/checkpoints", async (request, reply) => {
    const { id: missionId } = request.params as { id: string };
    const body = request.body as CheckpointBody;

    if (!body.checkpointId || !body.decision) {
      return reply.status(400).send({ error: "checkpointId and decision are required" });
    }

    // Dedup check
    if (processed.has(body.checkpointId)) {
      return { accepted: true, duplicate: true };
    }

    // Write resolution to LaPis
    await lapis.resolveCheckpoint(body.checkpointId, body.decision, body.guidance, body.reason);

    processed.set(body.checkpointId, true);
    return { accepted: true };
  });
}
```

- [ ] **Step 4: Fix the MissionRunner type export**

The routes import `MissionRunner` as a type — the runner module must export the type. In `mission-runner.ts`, the `createMissionRunner` return type is inferred. For the route, we just need the interface. Either export a `MissionRunner` type alias or use `ReturnType<typeof createMissionRunner>`.

Simplest fix — in `mission-runner.ts`, add:

```typescript
export type MissionRunner = ReturnType<typeof createMissionRunner>;
```

And update the routes import to use it.

- [ ] **Step 5: Fix existing server + route tests**

Existing tests for `server.test.ts`, `missions.test.ts` (if any) will need the new `runner` parameter. Update mock signatures to include a mock runner.

- [ ] **Step 6: Run all backend tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/server.ts packages/backend/src/routes/missions.ts packages/backend/src/routes/checkpoints.ts packages/backend/src/orchestrator/mission-runner.ts
git commit -m "feat: wire MissionRunner to server, routes, and startup recovery"
```

---

## Self-Review

### 1. Spec Coverage

| Spec Requirement | Task |
|-----------------|------|
| `POST /api/missions` creates mission, triggers runner | Task 8 |
| Returns `{ missionId, status: "planning" }` immediately | Task 8 |
| Background task: planner → milestone loop → completion | Task 7 |
| Checkpoint polling via LaPis | Tasks 3-6 |
| `POST /api/missions/:id/checkpoints` writes to LaPis | Task 8 |
| Idempotent via checkpointId | Task 8 (existing dedup) |
| Startup recovery for paused missions | Task 8 |
| `GET /api/missions/current` returns active mission | Task 8 |
| `GET /health` checks LaPis + PiNyx | Already built |
| WS escalation events on checkpoint | Task 7 |
| Single mission at a time | Task 7 (rejects if running) |
| `MilestoneLoopResult` for checkpoint triggers | Task 5 |

### 2. Placeholder Scan

No TBDs, TODOs, or vague requirements. The `rescope` handling in Task 7 is marked `// TODO: replan this milestone` — this is intentional since the replan logic requires the planner to re-run a single milestone, which is a separate concern.

### 3. Type Consistency

- `CheckpointRecord` defined in shared types → used by LaPis client, CheckpointManager, PiMemoryExtension handlers ✓
- `MilestoneLoopResult` union type → returned by milestone loop, consumed by runner ✓
- `MissionRunner` return type exported for route injection ✓
- `listMissions` returns `Mission[]` → consistent with `getMission` return type ✓
- `createCheckpoint` in LaPis client takes `Omit<CheckpointRecord, "id" | "status" | "createdAt" | "resolvedAt">` → matches what PiMemoryExtension generates ✓

### 4. Cross-Repo Ordering

Tasks 3-4 (PiMemoryExtension) must be completed and deployed before Tasks 5-8 (Aurex) can run end-to-end. The plan sequences them correctly. Aurex tests that don't hit LaPis directly (unit tests with mocks) can pass without PiMemoryExtension changes.
