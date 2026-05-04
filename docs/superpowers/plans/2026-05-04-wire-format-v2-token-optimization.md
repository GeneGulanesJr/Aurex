# Wire Format v2 — Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase wire format token savings from 31% actual to ~50%+ by encoding all homogeneous lists, stripping internal IDs, hoisting uniform columns, and compressing embedded arrays.

**Architecture:** Modify `wire-format.js` to (1) encode every homogeneous list in the payload, not just the largest, (2) add a `stripFields` option to omit internal-only fields like `symbol_id`, `id`, (3) add column hoisting for uniform values, (4) add embedded-array compression for fields like `signals: ["no_callers","unreachable_file"]`. All changes are backward-compatible via opt-in options with sensible defaults. `expandResponse` is updated to reverse all transformations for lossless round-trip. The bench harness (`bench-helper.js`, `bench-tokens.js`) is updated to measure actual savings from the new `compactResponse` output instead of using hardcoded design-doc estimates.

**Tech Stack:** Node.js, Vitest, existing `wire-format.js` module

**Repo:** `~/Documents/GulanesKorp/PiMemoryExtension`

---

## Current State (baseline)

Measured with `compactResponse(payload)` against real indexed data:

| Tool | Raw Payload | Current Compact | Current Savings |
|---|---|---|---|
| importance | 3,193B | 2,433B | 24% |
| hotspots | 5,188B | 2,868B | 45% |
| dead-code | 10,778B | 7,781B | 28% |
| coupling | 3,514B | 2,339B | 33% |
| extraction | 8,152B | 5,695B | 30% |
| cycles | 38B | 38B | 0% |
| import-graph | 8,989B | 7,277B | 19% |
| **TOTAL** | **39,852B** | **28,431B** | **29%** |

### Where bytes go (per-tool analysis)

**dead-code** (10,778B raw):
- `dead_symbols[46 items]` — 8,250B. Column breakdown: `file` 60%, `signals` 16%, `name` 13%, `symbol_id` 3%, `kind` 3%, `confidence` 2%
- `dead_files[15 items]` — 1,516B. Keys: `{id, path}`. `id` is internal DB ID.
- `total_symbols` — 2B scalar

**hotspots** (5,188B raw):
- `hotspots[20 items]` — all bytes. `file_path` 30%, `name` 6%, `hotspot_score` 6%, `risk` 4%, `unique_authors` is **uniform** (=1 across all rows)

**importance** (3,193B raw):
- `nodes[20 items]` — all bytes. `file_path` 47%, `name` 9%, `id` is internal DB ID

**extraction** (8,152B raw):
- `candidates[20 items]` — all bytes. `file_path` 30%, `justification` 24%, `name` 4%, `id` is internal DB ID

### Three root causes of remaining verbosity

1. **Only the largest list is encoded** — `dead_files` (1,516B), `total_symbols`, etc. stay as raw JSON
2. **Internal DB IDs are included** — `symbol_id`, `id` are meaningless to Pi but consume bytes in every row
3. **No column hoisting** — `unique_authors=1` repeated in all 20 hotspot rows (20B wasted); `signals=["no_callers","unreachable_file"]` repeated in all 46 dead-code rows (~1,500B wasted)

---

## File Map

| File | Responsibility |
|---|---|
| `wire-format.js` | Core encoding/decoding — ALL changes here (_encodeList, _decodeList, compactResponse, expandResponse) |
| `test/wire-format.test.js` | Tests for encoding/decoding — add new test cases |
| `bench/bench-helper.js` | Benchmark helper — fix `estimateRowCount` for `_meta` wrapper, update tool list |
| `bench/bench-tokens.js` | Benchmark runner — use actual `compactResponse` instead of hardcoded estimates |
| `memory-store.js` | CLI dispatcher — pass `stripFields` config to `compactResponse` (optional, Task 5) |

---

### Task 1: Encode ALL homogeneous lists, not just the largest

