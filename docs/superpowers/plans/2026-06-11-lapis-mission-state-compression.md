# LaPis Mission State Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LaPis's stubbed `/missions/:missionId/compression` endpoint with a real implementation that aggregates a mission's recent state (cost entries, research findings, handoff rationales, error verdicts) and compresses it through the existing `token-saver` module. Returns the structured `{ summary, tokensSaved, error? }` shape that the matching Aurex plan consumes.

**Architecture:** New module `src/compression/mission-state.js` that queries `cost_entries`, `agent_sessions`, `research_findings`, `validation_verdicts`, and `handoffs` (via existing repos or raw SQL), concatenates high-signal text fields, runs them through `token-saver/rules/generic.js` (which already handles arbitrary structured text), and stores the result. The HTTP handler at `src/http/handlers/compression.js` (currently a stub) wires the new module. A V21 migration creates the `mission_compression_log` table so compression history is queryable later. URL is `/missions/:missionId/compression` (with the `n`) — this is the existing route. **Note:** the matching Aurex plan also fixes a URL bug (Aurex currently calls `/compress` without the `ion`, causing 404s) so the two plans are coupled at the URL level.

**Tech Stack:** Node.js (CommonJS), better-sqlite3, existing `token-saver` module, existing V11+ migrations.

**Repo root:** `/home/genegulanesjr/Documents/GulanesKorp/LaPis/`

**Coupled with:** `2026-06-11-lapis-research-phase-wiring.md` (Aurex plan). This plan MUST land first; the Aurex plan depends on the response shape defined here.

---

## Background

Current state (verified by reading source):
- `src/http/handlers/compression.js` is a 12-line stub: `console.log("[compression] Skipped — not implemented…"); jsonOk(res, { accepted: true, skipped: true });`
- Route registered in `src/http/server.js` as `POST /missions/:missionId/compression`
- `token-saver/rules/generic.js` already compresses arbitrary text into `{ summary, importantOutput, omittedLines }` using a "head + tail + important keywords" strategy. **No new compression logic needed** — just plumbing.
- `db.js` is at V20 (PRAGMA user_version = 20). V11 added the Aurex `cost_entries` / `research_findings` / `validation_verdicts` / `handoffs` / `agent_sessions` tables. This plan adds V21.
- `Aurex/scripts/smoke-lapis.js:225-230` already asserts the stub shape `{ accepted: true, skipped: true }`. The matching Aurex plan updates that smoke to assert the new shape.

---

## File map

| File | Action | Task |
|---|---|---|
| `src/compression/mission-state.js` | Create | 1 |
| `test/compression-mission-state.test.js` | Create | 2 |
| `src/http/handlers/compression.js` | Modify (replace stub) | 3 |
| `test/smoke-compression-http.test.js` | Create | 4 |
| `db.js` | Modify (add V21 migration + accessor) | 5 |
| `Aurex/scripts/smoke-lapis.js:225-230` | Modify (update assertion) | 6 (Aurex plan) |

---

### Task 1: Create `mission-state.js` compression module

**Files:**
- Create: `src/compression/mission-state.js`

- [ ] **Step 1: Create the module file**

Create `src/compression/mission-state.js`:

```javascript
const { compressGeneric } = require('../token-saver/rules/generic');
const { estimateTokens } = require('../token-saver/estimate-tokens');

/**
 * Aggregate a mission's recent state into a single text blob, then run
 * it through the existing generic compressor. Returns a structured
 * CompressionResult that the HTTP handler persists and returns.
 *
 * @param {object} deps
 * @param {(sql: string, params?: any[]) => any[]} deps.sqlJson - SELECT helper
 * @param {string} deps.missionId
 * @param {number} [deps.windowSize=50] - max recent records per source
 * @returns {{ summary: string, tokensSaved: number, error?: string }}
 */
function compressMissionState({ sqlJson, missionId, windowSize = 50 }) {
  if (!missionId) {
    return { summary: '', tokensSaved: 0, error: 'missionId is required' };
  }

  const sections = [];

  // 1. Recent research findings (high-signal: domain knowledge)
  const findings = sqlJson(
    `SELECT title, content, relevance, status
     FROM research_findings
     WHERE mission_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [missionId, windowSize],
  );
  if (findings.length > 0) {
    sections.push(
      `## Research findings (${findings.length})\n` +
        findings
          .map(
            (f) =>
              `- [${f.relevance}/${f.status}] ${f.title}: ${f.content.slice(0, 200)}`,
          )
          .join('\n'),
    );
  }

  // NOTE: Handoffs are intentionally omitted. LaPis's writeHandoff handler
  // (src/http/handlers/handoffs.js) is currently a stub that returns
  // { accepted: true } without persisting to a table. There is no
  // `handoffs` table in the V11+ schema. When a real handoffs table is
  // added in a future migration, re-introduce the join against
  // working_units -> milestones -> handoffs here.

  // 2. Failed validation verdicts (what went wrong)
  // Schema note: validation_verdicts uses `timestamp`, not `created_at`.
  const verdicts = sqlJson(
    `SELECT vv.verdict, vv.findings, vv.failed_unit_ids
     FROM validation_verdicts vv
     JOIN validation_contracts vc ON vc.id = vv.contract_id
     JOIN milestones m ON m.id = vc.milestone_id
     WHERE m.mission_id = ? AND vv.verdict = 'fail'
     ORDER BY vv.timestamp DESC
     LIMIT ?`,
    [missionId, windowSize],
  );
  if (verdicts.length > 0) {
    sections.push(
      `## Failed verdicts (${verdicts.length})\n` +
        verdicts.map((v) => `- ${v.verdict}: ${v.findings?.slice(0, 200) ?? ''}`).join('\n'),
    );
  }

  // 3. Cost summary (cumulative)
  const costRows = sqlJson(
    `SELECT
       COALESCE(SUM(cost), 0) AS total_cost,
       COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
       COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
       COUNT(*) AS entry_count
     FROM cost_entries
     WHERE mission_id = ?`,
    [missionId],
  );
  if (costRows.length > 0 && costRows[0].entry_count > 0) {
    const c = costRows[0];
    sections.push(
      `## Cost summary\n${c.entry_count} entries, $${c.total_cost.toFixed(2)} total, ${c.total_prompt_tokens + c.total_completion_tokens} tokens`,
    );
  }

  if (sections.length === 0) {
    return {
      summary: 'Mission has no compressible state yet (no findings, verdicts, or cost entries).',
      tokensSaved: 0,
    };
  }

  const combined = sections.join('\n\n');
  const originalTokens = estimateTokens(combined);

  const compressed = compressGeneric({
    stdout: combined,
    stderr: '',
    exitCode: 0,
  });

  const compressedTokens = estimateTokens(compressed.importantOutput || '');
  const tokensSaved = Math.max(0, originalTokens - compressedTokens);

  return {
    summary: compressed.summary,
    tokensSaved,
  };
}

module.exports = { compressMissionState };
```

- [ ] **Step 2: Verify the file parses (lint/syntax check)**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/LaPis && node -c src/compression/mission-state.js`
Expected: exit 0 (no syntax errors).

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add src/compression/mission-state.js
git commit -m "feat(compression): mission state aggregator using token-saver generic rule"
```

---

### Task 2: Unit test for `compressMissionState`

**Files:**
- Create: `test/compression-mission-state.test.js`

- [ ] **Step 1: Write the test**

Create `test/compression-mission-state.test.js`. Inspect an existing test in `test/` to match its assertion style (vitest or node:test). Run `ls test/compression*` to confirm the existing convention.

Likely vitest based on `vitest.config.mjs` at repo root. Use this template:

```javascript
import { describe, it, expect } from 'vitest';
import { compressMissionState } from '../src/compression/mission-state.js';

