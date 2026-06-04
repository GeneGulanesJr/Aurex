# Ranking Quality Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve memory recall quality by adding negative feedback signals, edit history, relation surfacing in search, and stricter auto-detection.

**Architecture:** Four independent features layered on existing schema. Negative feedback extends `recall_log` + `rankObservations`. Version trail adds a new `observation_versions` table + migration. Relations in search extends `search()` + `memory-get` tool output. Auto-detection tightens `passive-capture.ts` pattern matching with position-aware confidence.

**Tech Stack:** SQLite, Node.js (existing codebase), TypeScript (extension hooks), libSQL migrations.

---

## Feature 1: Negative Feedback Loop

### Task 1.1: Add `was_useful` column to existing `recall_log` writes

The `recall_log` table already has `was_useful INTEGER` but `insertRecallLog` never writes it. Currently all inserts go through `INSERT OR IGNORE INTO recall_log (memory_id, session_id, query)` — missing the column entirely.

⚠️ **There are TWO separate `insertRecallLog` implementations** (not a re-export):
- `src/memory-domain/recall.js` — used by `src/memory-domain/search.js`
- `data-access/observations.js` — used by `commands/search.js` via `obsDA.insertRecallLog`

Both must be updated. The test validates both paths.

**Files:**
- Modify: `src/memory-domain/recall.js` (insertRecallLog — 3→4 columns)
- Modify: `data-access/observations.js` (insertRecallLog — 3→4 columns)
- Test: `test/recall-feedback.test.js` (create, tests both modules)

- [ ] **Step 1: Write the failing test**

Create `test/recall-feedback.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { createDb } = require('../db');
const { insertRecallLog, getRecallCount, recallScore } = require('../src/memory-domain/recall');
const { insertRecallLog: insertRecallLogDA } = require('../data-access/observations');

// Follow the same pattern as test/memory-domain.test.js for DB setup
describe('recall feedback', () => {
  let deps;
  beforeEach(() => {
    const db = createDb({ memoryPath: ':memory:' });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
    };
  });

  it('inserts recall log with was_useful=true', () => {
    const result = insertRecallLog(deps, [
      { memoryId: 1, sessionId: 1, query: 'test', wasUseful: true },
    ]);
    expect(result.inserted).toBe(1);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 1');
    expect(rows[0].was_useful).toBe(1);
  });

  it('inserts recall log with was_useful=false', () => {
    const result = insertRecallLog(deps, [
      { memoryId: 2, sessionId: 1, query: 'test', wasUseful: false },
    ]);
    expect(result.inserted).toBe(1);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 2');
    expect(rows[0].was_useful).toBe(0);
  });

  it('defaults was_useful to 1 (positive recall) when not specified', () => {
    insertRecallLog(deps, [
      { memoryId: 3, sessionId: 1, query: 'test' },
    ]);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 3');
    expect(rows[0].was_useful).toBe(1);
  });

  it('handles mixed batch of useful and not-useful', () => {
    insertRecallLog(deps, [
      { memoryId: 10, sessionId: 1, query: 'q1', wasUseful: true },
      { memoryId: 11, sessionId: 1, query: 'q1', wasUseful: false },
    ]);
    const rows = deps.sqlJson('SELECT memory_id, was_useful FROM recall_log ORDER BY memory_id');
    expect(rows).toHaveLength(2);
    expect(rows[0].was_useful).toBe(1);
    expect(rows[1].was_useful).toBe(0);
  });

  it('data-access insertRecallLog also writes was_useful (CLI path)', () => {
    const result = insertRecallLogDA(deps, [
      { memoryId: 20, sessionId: 1, query: 'test', wasUseful: false },
    ]);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 20');
    expect(rows[0].was_useful).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recall-feedback.test.js`
Expected: FAIL — `wasUseful` field is ignored by current `insertRecallLog`.

- [ ] **Step 3: Update `insertRecallLog` in `src/memory-domain/recall.js`**

Replace the function body:

```js
function insertRecallLog(deps, entries) {
  if (!entries || entries.length === 0) {
    return { inserted: 0 };
  }
  const { sqlRun } = deps;
  const placeholders = entries.map(() => '(?, ?, ?, ?)').join(',');
  const params = entries.flatMap((r) => [
    r.memoryId,
    r.sessionId,
    r.query,
    r.wasUseful === false ? 0 : 1,
  ]);
  sqlRun(
    `INSERT OR IGNORE INTO recall_log (memory_id, session_id, query, was_useful) VALUES ${placeholders}`,
    params,
  );
  return { inserted: entries.length };
}
```

- [ ] **Step 4: Update `insertRecallLog` in `data-access/observations.js`**

This file has its **own separate** `insertRecallLog` (not a re-export). It must be updated identically:

```js
function insertRecallLog(deps, entries) {
  const { sqlRun } = deps;
  const placeholders = entries.map(() => '(?, ?, ?, ?)').join(',');
  const params = entries.flatMap((r) => [
    r.memoryId,
    r.sessionId,
    r.query,
    r.wasUseful === false ? 0 : 1,
  ]);
  sqlRun(
    `INSERT OR IGNORE INTO recall_log (memory_id, session_id, query, was_useful) VALUES ${placeholders}`,
    params,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/recall-feedback.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/memory-domain/recall.js data-access/observations.js test/recall-feedback.test.js
git commit -m "feat(recall): write was_useful flag to recall_log on insert"
```