**Files:**
- Modify: `wire-format.js:226-241` (`_findEncodableList` → rename to `_findAllEncodableLists`)
- Modify: `wire-format.js:273-279` (`compactResponse`)
- Test: `test/wire-format.test.js`

The current `_findEncodableList` returns only the largest homogeneous list. Change `compactResponse` to iterate all fields and encode every homogeneous array.

- [ ] **Step 1: Write failing test — multi-list encoding**

Add test in `test/wire-format.test.js` inside the `compactResponse / expandResponse` describe block:

```javascript
it('should encode ALL homogeneous lists, not just the largest', () => {
  const data = {
    main_items: [
      { name: 'foo', kind: 'function', file: 'src/a.js' },
      { name: 'bar', kind: 'function', file: 'src/b.js' },
      { name: 'baz', kind: 'function', file: 'src/c.js' },
    ],
    secondary_items: [
      { id: 1, path: 'src/dead.js' },
      { id: 2, path: 'src/old.js' },
    ],
    count: 5,
  };
  const compact = wireFormat.compactResponse(data);
  // Both lists should be compact-encoded
  expect(compact.main_items._header).toBeDefined();
  expect(compact.main_items._rows).toBeDefined();
  expect(compact.secondary_items._header).toBeDefined();
  expect(compact.secondary_items._rows).toBeDefined();
  // Non-array scalar should pass through
  expect(compact.count).toBe(5);
});

it('should round-trip multi-list encoding via expandResponse', () => {
  const data = {
    symbols: [
      { name: 'a', kind: 'fn', score: 0.5 },
      { name: 'b', kind: 'fn', score: 0.8 },
    ],
    files: [
      { path: 'src/x.js', size: 100 },
      { path: 'src/y.js', size: 200 },
    ],
  };
  const compact = wireFormat.compactResponse(data);
  const expanded = wireFormat.expandResponse(compact);
  expect(expanded.symbols).toEqual(data.symbols);
  expect(expanded.files).toEqual(data.files);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js`
Expected: FAIL — `compactResponse` only encodes the largest list (`main_items`), `secondary_items` stays as raw array.

- [ ] **Step 3: Implement multi-list encoding in `compactResponse`**

Replace the body of `compactResponse` (line ~273-279) with logic that iterates all keys:

```javascript
function compactResponse(data, opts = {}) {
  if (!data || typeof data !== 'object') {return data;}

  let modified = false;
  const result = { ...data };

  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value) && _isHomogeneous(value) && value.length >= 2) {
      result[key] = _encodeList(value, opts);
      modified = true;
    }
  }

  return modified ? result : data;
}
```

- [ ] **Step 4: Update `expandResponse` to decode ALL compact lists**

Replace the body of `expandResponse` (line ~283-296) to handle multiple compact-encoded fields:

```javascript
function expandResponse(compact) {
  if (!compact || typeof compact !== 'object') {return compact;}

  const result = { ...compact };
  let modified = false;

  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === 'object' && value._header && value._rows) {
      result[key] = _decodeList(value);
      modified = true;
    }
  }

  return modified ? result : compact;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js`
Expected: ALL tests pass including new multi-list tests.

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: 210 tests pass, 0 failures.

- [ ] **Step 7: Run benchmark to measure improvement**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && node bench/bench-tokens.js > /tmp/bench-v2-step7.txt 2>&1 && cat /tmp/bench-v2-step7.txt`
Expected: dead-code savings increase from ~28% to ~30%+ (encoding `dead_files` too).

- [ ] **Step 8: Commit**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add wire-format.js test/wire-format.test.js
git commit -m "feat(wire-format): encode all homogeneous lists, not just largest"
```

---

### Task 2: Strip internal DB IDs (`symbol_id`, `id`) from encoded rows

**Files:**
- Modify: `wire-format.js` (`_encodeList`, new `_stripFields` helper)
- Modify: `wire-format.js` (`_decodeList` — need to restore stripped fields)
- Modify: `wire-format.js` (`compactResponse` — pass strip config)
- Modify: `wire-format.js` (`expandResponse` — handle stripped field restoration)
- Test: `test/wire-format.test.js`