function makeSqlJson(rowsByQuery) {
  return (sql, params) => {
    // Match by leading keyword + parameter shape
    if (/FROM research_findings/.test(sql)) return rowsByQuery.findings ?? [];
    if (/FROM validation_verdicts/.test(sql)) return rowsByQuery.verdicts ?? [];
    if (/FROM cost_entries/.test(sql)) return rowsByQuery.costs ?? [];
    return [];
  };
}

describe('compressMissionState', () => {
  it('returns an error when missionId is missing', () => {
    const result = compressMissionState({ sqlJson: makeSqlJson({}), missionId: '' });
    expect(result.error).toBeDefined();
    expect(result.tokensSaved).toBe(0);
  });

  it('returns a friendly empty-state summary when there is nothing to compress', () => {
    const result = compressMissionState({ sqlJson: makeSqlJson({}), missionId: 'm-1' });
    expect(result.summary).toMatch(/no compressible state/i);
    expect(result.tokensSaved).toBe(0);
  });

  it('aggregates findings, verdicts, and costs into a single summary', () => {
    const sqlJson = makeSqlJson({
      findings: [
        { title: 'Auth uses JWT', content: 'JWT signed with HS256, validated in middleware.ts', relevance: 'high', status: 'verified' },
      ],
      verdicts: [
        { verdict: 'fail', findings: 'missing error handling on 401', failed_unit_ids: 'u-1' },
      ],
      costs: [
        { total_cost: 1.5, total_prompt_tokens: 1000, total_completion_tokens: 500, entry_count: 3 },
      ],
    });
    const result = compressMissionState({ sqlJson, missionId: 'm-1' });
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns tokensSaved >= 0 even when compression does not shrink input', () => {
    const sqlJson = makeSqlJson({
      findings: [{ title: 'a', content: 'b', relevance: 'low', status: 'unverified' }],
    });
    const result = compressMissionState({ sqlJson, missionId: 'm-1' });
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/LaPis && npx vitest run test/compression-mission-state.test.js`
Expected: 4 tests pass.

If the existing test convention is node:test (not vitest), convert: import `{ test }` from `node:test`, replace `describe`/`it` with `test`, and use `node:assert/strict`. Check `test/db.test.js` or another similar unit test for the exact style.

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add test/compression-mission-state.test.js
git commit -m "test(compression): cover mission-state aggregator edge cases"
```

---

### Task 3: Replace the stub HTTP handler

**Files:**
- Modify: `src/http/handlers/compression.js`

- [ ] **Step 1: Inspect the current stub**

```javascript
const { jsonOk } = require('../errors');

function runCompression() {
  return async (req, res, ctx) => {
    const trigger = ctx.body?.trigger || 'manual';
    const missionId = ctx.params.missionId;
    console.log(`[compression] Skipped — not implemented (trigger: ${trigger}, missionId: ${missionId})`);
    jsonOk(res, { accepted: true, skipped: true });
  };
}

module.exports = { runCompression };
```

- [ ] **Step 2: Replace with the real handler**

Replace the entire contents of `src/http/handlers/compression.js` with:

```javascript
const { jsonOk, jsonError } = require('../errors');
const { compressMissionState } = require('../../compression/mission-state');
const { getDb } = require('../../../db');
const { recordCompressionRun } = require('../../compression/persistence');

function runCompression() {
  return async (req, res, ctx) => {
    const trigger = ctx.body?.trigger || 'manual';
    const missionId = ctx.params.missionId;

    if (!missionId) {
      return jsonError(res, 400, 'missionId is required');
    }

    let db;
    try {
      db = getDb();
    } catch (e) {
      console.error(`[compression] db unavailable for ${missionId}:`, e.message);
      return jsonError(res, 500, 'database unavailable');
    }

    const sqlJson = (sql, params = []) => {
      try {
        return db.prepare(sql).all(...params);
      } catch (e) {
        console.error(`[compression] query failed:`, e.message, '\n', sql);
        return [];
      }
    };

    let result;
    try {
      result = compressMissionState({ sqlJson, missionId });
    } catch (e) {
      console.error(`[compression] compress threw for ${missionId}:`, e.message);
      return jsonOk(res, {
        summary: null,
        tokensSaved: 0,
        error: e.message,
      });
    }

    // Persist so compression history is queryable later.
    try {
      recordCompressionRun({ missionId, trigger, result });
    } catch (e) {
      console.warn(`[compression] persistence failed (non-fatal):`, e.message);
    }

    console.log(
      `[compression] ${trigger} for ${missionId}: saved ${result.tokensSaved} tokens, summary=${result.summary?.slice(0, 80) ?? '(empty)'}…`,
    );

    return jsonOk(res, result);
  };
}

module.exports = { runCompression };
```

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add src/http/handlers/compression.js
git commit -m "feat(compression): real mission-state compression handler with structured response"
```

---

### Task 4: HTTP smoke test for the new endpoint

**Files:**
- Create: `test/smoke-compression-http.test.js`

- [ ] **Step 1: Write the test**

Create `test/smoke-compression-http.test.js`. Match the existing test style (check `test/smoke-compression.js` for the assertion style — it uses a hand-rolled `assert()` helper, not vitest, and mocks the ExtensionAPI).

Use this template (adjust to match existing style if it differs):

```javascript
const assert = require('node:assert');
const test = require('node:test');
const { createHttpServer } = require('../src/http/server');
const { createDb } = require('../db');

test('POST /missions/:id/compression returns structured CompressionResult', async () => {
  const db = createDb(':memory:');
  const missionId = 'm-test-1';
  db.prepare('INSERT INTO missions (id, description, status, config_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    missionId, 'test mission', 'running', '{}', new Date().toISOString(),
  );
  // Seed a cost entry so compressMissionState has something to summarize
  db.prepare('INSERT INTO cost_entries (id, mission_id, agent_session_id, model, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'c-1', missionId, 's-1', 'test-model', 100, 50, 0.01,
  );

  const server = createHttpServer({ db });
  const { port } = await new Promise((resolve) => {
    server.listen(0, () => resolve({ port: server.address().port }));
  });

  const res = await fetch(`http://127.0.0.1:${port}/missions/${missionId}/compression`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trigger: 'post_milestone' }),
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(typeof body.summary, 'string');
  assert.strictEqual(typeof body.tokensSaved, 'number');
  assert.ok(body.tokensSaved >= 0);

  server.close();
});
```

If `createHttpServer` takes a different dep shape (e.g. `{ sqlRun, sqlJson }` or a `aurex` adapter), inspect `src/http/server.js:10-30` and `src/http/server.js:40-70` to confirm. The current handler now uses `getDb()` directly, so the test just needs to provide a valid in-memory DB.

- [ ] **Step 2: Run the test**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/LaPis && node --test test/smoke-compression-http.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add test/smoke-compression-http.test.js
git commit -m "test(compression): HTTP smoke for structured CompressionResult response"
```

---

### Task 5: V21 migration — `mission_compression_log` table

**Files:**
- Modify: `db.js` (add V21 function + register in migrations array)

- [ ] **Step 1: Locate the V20 migration and the migrations array**

Read `db.js` around lines 456-485 to see the migrations array structure. Each entry is `{ to, run: async (deps) => {...} }`. The V20 function ends around line 1290 with `PRAGMA user_version = 20`.

- [ ] **Step 2: Add the V21 function after V20**

Find the end of `runMigrationV20` (the closing `}` before V21 — currently V20 is the last migration). After it, add:

```javascript
function runMigrationV21() {
  const errors = [];
  try {
    withTransaction(() => {
      sqlRaw(`
        CREATE TABLE IF NOT EXISTS mission_compression_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
          trigger TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          tokens_saved INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_compression_log_mission ON mission_compression_log(mission_id)');
      sqlRaw('PRAGMA user_version = 21');
    });
  } catch (e) {
    errors.push(`V21: ${e.message}`);
  }
  return errors;
}
```

- [ ] **Step 3: Register V21 in the migrations array**

Find the `migrations` array in `db.js` (around line 456). It contains objects like `{ to: 20, run: runMigrationV20 }`. Add a new entry at the end:

```javascript
    { to: 21, run: runMigrationV21 },