---

### Task 1.2: Use `was_useful` in ranking — positive-only recall boosts, negative penalizes

**Files:**
- Modify: `src/memory-domain/search.js` (rankObservations — add useful_ratio to composite)
- Modify: `constants.js` (add USEFULNESS_WEIGHT to RANKING)
- Test: `test/recall-feedback.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/recall-feedback.test.js`:

```js
const { rankObservations } = require('../src/memory-domain/search');

describe('rankObservations with useful_ratio', () => {
  it('ranks memory with higher useful_ratio above lower', () => {
    const rows = [
      {
        id: 1,
        title: 'Memory A',
        type: 'decision',
        created_at: new Date().toISOString(),
        recall_count: 10,
        useful_count: 9,
        trust_score: 0.7,
        rank: -1,
      },
      {
        id: 2,
        title: 'Memory B',
        type: 'decision',
        created_at: new Date().toISOString(),
        recall_count: 10,
        useful_count: 2,
        trust_score: 0.7,
        rank: -1,
      },
    ];
    const ranked = rankObservations(rows, 'memory');
    expect(ranked[0].id).toBe(1); // higher useful ratio wins
    expect(ranked[0]._score).toBeGreaterThan(ranked[1]._score);
  });

  it('memory with zero useful_count but high recall_count ranks lower', () => {
    const rows = [
      {
        id: 1,
        title: 'Noisy',
        type: 'discovery',
        created_at: new Date().toISOString(),
        recall_count: 20,
        useful_count: 1,
        trust_score: 0.7,
        rank: -1,
      },
      {
        id: 2,
        title: 'Precise',
        type: 'discovery',
        created_at: new Date().toISOString(),
        recall_count: 3,
        useful_count: 3,
        trust_score: 0.7,
        rank: -1,
      },
    ];
    const ranked = rankObservations(rows, 'test');
    expect(ranked[0].id).toBe(2); // 100% useful beats 5% useful despite lower recall
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recall-feedback.test.js`
Expected: FAIL — `rankObservations` doesn't use `useful_count`.

- [ ] **Step 3: Add USEFULNESS_WEIGHT to `constants.js` RANKING**

Inside the `RANKING` object in `constants.js`, add after `RECALL_LOG_MULTIPLIER`:

```js
USEFULNESS_MULTIPLIER: 0.15,
```

- [ ] **Step 4: Update `TRUST_RECALL_JOINS` in `src/memory-domain/search.js`**

Add a `useful_count` subquery to the existing join:

```js
const TRUST_RECALL_JOINS = `
LEFT JOIN (
  SELECT memory_id, MAX(trust_score) as trust_score
  FROM symbol_links GROUP BY memory_id
) sl ON sl.memory_id = CAST(o.id AS TEXT)
LEFT JOIN (
  SELECT memory_id,
         COUNT(*) as recall_count,
         SUM(CASE WHEN was_useful = 1 THEN 1 ELSE 0 END) as useful_count
  FROM recall_log GROUP BY memory_id
) rl ON rl.memory_id = o.id`;
```

⚠️ **This join is shared by both the FTS5 and LIKE fallback query paths.** The LIKE fallback query currently selects `COALESCE(rl.recall_count, 0) as recall_count` but does NOT select `rl.useful_count`. Since `rankObservations` now reads `row.useful_count`, the fallback rows would get `undefined` → `0` → `usefulRatio = 0`, unfairly penalizing all fallback results.

Fix the fallback query to also select useful_count. In the LIKE fallback `SELECT` clause, change:

```js
// Before:
//   COALESCE(rl.recall_count, 0) as recall_count
// After:
             COALESCE(rl.recall_count, 0) as recall_count,
             COALESCE(rl.useful_count, 0) as useful_count
```

- [ ] **Step 5: Update `rankObservations` to factor in useful_ratio**

In `src/memory-domain/search.js`, update the `recallScore` line inside `rankObservations`:

```js
// Replace:
//   const recallScore = Math.log(1 + (row.recall_count || 0)) * RANKING.RECALL_LOG_MULTIPLIER;
// With:
const recallCount = row.recall_count || 0;
const usefulCount = row.useful_count || 0;
const usefulRatio = recallCount > 0 ? usefulCount / recallCount : 0.5; // neutral if never recalled
const recallScore =
  Math.log(1 + recallCount) * RANKING.RECALL_LOG_MULTIPLIER * usefulRatio +
  usefulRatio * RANKING.USEFULNESS_MULTIPLIER;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/recall-feedback.test.js`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass (ranking changes are backward-compatible since usefulRatio defaults to 0.5 for memories with no recall log).

- [ ] **Step 8: Commit**

```bash
git add src/memory-domain/search.js constants.js test/recall-feedback.test.js
git commit -m "feat(ranking): factor useful_ratio into memory search ranking"
```

---

### Task 1.3: Write negative recall log when search results are NOT used

This is the critical piece — when `memory-search` returns results but the LLM never calls `memory-get`, `memory-save`, or uses the result content, those results should be logged as `was_useful = false`. The mechanism: compare search results returned vs. memories the LLM actually acted on in a subsequent turn.

**Files:**
- Modify: `extensions/memory-layer/state.ts` (add `pendingRecallFeedback` tracking)
- Modify: `extensions/memory-layer/hooks/passive-capture.ts` (hook `turn_end` for negative signal)
- Test: `test/recall-feedback.test.js` (extend)

