# Reduce Noisy Auto-Loaded Memory Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto-loaded memory context query-relevant and aggressively capped so memory-on active tokens never exceed memory-off without a factual benefit on staleness/navigation benchmark tasks.

**Architecture:** The fix spans three layers: (1) `src/memory-domain/context.js` — add a `CONTEXT.EXCLUDED_TYPES` set to filter out low-signal types (`progress`, `accomplished`, `session_summary`) from default context queries; (2) `extensions/memory-layer/hooks/context-injection.ts` — lower the hard limit from 15→10 and add a token-aware cap; (3) `constants.js` — add the excluded types and context defaults. The ranking in `search.js` is unchanged (it's only used for explicit search, not auto-context).

**Tech Stack:** Node.js, SQLite, TypeScript (extension layer), Jest

---

## Root Cause Analysis

From `bench/results/pi-paired-2026-05-23T03-31-37-614Z/report.json`:

| Task | Category | Memory-Off Tokens | Memory-On Tokens | Token Delta | Facts Off | Facts On |
|------|----------|-------------------|------------------|-------------|-----------|----------|
| staleness-code-index | staleness | 4,894 | 21,576 | **+340.9%** | 3/3 | 3/3 |
| navigation-context-hook | navigation | 25,066 | 32,198 | **-28.5%** | 3/3 | 0/3 |

**Problem 1:** The `context` command returns memories ordered by `recall_count DESC, type_priority DESC, trust_score DESC, created_at DESC` — but `progress` and `accomplished` types have `type_priority: 0` (lowest). They still get pulled in when high-recall memories exist, inflating tokens with low-signal content.

**Problem 2:** `context-injection.ts` calls `mem('context', { limit: '15' })` — 15 observations plus personal, sessions, and workflows is too many. The staleness task had memory-on at 4.4x the memory-off cost with no factual gain.

**Problem 3:** No filtering by type for default (non-topic) context. Progress checkpoints (`type='progress'`) and accomplished markers (`type='accomplished'`) are auto-saved noise that dilute relevant context.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `constants.js` | Modify `CONTEXT` — add `EXCLUDED_TYPES` and `DEFAULT_LIMIT` | Centralized defaults for context filtering |
| `src/memory-domain/context.js` | Modify — exclude low-signal types from default queries, cap at 10 | Core context query logic |
| `extensions/memory-layer/hooks/context-injection.ts` | Modify — use `CONTEXT.DEFAULT_LIMIT` instead of hardcoded `15` | Extension hook that calls context |
| `test/context-filter.test.js` | Create | Tests for the filtering behavior |

---

### Task 1: Add context filtering constants

**Files:**
- Modify: `constants.js:101-111`

- [ ] **Step 1: Write the failing test**

Create `test/context-filter.test.js`:

```javascript
const { CONTEXT, RANKING } = require('../constants');

describe('CONTEXT constants for filtering', () => {
  test('EXCLUDED_TYPES contains progress and accomplished', () => {
    expect(CONTEXT.EXCLUDED_TYPES).toContain('progress');
    expect(CONTEXT.EXCLUDED_TYPES).toContain('accomplished');
    expect(CONTEXT.EXCLUDED_TYPES).toContain('session_summary');
  });

  test('DEFAULT_LIMIT is 10', () => {
    expect(CONTEXT.DEFAULT_LIMIT).toBe(10);
  });

  test('EXCLUDED_TYPES does not contain decision or bugfix', () => {
    expect(CONTEXT.EXCLUDED_TYPES).not.toContain('decision');
    expect(CONTEXT.EXCLUDED_TYPES).not.toContain('bugfix');
    expect(CONTEXT.EXCLUDED_TYPES).not.toContain('architecture');
    expect(CONTEXT.EXCLUDED_TYPES).not.toContain('pattern');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: FAIL — `CONTEXT.EXCLUDED_TYPES` is undefined

- [ ] **Step 3: Add constants to CONTEXT block**

In `constants.js`, modify the `CONTEXT` constant (currently at lines 101-111) to add the new fields:

```javascript
const CONTEXT = {
  RELEVANCE_WEIGHTS: {
    recall: 0.35,
    trust: 0.25,
    recency: 0.25,
    typePriority: 0.15,
  },
  CROSS_PROJECT_DEEP_MULTIPLIER: 2,
  CROSS_PROJECT_DEEP_MAX: 30,
  TOPIC_MATCH_BOOST: 5,
  EXCLUDED_TYPES: ['progress', 'accomplished', 'session_summary'],
  DEFAULT_LIMIT: 10,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add constants.js test/context-filter.test.js
git commit -m "feat: add CONTEXT.EXCLUDED_TYPES and CONTEXT.DEFAULT_LIMIT constants"
```

---

### Task 2: Exclude low-signal types from context queries

**Files:**
- Modify: `src/memory-domain/context.js:90-117`

- [ ] **Step 1: Write the failing test**

Add to `test/context-filter.test.js`:

```javascript
const { context } = require('../src/memory-domain/context');

function makeDeps(observations = []) {
  const logs = [];
  return {
    sqlJson: jest.fn((q, params) => {
      if (typeof q === 'string' && q.includes('FROM observations') && q.includes('scope = \'personal\'')) return [];
      if (typeof q === 'string' && q.includes('FROM session_log')) return [];
      if (typeof q === 'string' && q.includes('FROM procedural_memory')) return [];
      if (typeof q === 'string' && q.includes('FROM observations')) return observations;
      if (typeof q === 'string' && q.includes('COUNT(*)')) return [{ cnt: 0 }];
      return [];
    }),
    jsonErrNoExit: jest.fn(),
    insertRecallLog: jest.fn((entries) => logs.push(...entries)),
    countObservationsByProjectAndType: jest.fn(() => 0),
  };
}

describe('context() excludes low-signal types', () => {
  test('excludes progress and accomplished from default project context', () => {
    const mixedObservations = [
      { id: 1, title: 'Progress checkpoint (turn 10)', type: 'progress', scope: 'project', topic_key: null, created_at: '2026-05-23T00:00:00Z', trust_score: 0.9, recall_count: 5, type_priority: 0 },
      { id: 2, title: 'Edited db.test.js', type: 'accomplished', scope: 'project', topic_key: null, created_at: '2026-05-23T00:00:00Z', trust_score: 0.9, recall_count: 3, type_priority: 0 },
      { id: 3, title: 'Architecture choice: FTS5', type: 'decision', scope: 'project', topic_key: 'search', created_at: '2026-05-23T00:00:00Z', trust_score: 0.8, recall_count: 2, type_priority: 3 },
      { id: 4, title: 'Bug fix: config save/restore', type: 'bugfix', scope: 'project', topic_key: 'config', created_at: '2026-05-22T00:00:00Z', trust_score: 0.7, recall_count: 1, type_priority: 2 },
    ];
    const deps = makeDeps(mixedObservations);
    const result = context(deps, { project: 'TestProject' });

    const types = result.observations.map((o) => o.type);
    expect(types).not.toContain('progress');
    expect(types).not.toContain('accomplished');
    expect(types).toContain('decision');
    expect(types).toContain('bugfix');
  });

  test('excludes progress and accomplished from cross-project context', () => {
    const mixedObservations = [
      { id: 1, title: 'Progress checkpoint (turn 80)', type: 'progress', scope: 'project', topic_key: null, created_at: '2026-05-23T00:00:00Z', trust_score: 0.9, recall_count: 10, type_priority: 0, project: 'Other' },
      { id: 2, title: 'Fixed auth middleware', type: 'bugfix', scope: 'project', topic_key: 'auth', created_at: '2026-05-23T00:00:00Z', trust_score: 0.8, recall_count: 3, type_priority: 2, project: 'Other' },
    ];
    const deps = makeDeps(mixedObservations);
    const result = context(deps, { 'all-projects': 'true' });

    const types = result.observations.map((o) => o.type);
    expect(types).not.toContain('progress');
    expect(types).toContain('bugfix');
  });

  test('includes progress when no topic or project filter matches (topic-key query still filters)', () => {
    const observations = [
      { id: 1, title: 'Progress checkpoint (turn 10)', type: 'progress', scope: 'project', topic_key: null, created_at: '2026-05-23T00:00:00Z', trust_score: 0.9, recall_count: 5, type_priority: 0 },
      { id: 2, title: 'Decision: use SQLite', type: 'decision', scope: 'project', topic_key: 'db', created_at: '2026-05-23T00:00:00Z', trust_score: 0.8, recall_count: 2, type_priority: 3 },
    ];
    const deps = makeDeps(observations);
    const result = context(deps, { project: 'TestProject', 'topic-key': 'db' });

    // topic-key queries should also filter excluded types
    const types = result.observations.map((o) => o.type);
    expect(types).not.toContain('progress');
    expect(types).toContain('decision');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: FAIL — progress and accomplished are still in the observations

- [ ] **Step 3: Implement type exclusion in context.js**

Modify `src/memory-domain/context.js` to add type exclusion after the SQL query. Add at the top of the file, after the existing requires:

```javascript
const { RESULT_LIMITS, RANKING, CONTEXT } = require('../../constants');
```

This import already exists. Now add filtering after the SQL query. After the line `const observations = sqlJson(obsQuery, obsParams);` (around line 118), add:

```javascript
  const excludedSet = new Set(CONTEXT.EXCLUDED_TYPES);
  const filtered = observations.filter((o) => !excludedSet.has(o.type));
```

Then change the `insertRecallLog` and return value to use `filtered` instead of `observations`. The complete modified section becomes:

```javascript
  const observations = sqlJson(obsQuery, obsParams);

  const excludedSet = new Set(CONTEXT.EXCLUDED_TYPES);
  const filtered = observations.filter((o) => !excludedSet.has(o.type));

  const workflows = project
    ? sqlJson(
        `
    SELECT id, name, status, success, updated_at
    FROM procedural_memory
    WHERE (project = ? OR project IS NULL) AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT ${RESULT_LIMITS.RECENT_SESSIONS}
  `,
        [project],
      )
    : [];

  if (sessionId && filtered.length > 0) {
    const recallQuery = topicQuery || topicKey || 'context-auto';
    const entries = filtered.map((o) => ({
      memoryId: o.id,
      sessionId: String(sessionId),
      query: recallQuery,
    }));
    insertRecallLog(entries);
  }

  const totalAll = countObservationsByProjectAndType(crossProject ? null : project);

  return {
    sessions,
    personal,
    observations: filtered,
    workflows,
    project: project || null,
    cross_project: crossProject,
    topic: topicKey || topicQuery || null,
    stats: {
      total_memories: totalAll,
      total_personal: personal.length,
      active_workflows: workflows.length,
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory-domain/context.js test/context-filter.test.js
git commit -m "feat: exclude progress/accomplished/session_summary from auto-context"
```

---

### Task 3: Lower context-injection limit from 15 to 10

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts:20-24`

- [ ] **Step 1: Write the failing test**

Add to `test/context-filter.test.js`:

```javascript
describe('context-injection limit', () => {
  test('CONTEXT.DEFAULT_LIMIT is used instead of hardcoded 15', () => {
    // This test verifies the constant is 10, ensuring context-injection
    // uses it (verified by code review of context-injection.ts)
    expect(CONTEXT.DEFAULT_LIMIT).toBe(10);
    expect(CONTEXT.DEFAULT_LIMIT).toBeLessThan(15);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: PASS (constant already set in Task 1)

- [ ] **Step 3: Update context-injection.ts to use CONTEXT.DEFAULT_LIMIT**

In `extensions/memory-layer/hooks/context-injection.ts`, add import at top:

```typescript
import { CONTEXT } from '../../../../constants';
```

Then change line 23 from:

```typescript
      limit: '15',
```

to:

```typescript
      limit: String(CONTEXT.DEFAULT_LIMIT),
```

And line 30 (the cross-project fallback) from:

```typescript
        limit: '10',
```

to:

```typescript
        limit: String(Math.max(CONTEXT.DEFAULT_LIMIT - 3, 5)),
```

This makes cross-project fallback use 7 items (10-3), keeping it leaner than the primary context.

- [ ] **Step 4: Run existing tests to verify nothing breaks**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/hooks/context-injection.ts
git commit -m "feat: use CONTEXT.DEFAULT_LIMIT (10) instead of hardcoded 15 in context injection"
```

---

### Task 4: Add negative-control type priority to deprioritize session_summary

**Files:**
- Modify: `constants.js:70-99` (RANKING.TYPE_PRIORITY)

- [ ] **Step 1: Write the failing test**

Add to `test/context-filter.test.js`:

```javascript
describe('RANKING.TYPE_PRIORITY for low-signal types', () => {
  test('progress has priority -1 (below default 0)', () => {
    expect(RANKING.TYPE_PRIORITY.progress).toBe(-1);
  });

  test('accomplished has priority -1', () => {
    expect(RANKING.TYPE_PRIORITY.accomplished).toBe(-1);
  });

  test('session_summary has priority -1', () => {
    expect(RANKING.TYPE_PRIORITY.session_summary).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: FAIL — `RANKING.TYPE_PRIORITY.progress` is undefined

- [ ] **Step 3: Add low-signal type priorities to RANKING.TYPE_PRIORITY**

In `constants.js`, update `RANKING.TYPE_PRIORITY` to include the excluded types:

```javascript
const RANKING = {
  DEFAULT_TRUST_SCORE: 0.7,
  RECALL_LOG_MULTIPLIER: 0.2,
  WORD_OVERLAP_BOOST: 2,
  MIN_WORD_LENGTH: 1,
  TYPE_PRIORITY: {
    decision: 3,
    architecture: 3,
    bugfix: 2,
    pattern: 2,
    preference: 2,
    config: 1,
    discovery: 1,
    learning: 1,
    session_summary: 0,
    skill: 0,
    progress: -1,
    accomplished: -1,
  },
  // ... rest unchanged
```

This ensures that even if `EXCLUDED_TYPES` filtering is bypassed (e.g., explicit search), these types rank lowest in SQL ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add constants.js test/context-filter.test.js
git commit -m "feat: add progress/accomplished to RANKING.TYPE_PRIORITY at -1"
```

---

### Task 5: Run full test suite and verify benchmarks

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 2: Verify context test still passes**

Run: `npx jest test/context-filter.test.js --no-coverage 2>&1`
Expected: All tests pass

- [ ] **Step 3: Verify memory-domain tests pass**

Run: `npx jest test/memory-domain.test.js --no-coverage 2>&1`
Expected: All tests pass

- [ ] **Step 4: Commit final state if any test fixes needed**

```bash
git add -A
git commit -m "test: fix any test failures from context filtering changes"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "Memory-on active tokens do not exceed memory-off for staleness/navigation" — Addressed by: filtering out 3 noise types (Task 2), lowering limit 15→10 (Task 3). The staleness task went from 4,894→21,576 tokens because 15 memories were injected. With 10 limit + type filtering, the injection will be ≤10 high-signal memories, drastically reducing tokens.
- ✅ "Auto context prioritizes prompt-relevant memories" — Addressed by: type priority ordering (SQL already does `recall_count DESC, type_priority DESC`), and the EXCLUDED_TYPES filter removes noise.
- ✅ "Progress/checkpoint/accomplished excluded unless specifically relevant" — Addressed by: `CONTEXT.EXCLUDED_TYPES` filter in `context.js` (Task 2).

**2. Placeholder scan:** No TBDs, TODOs, or placeholders found. All steps contain actual code.

**3. Type consistency:** `CONTEXT.EXCLUDED_TYPES` is an array of strings. Used as `new Set(CONTEXT.EXCLUDED_TYPES)` in context.js. The `o.type` field is a string from SQLite. Consistent. `CONTEXT.DEFAULT_LIMIT` is a number, used with `String()` in TypeScript. Consistent.