```

- [ ] **Step 4: Create the persistence helper used by the HTTP handler**

Create `src/compression/persistence.js`:

```javascript
const { getDb } = require('../../db');

/**
 * Record a compression run in the mission_compression_log table.
 * Failures are non-fatal; the handler logs a warning.
 */
function recordCompressionRun({ missionId, trigger, result }) {
  const stmt = `INSERT INTO mission_compression_log
    (mission_id, trigger, summary, tokens_saved, error)
    VALUES (?, ?, ?, ?, ?)`;
  const db = getDb();
  db.prepare(stmt).run(
    missionId,
    trigger,
    result.summary ?? '',
    result.tokensSaved ?? 0,
    result.error ?? null,
  );
}

module.exports = { recordCompressionRun };
```

(The persistence module is at `src/compression/persistence.js`. From there, `../../db` lands at the repo root, where `db.js` exports `getDb`. This is the same import pattern `src/http/handlers/costs.js` uses.)

Then in the HTTP handler (Task 3), change the call site from `recordCompressionRun({ sqlJson, missionId, trigger, result })` to `recordCompressionRun({ missionId, trigger, result })` (drop the unused `sqlJson` param).

- [ ] **Step 5: Run the existing DB tests to verify migration ordering**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/LaPis && npx vitest run test/db.test.js 2>/dev/null || node --test test/db.test.js`
Expected: PASS — the new V21 migration runs cleanly on a fresh DB and is a no-op on existing V20 DBs.