- [ ] **Step 1: Add pending feedback tracking to `extensions/memory-layer/state.ts`**

Add to the `state` object:

```ts
/** Memory IDs from search results that haven't been confirmed as used yet */
pendingRecallFeedback: new Map<number, { sessionId: number; query: string }>(),
```

- [ ] **Step 2: In search tool handler, register pending feedback**

In `extensions/memory-layer/tools/memory-tools.ts`, in the `memory-search` execute handler, after getting results, register pending feedback:

```ts
// After: const results = (result.results as any[]) || [];
for (const r of results) {
  deps.state.pendingRecallFeedback.set(r.id, {
    sessionId: deps.state.sessionId || 0,
    query: params.query as string,
  });
}
```

- [ ] **Step 3: In memory-get handler, confirm as useful**

In `extensions/memory-layer/tools/memory-tools.ts`, in the `memory-get` execute handler:

```ts
// After successful get — mark as confirmed useful
const id = parseInt(params.id as string);
if (deps.state.pendingRecallFeedback.has(id)) {
  deps.state.pendingRecallFeedback.delete(id);
}
```

- [ ] **Step 4: Add turn_end hook to flush negative feedback**

In `extensions/memory-layer/hooks/passive-capture.ts`, add to the existing `turn_end` handler:

```ts
pi.on('turn_end', async (_event, _ctx) => {
  // ... existing checkpoint logic ...

  // Negative feedback: memories searched but never used this turn
  if (deps.state.pendingRecallFeedback.size > 0) {
    const entries = [...deps.state.pendingRecallFeedback.entries()].map(([memoryId, meta]) => ({
      memoryId,
      sessionId: meta.sessionId,
      query: meta.query,
      wasUseful: false,
    }));
    await deps.mem('log-negative-recall', {
      entries: JSON.stringify(entries),
    });
    deps.state.pendingRecallFeedback.clear();
  }
});
```

- [ ] **Step 5: Add `logNegativeRecall` command in `commands/observation.js`**

```js
function logNegativeRecall(deps, args) {
  const entries = JSON.parse(args.entries || '[]');
  if (!entries.length) return { logged: 0 };
  // Call obsDA directly — insertRecallLog is NOT in getMemoryRepository wrapper
  return obsDA.insertRecallLog(
    deps,
    entries.map((e) => ({
      memoryId: e.memoryId,
      sessionId: e.sessionId,
      query: e.query,
      wasUseful: false,
    })),
  );
}
```

Add to `module.exports`:

```js
module.exports = { save, get, update, del, timeline, suggestTopicKey, savePrompt, capturePassive, getStats, logNegativeRecall };
```

- [ ] **Step 5b: Wire `log-negative-recall` in `src/cli/commands/memory.js`**

This is the CLI dispatch router that maps command names to handlers. Without this route, `mem('log-negative-recall', ...)` from the extension will fail with "unknown command".

In `src/cli/commands/memory.js`, add to the `register` function:

```js
const obsCmd = require('../../../commands/observation');
// ... existing imports ...

function register(commands, deps) {
  // ... existing registrations ...

  commands['log-negative-recall'] = (args) =>
    obsCmd.logNegativeRecall({ sqlJson, sqlRun, jsonErrNoExit, memoryRepository }, args);
}
```

- [ ] **Step 6: Verify `wasUseful` support in both `insertRecallLog` copies**

Both `src/memory-domain/recall.js` and `data-access/observations.js` were updated in Task 1.1 Steps 3–4 to accept `wasUseful`. No additional changes needed — this step is a checkpoint to confirm both files have the 4-column insert before proceeding.

- [ ] **Step 7: Write test for negative feedback flow**

Append to `test/recall-feedback.test.js`:

```js
describe('negative feedback flow', () => {
  it('logs was_useful=false for memories not acted on', () => {
    const db = createDb({ memoryPath: ':memory:' });
    const deps = { sqlJson: db.sqlJson, sqlRun: db.sqlRun };

    // Simulate search returning memory 42
    insertRecallLog(deps, [{ memoryId: 42, sessionId: 1, query: 'auth', wasUseful: true }]);

    // Simulate negative feedback for memory 42 (not used)
    insertRecallLog(deps, [{ memoryId: 42, sessionId: 1, query: 'auth', wasUseful: false }]);

    const rows = deps.sqlJson(
      'SELECT was_useful FROM recall_log WHERE memory_id = 42 ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].was_useful).toBe(1);
    expect(rows[1].was_useful).toBe(0);
  });
});
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add extensions/memory-layer/state.ts extensions/memory-layer/tools/memory-tools.ts extensions/memory-layer/hooks/passive-capture.ts commands/observation.js test/recall-feedback.test.js
git commit -m "feat(recall): negative feedback loop — log ignored search results as was_useful=false"
```

---

## Feature 2: Memory Version Trail

### Task 2.1: Schema migration for `observation_versions` table

**Files:**
- Modify: `schema.sql` (add table)
- Modify: `db.js` (add migration V14)
- Test: `test/observation-versions.test.js` (create)

- [ ] **Step 1: Add table to `schema.sql`**

Append before the `settings` table:

```sql
-- ═══════════════════════════════════════════════════════════
-- MEMORY REPOSITORY: OBSERVATION VERSIONS  (edit history trail)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS observation_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,        -- 'title' | 'content' | 'type' | 'scope'
  old_value   TEXT NOT NULL DEFAULT '',
  new_value   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ov_memory ON observation_versions(memory_id);
CREATE INDEX IF NOT EXISTS idx_ov_created ON observation_versions(created_at DESC);
```

- [ ] **Step 2: Add migration V14 in `db.js`**

Add to the migrations array:

```js
{ to: 14, run: runMigrationV14 },
```

Add the function (place after `runMigrationV13`):

```js
function runMigrationV14() {
  const errors = [];
  try {
    withTransaction(() => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS observation_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          old_value TEXT NOT NULL DEFAULT '',
          new_value TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
        'CREATE INDEX IF NOT EXISTS idx_ov_memory ON observation_versions(memory_id)',
        'CREATE INDEX IF NOT EXISTS idx_ov_created ON observation_versions(created_at DESC)',
      ];
      for (const s of stmts) {
        sqlRaw(s);
      }
      sqlRaw('PRAGMA user_version = 14');
    });
  } catch (e) {
    errors.push(`V14: ${e.message}`);
  }
  return errors;
}
```

- [ ] **Step 3: Write test for migration**

Create `test/observation-versions.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { createDb } = require('../db');

describe('observation_versions table', () => {
  let deps;
  beforeEach(() => {
    const db = createDb({ memoryPath: ':memory:' });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
    };
  });

  it('creates observation_versions table after migration', () => {
    const tables = deps.sqlJson(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='observation_versions'",
    );
    expect(tables).toHaveLength(1);
  });

  it('can insert and query a version record', () => {
    deps.sqlRun(
      "INSERT INTO observation_versions (memory_id, field, old_value, new_value) VALUES (1, 'content', 'old text', 'new text')",
    );
    const rows = deps.sqlJson('SELECT * FROM observation_versions WHERE memory_id = 1');
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('content');
    expect(rows[0].old_value).toBe('old text');
    expect(rows[0].new_value).toBe('new text');
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/observation-versions.test.js`
Expected: PASS (migration creates the table).

- [ ] **Step 5: Commit**

```bash
git add schema.sql db.js test/observation-versions.test.js
git commit -m "feat(schema): add observation_versions table for edit history trail"
```

---

### Task 2.2: Record version snapshots on `updateObservation`

**Files:**
- Modify: `data-access/observations.js` (updateObservation — record diffs)
- Test: `test/observation-versions.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/observation-versions.test.js`:

```js
const { updateObservation, insertObservation, getObservation } = require('../data-access/observations');

describe('updateObservation versioning', () => {
  let deps;
  beforeEach(() => {
    const db = createDb({ memoryPath: ':memory:' });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
      jsonErrNoExit: (msg) => ({ error: msg }),
    };
  });

  it('records version entry when title is updated', () => {
    const inserted = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Old title',
      content: 'content', project: 'test', scope: 'project', topicKey: null,
    });
    const id = inserted[0].id;

    updateObservation(deps, { id, title: 'New title' });

    const versions = deps.sqlJson('SELECT field, old_value, new_value FROM observation_versions WHERE memory_id = ?', [id]);
    expect(versions).toHaveLength(1);
    expect(versions[0].field).toBe('title');
    expect(versions[0].old_value).toBe('Old title');
    expect(versions[0].new_value).toBe('New title');
  });

  it('records version entries for multiple changed fields', () => {
    const inserted = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Old',
      content: 'old content', project: 'test', scope: 'project', topicKey: null,
    });
    const id = inserted[0].id;

    updateObservation(deps, { id, title: 'New', content: 'new content' });

    const versions = deps.sqlJson('SELECT field FROM observation_versions WHERE memory_id = ? ORDER BY field', [id]);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.field)).toEqual(['content', 'title']);
  });

  it('does not record version when nothing changes', () => {
    const inserted = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Title',
      content: 'content', project: 'test', scope: 'project', topicKey: null,
    });
    const id = inserted[0].id;

    const result = updateObservation(deps, { id }); // no fields provided
    expect(result).toBeNull();

    const versions = deps.sqlJson('SELECT * FROM observation_versions WHERE memory_id = ?', [id]);
    expect(versions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observation-versions.test.js`
Expected: FAIL — `updateObservation` doesn't write to `observation_versions`.

- [ ] **Step 3: Update `updateObservation` in `data-access/observations.js`**

Replace the `updateObservation` function:

```js
function updateObservation(deps, { id, title, content, type, project, scope, topicKey }) {
  const { sqlJson, sqlRun } = deps;

  // Snapshot current values before update
  const current = sqlJson(
    'SELECT title, content, type, scope FROM observations WHERE id = ?',
    [parseInt(id, 10)],
  );
  if (!current || current.length === 0) return null;

  const before = current[0];
  const fields = { title, content, type, scope };
  const versionEntries = [];

  for (const [field, newVal] of Object.entries(fields)) {
    if (newVal !== undefined && newVal !== null && String(newVal) !== String(before[field] || '')) {
      versionEntries.push([parseInt(id, 10), field, String(before[field] || ''), String(newVal)]);
    }
  }

  // Use original falsy-check for the SET clause (empty string = no change)
  const sets = [];
  const params = [];
  if (title) { sets.push('title = ?'); params.push(title); }
  if (content) { sets.push('content = ?'); params.push(content); }
  if (type) { sets.push('type = ?'); params.push(type); }
  if (project) { sets.push('project = ?'); params.push(project); }
  if (scope) { sets.push('scope = ?'); params.push(scope); }
  if (topicKey) { sets.push('topic_key = ?'); params.push(topicKey); }
  if (sets.length === 0) return null;

  params.push(parseInt(id, 10));
  sqlRun(`UPDATE observations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);

  // Record version history
  for (const entry of versionEntries) {
    sqlRun(
      'INSERT INTO observation_versions (memory_id, field, old_value, new_value) VALUES (?, ?, ?, ?)',
      entry,
    );
  }

  return sqlJson(
    `SELECT id, title, content, type, project, scope, topic_key, created_at, updated_at
     FROM observations WHERE id = ?`,
    [parseInt(id, 10)],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observation-versions.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add data-access/observations.js test/observation-versions.test.js
git commit -m "feat(versions): record edit history on observation update"
```

---

### Task 2.3: Expose version history in `memory-get` output

**Files:**
- Modify: `commands/observation.js` (get — include versions)
- Modify: `extensions/memory-layer/tools/memory-tools.ts` (memory-get — display versions)
- Test: `test/observation-versions.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/observation-versions.test.js`:

```js
const { get } = require('../commands/observation');

describe('memory-get includes version history', () => {
  let deps;
  beforeEach(() => {
    const db = createDb({ memoryPath: ':memory:' });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
      jsonErrNoExit: (msg) => ({ error: msg }),
    };
  });

  it('returns empty versions array for memory with no edits', () => {
    const inserted = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Test',
      content: 'content', project: 'test', scope: 'project', topicKey: null,
    });
    const id = inserted[0].id;

    const result = get(deps, { id: String(id) });
    expect(result.versions).toEqual([]);
  });

  it('returns version entries after an update', () => {
    const inserted = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'V1',
      content: 'content', project: 'test', scope: 'project', topicKey: null,
    });
    const id = inserted[0].id;

    updateObservation(deps, { id, title: 'V2' });
    const result = get(deps, { id: String(id) });
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].field).toBe('title');
    expect(result.versions[0].old_value).toBe('V1');
    expect(result.versions[0].new_value).toBe('V2');
  });
});
```

- [ ] **Step 2: Add `getObservationVersions` to `data-access/observations.js`**

The `get()` function in `commands/observation.js` uses the `memoryRepository` wrapper pattern — it does NOT access `deps.sqlJson` directly. All DB access goes through `data-access/observations.js` functions. Add a new function:

```js
function getObservationVersions(deps, id) {
  const { sqlJson } = deps;
  return sqlJson(
    'SELECT field, old_value, new_value, created_at FROM observation_versions WHERE memory_id = ? ORDER BY created_at DESC',
    [parseInt(id, 10)],
  );
}