Internal DB IDs (`symbol_id`, `id`) are meaningless to Pi — they're join keys for the SQLite schema. Stripping them from encoded rows saves ~3-6% per tool.

**Design:** Add `opts.stripFields` (array of field names) to `_encodeList`. The stripped field names are recorded in `_stripped: ['symbol_id']` so `expandResponse` can restore them as `null` (or we accept they're dropped since Pi never uses them).

- [ ] **Step 1: Write failing test — strip fields**

```javascript
it('should strip specified fields from encoded rows', () => {
  const rows = [
    { id: 100, name: 'foo', kind: 'function' },
    { id: 200, name: 'bar', kind: 'class' },
  ];
  const compact = wireFormat._encodeList(rows, { stripFields: ['id'] });
  expect(compact._header).toEqual(['name', 'kind']); // 'id' stripped
  expect(compact._stripped).toEqual(['id']);
  expect(compact._rows.length).toBe(2);
});

it('should round-trip stripped fields (restored as null)', () => {
  const rows = [
    { id: 100, name: 'foo', kind: 'function' },
    { id: 200, name: 'bar', kind: 'class' },
  ];
  const compact = wireFormat._encodeList(rows, { stripFields: ['id'] });
  const decoded = wireFormat._decodeList(compact);
  expect(decoded[0].id).toBeNull();
  expect(decoded[0].name).toBe('foo');
  expect(decoded[1].id).toBeNull();
  expect(decoded[1].name).toBe('bar');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js -t "strip specified fields"`
Expected: FAIL — `_encodeList` ignores `stripFields`.

- [ ] **Step 3: Implement field stripping in `_encodeList`**

In `_encodeList` (line ~51), after `const header = Object.keys(rows[0])`, add:

```javascript
// Filter out stripped fields from header
const stripSet = new Set(opts.stripFields || []);
const header = Object.keys(rows[0]).filter(k => !stripSet.has(k));
```

After building `result`, add:

```javascript
// Record stripped fields for round-trip
if (stripSet.size > 0) {
  result._stripped = [...stripSet].filter(k => Object.keys(rows[0]).includes(k));
}
```

- [ ] **Step 4: Implement field restoration in `_decodeList`**

In `_decodeList` (line ~117), after building each `obj` from header values, add restoration:

```javascript
// Restore stripped fields as null
if (compact._stripped) {
  for (const field of compact._stripped) {
    obj[field] = null;
  }
}
```

- [ ] **Step 5: Add `stripFields` passthrough in `compactResponse` and `expandResponse`**

In `compactResponse`, pass `opts` through to `_encodeList` (already done if Task 1 is complete — the `_encodeList(value, opts)` call already forwards opts).

In `expandResponse`, no change needed — `_decodeList` already reads `compact._stripped` from each compact field.

- [ ] **Step 6: Run tests**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js`
Expected: ALL pass.

- [ ] **Step 7: Run full suite**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: 210+ tests pass.

- [ ] **Step 8: Commit**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add wire-format.js test/wire-format.test.js
git commit -m "feat(wire-format): add stripFields option to omit internal DB IDs"
```

---

### Task 3: Hoist uniform columns (single-value optimization)

**Files:**
- Modify: `wire-format.js` (`_encodeList`, `_decodeList`)
- Test: `test/wire-format.test.js`

When every row has the same value in a column (e.g. `unique_authors: 1` in all hotspot rows, or `signals: ["no_callers"]` in all dead-code rows), hoist that value to a `_hoisted: { colName: value }` object and omit the column from rows. This saves `value_length × row_count - overhead` bytes.

**Design:** In `_encodeList`, detect columns where all values are identical (JSON-stringify comparison). Move them to `_hoisted`. In `_decodeList`, broadcast hoisted values back to every row.

- [ ] **Step 1: Write failing tests**

```javascript
it('should hoist columns where all rows have the same value', () => {
  const rows = [
    { name: 'foo', kind: 'function', count: 1 },
    { name: 'bar', kind: 'function', count: 1 },
    { name: 'baz', kind: 'function', count: 1 },
  ];
  const compact = wireFormat._encodeList(rows);
  expect(compact._header).not.toContain('count'); // hoisted out
  expect(compact._header).not.toContain('kind');  // hoisted out
  expect(compact._hoisted).toEqual({ kind: 'function', count: 1 });
});

it('should round-trip hoisted columns', () => {
  const rows = [
    { name: 'foo', kind: 'function', count: 1 },
    { name: 'bar', kind: 'function', count: 1 },
  ];
  const compact = wireFormat._encodeList(rows);
  const decoded = wireFormat._decodeList(compact);
  expect(decoded[0]).toEqual({ name: 'foo', kind: 'function', count: 1 });
  expect(decoded[1]).toEqual({ name: 'bar', kind: 'function', count: 1 });
});

it('should hoist array values that are identical across rows', () => {
  const rows = [
    { name: 'a', signals: ['no_callers', 'dead'] },
    { name: 'b', signals: ['no_callers', 'dead'] },
  ];
  const compact = wireFormat._encodeList(rows);
  expect(compact._header).not.toContain('signals');
  expect(compact._hoisted.signals).toEqual(['no_callers', 'dead']);
  const decoded = wireFormat._decodeList(compact);
  expect(decoded[0].signals).toEqual(['no_callers', 'dead']);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js -t "hoist"`
Expected: FAIL — no hoisting logic exists.

- [ ] **Step 3: Implement hoisting in `_encodeList`**

After building `header` and before the row-encoding loop, add:

```javascript
// Detect and hoist uniform columns (all rows have identical value)
const hoisted = {};
const activeHeader = header.filter(col => {
  if (stripSet.has(col)) {return false;}
  const firstVal = JSON.stringify(rows[0][col]);
  const allSame = rows.every(r => JSON.stringify(r[col]) === firstVal);
  if (allSame && rows.length >= 2) {
    hoisted[col] = rows[0][col];
    return false; // Remove from per-row encoding
  }
  return true;
});

// Use activeHeader instead of header for encoding
```

After building `result`, add:

```javascript
if (Object.keys(hoisted).length > 0) {
  result._hoisted = hoisted;
}
```

**Important:** Replace all `header` references in the encoding loop with `activeHeader`, and the stored `_header` should be `activeHeader`.

- [ ] **Step 4: Implement unhoisting in `_decodeList`**

After building each row `obj` from header values, add:

```javascript
// Broadcast hoisted values back to row
if (compact._hoisted) {
  for (const [key, val] of Object.entries(compact._hoisted)) {
    obj[key] = val;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run test/wire-format.test.js`
Expected: ALL pass.

- [ ] **Step 6: Run full suite**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: ALL pass.

- [ ] **Step 7: Run benchmark**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && node bench/bench-tokens.js > /tmp/bench-v2-step7.txt 2>&1 && cat /tmp/bench-v2-step7.txt`
Expected: hotspots and dead-code show improved savings (uniform columns hoisted).

- [ ] **Step 8: Commit**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add wire-format.js test/wire-format.test.js
git commit -m "feat(wire-format): hoist uniform columns to reduce repeated values"
```

---

### Task 4: Update benchmark harness to measure actual savings

**Files:**
- Modify: `bench/bench-tokens.js` — use actual `compactResponse` instead of hardcoded estimates
- Modify: `bench/bench-helper.js` — fix `estimateRowCount`, `findSymbolWithCallers` for `_meta`-wrapped responses

Currently the benchmark uses hardcoded savings percentages from the design doc (`.savingsEstimates`). This task replaces that with real measurements using the actual `compactResponse` + `autoFormat` functions.

- [ ] **Step 1: Update `bench-tokens.js` Step 3 to measure actual compact output**

Replace the "Measure sizes in three modes" section with code that calls `compactResponse` and measures real byte counts:

```javascript
// Measure raw vs compact
const rawBytes = JSON.stringify(toolData).length;
const rawTokens = wf.estimateTokens(toolData);

// Actual compact encoding (unwrap _meta, compact payload, rewrap)
const payload = toolData.data || toolData;
const compacted = wf.compactResponse(payload);
const compactBytes = JSON.stringify(compacted).length;
const compactTokens = wf.estimateTokens(compacted);
const actualSavings = rawBytes > 0 ? (1 - compactBytes / rawBytes) : 0;

results.push({
  tool: tool.name,
  rawBytes,
  rawTokens,
  compactBytes,
  compactTokens,
  savingsPct: Math.round(actualSavings * 100),
  rows: estimateRowCount(toolData, tool.toolName),
});
```

Update the results table to show compact bytes and actual savings:

```javascript
console.log(pad('Tool', 18) + pad('Rows', 8) + pad('Raw (B)', 12) + pad('Compact (B)', 14) + pad('Savings', 10));
console.log('─'.repeat(62));
// ... print rows with compactBytes and savingsPct columns
```

Remove the "Estimated Savings" section entirely (it was based on hardcoded guesses).

- [ ] **Step 2: Update `bench-helper.js` BENCHMARK_TOOLS**

Add `import-graph` to the benchmark matrix:

```javascript
const BENCHMARK_TOOLS = [
  { name: 'importance', cli: 'importance', toolName: 'getSymbolImportance' },
  { name: 'hotspots', cli: 'hotspots', toolName: 'getHotspots' },
  { name: 'dead-code', cli: 'dead-code', toolName: 'getDeadCode' },
  { name: 'coupling', cli: 'coupling', toolName: 'getCouplingMetrics' },
  { name: 'extraction', cli: 'extractable', toolName: 'getExtractionCandidates' },
  { name: 'call-hierarchy', cli: 'call-hierarchy', toolName: 'getCallHierarchy' },
  { name: 'import-graph', cli: 'import-graph', toolName: 'getImportGraph' },
  { name: 'cycles', cli: 'cycles', toolName: 'getDependencyCycles' },
  { name: 'blast-radius', cli: 'blast-radius', toolName: 'getBlastRadius' },
];
```

- [ ] **Step 3: Fix `estimateRowCount` in `bench-tokens.js`**

The helper already has the `unwrap()` function from the earlier fix. Ensure the key paths match all tools:

```javascript
function estimateRowCount(data, toolName) {
  const d = unwrap(data);
  switch (toolName) {
    case 'getSymbolImportance': return (d.nodes || []).length;
    case 'getHotspots': return (d.hotspots || d.files || []).length;
    case 'getDeadCode': return (d.dead_symbols || d.dead_files || []).length;
    case 'getCouplingMetrics': return (d.metrics || d.files || []).length;
    case 'getExtractionCandidates': return (d.candidates || []).length;
    case 'getCallHierarchy': return (d.edges || []).length;
    case 'getImportGraph': return (d.edges || []).length;
    case 'getBlastRadius': return (d.edges || []).length;
    case 'getDependencyCycles': return (d.cycles || []).length;
    default: return 0;
  }
}
```

Note: for dead-code, return the sum of `dead_symbols.length + dead_files.length` since both are lists now.

- [ ] **Step 4: Add `require('./wire-format.js')` to bench-tokens.js**

At the top of `bench-tokens.js`, add:

```javascript
const wf = require('../wire-format');
```

And remove the now-unused `savingsEstimates` object and the entire "Estimated Savings" section.

- [ ] **Step 5: Run benchmark**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && node bench/bench-tokens.js > /tmp/bench-v2-final.txt 2>&1 && cat /tmp/bench-v2-final.txt`
Expected: Table shows actual raw bytes, actual compact bytes, and actual percentage savings per tool.

- [ ] **Step 6: Run full test suite**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add bench/bench-tokens.js bench/bench-helper.js
git commit -m "fix(bench): measure actual compact savings instead of hardcoded estimates"
```

---

### Task 5: Wire stripFields into `_wrapAnalysis` for production use

**Files:**
- Modify: `memory-store.js:1873-1918` (`_wrapAnalysis`)
- Test: `test/wire-format.test.js` (integration-level, or manual verification)

This task connects the `stripFields` option from Task 2 to the actual production code path so that `symbol_id` and `id` are automatically stripped when encoding responses for Pi.

- [ ] **Step 1: Define which fields to strip per tool**

In `memory-store.js`, near `_wrapAnalysis` (line ~1873), add a constant:

```javascript
// Internal DB fields that are meaningless to the LLM consumer
const _STRIP_FIELDS = ['symbol_id', 'id'];
```

- [ ] **Step 2: Pass stripFields through compactResponse call**

In `_wrapAnalysis`, change the `compactResponse` calls (lines ~1910 and ~1914) to:

```javascript
wrapped.data = wireFormat.compactResponse(wrapped.data, { stripFields: _STRIP_FIELDS });
```

Both the `format === 'compact'` and `format === 'auto'` branches need this.

- [ ] **Step 3: Run full test suite**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: ALL pass.

- [ ] **Step 4: Run benchmark with production encoding**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && node memory-store.js dead-code --repo PiMemoryExtension --format compact 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('compact bytes:', JSON.stringify(d).length); const p=d.data; console.log('has symbol_id in header:', p.dead_symbols?._header?.includes('symbol_id'));"`
Expected: `has symbol_id in header: false` (stripped).

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add memory-store.js
git commit -m "feat: strip internal DB IDs from compact-encoded analysis responses"
```

---

### Task 6: Final benchmark + deployment

**Files:**
- Verify: `bench/bench-tokens.js`
- Deploy: `~/.pi/agent/skills/memory-layer/`

- [ ] **Step 1: Run final benchmark**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && node bench/bench-tokens.js > /tmp/bench-v2-final.txt 2>&1 && cat /tmp/bench-v2-final.txt`
Expected: Overall savings ≥45%. Record actual numbers.

- [ ] **Step 2: Run full test suite**

Run: `cd ~/Documents/GulanesKorp/PiMemoryExtension && npx vitest run`
Expected: ALL pass (210+ tests).

- [ ] **Step 3: Deploy to production skill directory**

```bash
rsync -av --delete \
  --exclude='test/' --exclude='bench/' --exclude='docs/' --exclude='scripts/' \
  --exclude='vitest.config.mjs' --exclude='.git' --exclude='.worktrees' --exclude='.venv' \
  --exclude='*.html' --exclude='*.png' --exclude='*.svg' --exclude='.github/' \
  --exclude='plans/' --exclude='specs/' --exclude='node_modules/' \
  ~/Documents/GulanesKorp/PiMemoryExtension/ \
  ~/.pi/agent/skills/memory-layer/
```

- [ ] **Step 4: Verify deployed files match repo**

```bash
diff <(cd ~/.pi/agent/skills/memory-layer && md5sum *.js | sort) \
  <(cd ~/Documents/GulanesKorp/PiMemoryExtension && md5sum *.js | sort)
```
Expected: No differences.

- [ ] **Step 5: Commit all remaining changes**

```bash
cd ~/Documents/GulanesKorp/PiMemoryExtension
git add -A
git commit -m "chore: wire-format v2 token optimization — all tasks complete"
git push
```

- [ ] **Step 6: Save memory**

Record the final benchmark results in persistent memory for future reference.

---

## Expected Outcome

After all tasks:

| Tool | Current Savings | Expected Savings |
|---|---|---|
| importance | 24% | ~35% (+ strip `id`) |
| hotspots | 45% | ~50% (+ hoist `unique_authors`) |
| dead-code | 28% | ~45% (+ encode `dead_files`, strip `symbol_id`, hoist `signals`) |
| coupling | 33% | ~40% (+ strip `id`) |
| extraction | 30% | ~40% (+ strip `id`) |
| cycles | 0% | ~0% (too small) |
| import-graph | 19% | ~25% |
| **OVERALL** | **29%** | **~42-48%** |

The biggest single win is Task 3 (hoisting) on `dead-code` where `signals` (16% of bytes) is repeated identically in all 46 rows.