- [ ] **Step 6: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add db.js src/compression/persistence.js
git commit -m "feat(db): V21 mission_compression_log table and persistence helper"
```

---

## Self-review

**1. Spec coverage (the gap from the Aurex plan):**
- LaPis returns `{ summary, tokensSaved, error? }` — ✅ matches what Aurex's `CompressionResult` expects.
- The endpoint is real, not a stub — ✅ Task 3 replaces the stub.
- A test exists in LaPis verifying the new shape — ✅ Task 4 HTTP smoke + Task 2 unit tests.
- A migration is included so compression history persists — ✅ Task 5 V21.

**2. URL fix:**
- LaPis route is `/missions/:missionId/compression` (verified in `src/http/server.js`)
- The Aurex plan fixes `/compress` → `/compression` so the two halves line up

**3. Placeholder scan:** No "TBD" / "implement later". All step code is complete (with one place where the engineer is told to inspect the existing test convention — `node:test` vs vitest — which is verified by running `ls test/` not by guessing).

**4. Type/shape consistency:**
- Response shape `{ summary: string|null, tokensSaved: number, error?: string }` is identical to the `CompressionResult` interface defined in the matching Aurex plan (Task 1, Step 3). The two plans must stay in sync.

**5. Migration ordering:** V21 only runs on DBs at V20 or below. The new table doesn't conflict with Aurex's V11+ tables (different schemas, different `mission_id` namespaces).

---

## Verification

After all tasks complete:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
npx vitest run                              # all unit tests pass
node --test test/smoke-compression-http.test.js   # HTTP smoke passes
lapis serve &                               # start server
sleep 2
curl -X POST http://localhost:9100/missions/m-test-1/compression \
  -H 'content-type: application/json' \
  -d '{"trigger":"manual"}'
# Expected: {"summary":"...","tokensSaved":N}
```

**Total commits:** 5 (one per task).

## Handoff to Aurex plan

After this plan merges:

1. The LaPis endpoint at `POST /missions/:missionId/compression` returns `{ summary, tokensSaved, error? }`
2. Update the Aurex smoke test at `Aurex/scripts/smoke-lapis.js:225-230` to assert the new shape (the matching Aurex plan, Task 6, does this).
3. The Aurex plan can then execute Tasks 1, 2, 4, 5 against the real endpoint.

If LaPis cannot ship this plan (e.g. resource constraints), the Aurex plan should be **deferred** rather than shipping against the stub.