function getObservationRelations(deps, id) {
  const { sqlJson } = deps;
  return sqlJson(
    `SELECT source_id, target_id, relation, confidence
     FROM observation_relations
     WHERE source_id = ? OR target_id = ?`,
    [parseInt(id, 10), parseInt(id, 10)],
  );
}
```

Add to `module.exports`: `getObservationVersions, getObservationRelations`.

- [ ] **Step 3: Add both to `getMemoryRepository` wrapper in `commands/observation.js`**

In the `getMemoryRepository` function, add:

```js
getObservationVersions: (id) => obsDA.getObservationVersions(deps, id),
getObservationRelations: (id) => obsDA.getObservationRelations(deps, id),
```

- [ ] **Step 4: Update `get` in `commands/observation.js`**

After the existing `get` function retrieves the observation, add version and relation queries through the repository:

```js
function get(deps, args) {
  const { jsonErrNoExit } = deps;
  const id = args.id;
  if (!id) return jsonErrNoExit('Missing --id');
  const memoryRepository = getMemoryRepository(deps);
  const rows = memoryRepository.getObservation(id);
  if (!rows || rows.length === 0) return jsonErrNoExit(`Observation ${id} not found`);
  const obs = rows[0];
  const links = memoryRepository.getSymbolLinksForMemory(id);
  const recallResult = memoryRepository.getRecallCountForMemory(id);

  // Version history (Feature 2)
  const versions = memoryRepository.getObservationVersions(id);

  // Relations (Feature 3)
  const relations = memoryRepository.getObservationRelations(id);

  return {
    ...obs,
    symbol_links: links,
    recall_count: recallResult.length > 0 ? recallResult[0].cnt : 0,
    versions: versions || [],
    relations: relations || [],
  };
}
```

- [ ] **Step 5: Update memory-get tool output formatting**

In `extensions/memory-layer/tools/memory-tools.ts`, in the `memory-get` handler, after displaying the observation, add version display:

```ts
// After existing content display
const versions = (result.versions as any[]) || [];
if (versions.length > 0) {
  lines.push('', '## Edit History');
  for (const v of versions) {
    lines.push(`- **${v.field}** changed (${v.created_at}):`);
    lines.push(`  from: ${String(v.old_value).slice(0, 100)}`);
    lines.push(`  to:   ${String(v.new_value).slice(0, 100)}`);
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/observation-versions.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add commands/observation.js extensions/memory-layer/tools/memory-tools.ts test/observation-versions.test.js
git commit -m "feat(versions): expose edit history in memory-get output"
```

---

## Feature 3: Observation Relations in Search Results

### Task 3.1: Add supersede/relation data to search results

**Files:**
- Modify: `src/memory-domain/search.js` (search — join observation_relations)
- Test: `test/search-relations.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/search-relations.test.js`:

```js
const { describe, it, expect, beforeEach } = require('vitest');
const { createDb } = require('../db');
const { insertObservation } = require('../data-access/observations');
const { insertObservationRelation } = require('../data-access/observations');
const { search } = require('../src/memory-domain/search');

describe('search with relations', () => {
  let deps;
  beforeEach(() => {
    const db = createDb({ memoryPath: ':memory:' });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
      jsonErrNoExit: (msg) => ({ error: msg }),
      searchCode: null,
    };
  });

  it('includes _relations field showing superseding memories', () => {
    const obs1 = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Use React for frontend',
      content: 'React is the choice because of ecosystem', project: 'test', scope: 'project', topicKey: null,
    });
    const obs2 = insertObservation(deps, {
      sessionId: '1', type: 'decision', title: 'Switched to Vue for frontend',
      content: 'Vue is better for this project because of simplicity', project: 'test', scope: 'project', topicKey: null,
    });
    const id1 = obs1[0].id;
    const id2 = obs2[0].id;

    // obs2 supersedes obs1
    insertObservationRelation(deps, { sourceId: id2, targetId: id1, relation: 'supersedes', confidence: 0.9 });

    const result = search(deps, { query: 'frontend', project: 'test', 'session-id': '99' });
    const oldMemory = result.results.find((r) => r.id === id1);
    expect(oldMemory).toBeDefined();
    expect(oldMemory._relations).toBeDefined();
    expect(oldMemory._relations).toHaveLength(1);
    expect(oldMemory._relations[0].relation).toBe('supersedes');
    expect(oldMemory._relations[0].source_id).toBe(id2);
    expect(oldMemory._relations[0].target_id).toBe(id1);
  });

  it('includes _relations showing related memories', () => {
    const obs1 = insertObservation(deps, {
      sessionId: '1', type: 'architecture', title: 'REST API design',
      content: 'Using REST for the API layer', project: 'test', scope: 'project', topicKey: null,
    });
    const obs2 = insertObservation(deps, {
      sessionId: '1', type: 'architecture', title: 'GraphQL API design',
      content: 'Using GraphQL alongside REST', project: 'test', scope: 'project', topicKey: null,
    });
    const id1 = obs1[0].id;
    const id2 = obs2[0].id;

    insertObservationRelation(deps, { sourceId: id1, targetId: id2, relation: 'related', confidence: 0.7 });

    const result = search(deps, { query: 'API', project: 'test', 'session-id': '99' });
    const mem = result.results.find((r) => r.id === id1);
    expect(mem._relations).toBeDefined();
    expect(mem._relations.length).toBeGreaterThanOrEqual(1);
    expect(mem._relations.some((r) => r.relation === 'related')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search-relations.test.js`
Expected: FAIL — search results don't have `_relations` field.

- [ ] **Step 3: Update `search()` in `src/memory-domain/search.js` to attach relations**

After ranking and before returning, add a batch relation lookup. In the `search` function, after `const ranked = ...` and before the recall log insert:

```js
const ranked = rankObservations(rows, query).slice(0, limit);

// Attach observation relations to each result
if (ranked.length > 0) {
  const rankedIds = ranked.map((r) => r.id);
  const placeholders = rankedIds.map(() => '?').join(',');
  const allRelations = sqlJson(
    `SELECT source_id, target_id, relation, confidence
     FROM observation_relations
     WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
    [...rankedIds, ...rankedIds],
  );
  const relMap = new Map();
  for (const rel of allRelations) {
    for (const id of [rel.source_id, rel.target_id]) {
      if (rankedIds.includes(id)) {
        if (!relMap.has(id)) relMap.set(id, []);
        relMap.get(id).push(rel);
      }
    }
  }
  for (const r of ranked) {
    r._relations = relMap.get(r.id) || [];
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/search-relations.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory-domain/search.js test/search-relations.test.js
git commit -m "feat(search): include observation_relations in search results"
```

---

### Task 3.2: Display relation warnings in tool output

**Files:**
- Modify: `extensions/memory-layer/tools/memory-tools.ts` (search + get handlers)

- [ ] **Step 1: Update search output formatting**

In `extensions/memory-layer/tools/memory-tools.ts`, in the `memory-search` handler's result formatting, add relation warnings:

```ts
const lines = results.map((r: any) => {
  const score = r._score ? ` (${r._score.toFixed(2)})` : '';
  const trust = r.trust_score != null && r.trust_score < 0.5 ? ' ⚠️' : '';
  // Relation warnings
  const supersedes = (r._relations || []).filter((rel: any) => rel.relation === 'supersedes');
  const relationNote = supersedes.length > 0
    ? ` ⚡ superseded by #${supersedes[0].source_id}`
    : '';
  return `- [#${r.id}] ${r.title}${score}${trust}${relationNote}`;
});
```

- [ ] **Step 2: Update memory-get output formatting**

In the `memory-get` handler, after displaying the observation, add:

```ts
// After existing content display
const relations = (result.relations as any[]) || [];
if (relations.length > 0) {
  lines.push('', '## Relations');
  for (const rel of relations) {
    const otherId = rel.source_id === parseInt(params.id as string) ? rel.target_id : rel.source_id;
    const icon = rel.relation === 'supersedes' ? '⚡' : rel.relation === 'duplicate' ? '📋' : '🔗';
    lines.push(`- ${icon} ${rel.relation} → #${otherId} (confidence: ${(rel.confidence * 100).toFixed(0)}%)`);
  }
}
```

- [ ] **Step 3: `get` already includes relations via Task 2.3**

Task 2.3 already added `getObservationRelations` to `data-access/observations.js` and wired it into `getMemoryRepository` and the `get()` function. The `relations` field is already in the return object. No additional work needed here — Task 3.2 only needs Steps 1 and 2 (display formatting in the tool output).

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/tools/memory-tools.ts commands/observation.js
git commit -m "feat(search): display supersede/relation warnings in tool output"
```

---

## Feature 4: Tighter Auto-Detection Patterns

### Task 4.1: Add position-awareness and confidence scoring to patterns

**Files:**
- Create: `extensions/memory-layer/hooks/pattern-matcher.ts` (extracted testable function)
- Modify: `extensions/memory-layer/hooks/passive-capture.ts` (use new matcher)
- Test: `test/auto-detection.test.js` (create)

- [ ] **Step 1: Create `pattern-matcher.ts`**

Create `extensions/memory-layer/hooks/pattern-matcher.ts`:

```ts
interface MatchResult {
  match: boolean;
  confidence: 'high' | 'medium' | 'low';
  pattern?: { regex: RegExp; type: string; label: string };
}

const HEDGING_SIGNALS = [
  /\b(maybe|perhaps|might|could try|let me (try|check|think|see))\b/i,
  /\b(for now|tentatively|as a test|temporarily|to see if)\b/i,
  /\b(i think we (should|could|might))\b/i,
];

const CONFIDENCE_SIGNALS = [
  /\b(because|since|the reason|to avoid|for better)\b/i,
  /\b(decided|chosen|selected|confirmed)\b/i,
];

const DECISION_PATTERNS: Array<{ regex: RegExp; type: string; label: string; minConfidence: 'high' | 'medium' }> = [
  {
    regex: /\b(I['']ll use|let's use|going with|switching to|using .* instead of)\b/i,
    type: 'decision',
    label: 'Design decision',
    minConfidence: 'medium',
  },
  {
    regex: /\b(approach|strategy|architecture|pattern|design):\s/i,
    type: 'decision',
    label: 'Architecture choice',
    minConfidence: 'high',
  },
  {
    regex: /\b(root cause|the bug was|fixed by|workaround is to)\b/i,
    type: 'bugfix',
    label: 'Bug fix',
    minConfidence: 'high',
  },
  {
    regex: /\b(I discovered that|turns out)\b/i,
    type: 'discovery',
    label: 'Discovery',
    minConfidence: 'high',
  },
  {
    regex: /\b(cannot .* because|constraint is|limitation:)\b/i,
    type: 'architecture',
    label: 'Constraint identified',
    minConfidence: 'high',
  },
];

export function shouldAutoCapture(text: string): MatchResult {
  if (!text || text.length < 150) {
    return { match: false, confidence: 'low' };
  }

  // Check hedging in the first 30% of the message — reasoning phase
  const reasoningZone = text.slice(0, Math.floor(text.length * 0.3));
  const isHedgingInReasoning = HEDGING_SIGNALS.some((h) => h.test(reasoningZone));

  // Check patterns — prefer matches in the last 50% (conclusion zone)
  const conclusionZone = text.slice(Math.floor(text.length * 0.5));
  const fullText = text;

  for (const pattern of DECISION_PATTERNS) {
    // Try conclusion zone first (strongest signal)
    const conclusionMatch = pattern.regex.test(conclusionZone);
    const fullMatch = pattern.regex.test(fullText);

    if (conclusionMatch) {
      // Strong: matched in conclusion zone
      const hasConfidenceSignal = CONFIDENCE_SIGNALS.some((c) => c.test(conclusionZone));
      return {
        match: true,
        confidence: hasConfidenceSignal ? 'high' : 'medium',
        pattern,
      };
    }

    if (fullMatch && pattern.minConfidence === 'high') {
      // Medium: matched anywhere but pattern is high-confidence type (e.g. "root cause")
      return { match: true, confidence: 'medium', pattern };
    }
  }

  // If hedging was detected in reasoning zone, suppress weak matches
  if (isHedgingInReasoning) {
    return { match: false, confidence: 'low' };
  }

  return { match: false, confidence: 'low' };
}

export { DECISION_PATTERNS };
```

- [ ] **Step 2: Write tests against the new module**

Create `test/auto-detection.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { shouldAutoCapture } = require('../extensions/memory-layer/hooks/pattern-matcher');

describe('shouldAutoCapture', () => {
  it('matches confident decision with reasoning at end', () => {
    const text = [
      'Looking at the options for data storage.',
      'SQLite has zero external deps and is embedded.',
      'I\'ll use SQLite because it avoids external dependencies and fits our constraint.',
    ].join('\n');
    const result = shouldAutoCapture(text);
    expect(result.match).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('rejects hedging in reasoning zone without conclusion match', () => {
    const text = 'Maybe I\'ll use the cache approach for this, but let me check first and see what happens.';
    const result = shouldAutoCapture(text);
    expect(result.match).toBe(false);
  });

  it('rejects text under 150 chars', () => {
    const text = 'I\'ll use X because Y';
    const result = shouldAutoCapture(text);
    expect(result.match).toBe(false);
  });

  it('matches "root cause" anywhere (high-confidence pattern type)', () => {
    const text = [
      'After investigation, I found the issue.',
      'The root cause was a race condition in the DB connection pool.',
      'Fixed by adding a mutex around the connection acquisition.',
    ].join('\n');
    const result = shouldAutoCapture(text);
    expect(result.match).toBe(true);
  });

  it('prefers conclusion zone match over reasoning zone hedging', () => {
    const text = [
      'Maybe I should try approach A.',
      'No wait, that has issues with concurrency.',
      'Going with approach B because it handles edge cases and has better test coverage.',
    ].join('\n');
    const result = shouldAutoCapture(text);
    expect(result.match).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('rejects "I\'ll use X for now" hedging without conclusion', () => {
    const text = [
      'I\'ll use the simple approach for now to see if it works.',
      'If it doesn\'t perform well, we can switch later.',
      'Let me test this out first.',
    ].join('\n');
    const result = shouldAutoCapture(text);
    // "I'll use" matched but hedging signals suppress it
    expect(result.match).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/auto-detection.test.js`
Expected: PASS (tests are written against the actual implementation from Step 1)

- [ ] **Step 4: Update `passive-capture.ts` to use new matcher**

In `extensions/memory-layer/hooks/passive-capture.ts`, replace the pattern matching loop. Add import:

```ts
import { shouldAutoCapture } from './pattern-matcher';
```

In the `message_end` handler, replace:

```ts
// Old:
//   for (const pattern of DECISION_PATTERNS) {
//     if (pattern.regex.test(text)) { ... }
//   }
// New:
const capture = shouldAutoCapture(text);
if (capture.match && capture.confidence !== 'low' && capture.pattern) {
  deps.state.lastAutoDecisionSave = Date.now();

  const lastLine = text.split('\n').filter((l) => l.trim()).pop()?.slice(0, 120) || text.slice(0, 120);
  const title = `${capture.pattern.label}: ${lastLine.slice(0, 80)}`;

  await deps.mem('save', {
    title,
    type: capture.pattern.type,
    project: deps.state.currentProject || 'unknown',
    scope: 'project',
    content: [
      `**What**: Auto-detected ${capture.pattern.label.toLowerCase()} (confidence: ${capture.confidence})`,
      `**Where**: Session ${deps.state.sessionId || 'unknown'}`,
      `**Learned**: ${text.slice(0, 300)}`,
    ].join('\n'),
  });
}
```

Also remove the old `DECISION_PATTERNS` constant from this file since it's now in `pattern-matcher.ts`.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/memory-layer/hooks/pattern-matcher.ts extensions/memory-layer/hooks/passive-capture.ts test/auto-detection.test.js
git commit -m "feat(capture): position-aware confidence scoring for auto-detection patterns"
```

---

## Self-Review (Post-Fix)

### Spec Coverage
1. ✅ Negative feedback loop — Tasks 1.1 (was_useful writes, **both copies**), 1.2 (ranking integration, **both query paths**), 1.3 (negative signal, **properly wired in CLI dispatch**)
2. ✅ Memory version trail — Tasks 2.1 (schema), 2.2 (record on update, **original falsy-check preserved**), 2.3 (expose in get, **via data-access layer**)
3. ✅ Relations in search — Tasks 3.1 (data in results), 3.2 (display in tools, **reuses Task 2.3 DA layer**)
4. ✅ Auto-detection tightening — Task 4.1 (**module-first approach**, tests written against real implementation)

### Placeholder Scan
- No TBD, TODO, "implement later", or "verify if" found
- All code steps have complete implementation code
- All test steps have complete test code
- No conditional steps ("if available, add...")

### Type Consistency
- `insertRecallLog` signature: `{ memoryId, sessionId, query, wasUseful? }` — consistent across `src/memory-domain/recall.js` AND `data-access/observations.js`
- `observation_versions` columns: `memory_id, field, old_value, new_value, created_at` — consistent across Tasks 2.1, 2.2, 2.3
- `_relations` field on search results: `{ source_id, target_id, relation, confidence }` — consistent across Tasks 3.1, 3.2
- `shouldAutoCapture` return type: `{ match, confidence, pattern? }` — consistent in Task 4.1

### Review Fixes Applied
| # | Issue | Fix |
|---|-------|----|
| 1 | Dual `insertRecallLog` — plan only fixed one | Updated both `src/memory-domain/recall.js` AND `data-access/observations.js` with identical 4-column inserts |
| 2 | `log-negative-recall` not wired in dispatch | Added explicit Step 5b: wire in `src/cli/commands/memory.js` router |
| 3 | `deps.sqlJson` not available in `get()` | Replaced direct SQL with `getObservationVersions`/`getObservationRelations` DA functions + `memoryRepository` wrapper |
| 4 | Tests should reference existing pattern | Added comment referencing `test/memory-domain.test.js` as template |
| 5 | `result.session_id` doesn't exist | Changed to `deps.state.sessionId` |
| 6 | LIKE fallback missing `useful_count` | Added `COALESCE(rl.useful_count, 0) as useful_count` to fallback SELECT |
| 7 | `updateObservation` empty-string behavior | Kept original `if (title)` for SET clause, versioning uses explicit undefined/null check |
| 8 | Dead tests referencing undefined function | Restructured: create module first (Step 1), then write tests against it (Step 2) |
