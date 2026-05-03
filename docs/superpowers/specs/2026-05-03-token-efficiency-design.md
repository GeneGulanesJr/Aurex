# Token Efficiency & Feature Parity Design

**Date:** 2026-05-03
**Status:** Approved
**Driver:** Token efficiency for Pi's context window

---

## Overview

Close the feature gap between PiMemoryExtension and JCodeMunch, prioritized by token impact. Three phases: response slimming (biggest token win), smarter queries (fewer round-trips), and analysis depth (feature parity).

**Note:** Symbol Importance (PageRank) already exists (`getSymbolImportance` in `code-analysis.js`) — not included in scope.

---

## Phase 1: Response Slimming

### 1A. Response Metadata Envelope (`_meta`)

**Universal shape:** `{ _meta, data }` — no flat mixing.

```js
{
  _meta: {
    schema_version: 1,
    confidence: 0.87,        // tool-specific, non-comparable across tools
    freshness: 'fresh',      // 'fresh' | 'edited_uncommitted' | 'stale_index'
    generated_at: '2026-05-03T15:30:00Z',
    repo_rev: 'abc1234',     // current HEAD at query time
    timing_ms: 12,
    result_count: 23
  },
  data: { ... }              // existing payload, unchanged shape
}
```

**Confidence semantics:** "Tool-specific confidence in the reliability/completeness of this result set." Non-comparable across tools — `0.8` from dead-code and `0.8` from blast-radius mean different things.

**Calibration per tool:**

| Tool | Formula | Signal type |
|---|---|---|
| `getCouplingMetrics` | 1.0 | Deterministic |
| `getComplexity` | 1.0 | Deterministic |
| `getLayerViolations` | 1.0 | Deterministic |
| `getFileOutline` | 1.0 | Deterministic |
| `getDependencyCycles` | 1.0 | Deterministic — "graph successfully analyzed". `data.has_cycles` boolean separately |
| `getSymbolImportance` | Top-1 vs top-2 PageRank gap | Coverage |
| `getDeadCode` | Average confidence of returned symbols | Already per-symbol |
| `getHotspots` | Ratio of symbols with churn data vs total | Coverage |
| `getBlastRadius` | Ratio of resolved vs unresolved callers | Resolution |
| `getCallHierarchy` | Average `code_calls.confidence` across chain | Resolution |
| `getExtractionCandidates` | Extraction_score normalized 0-1 | Score |
| `getSignalChains` | Ratio of resolved vs unresolved callees | Coverage |
| `winnow` | Ratio of requested axes that had data (e.g., 3 of 4 → 0.75) | Coverage |
| `astPatterns` | Ratio of symbols with body data available vs total scanned | Coverage |
| `getProvenance` | Ratio of commits successfully classified vs total touching the lines | Classification |
| `getUntestedSymbols` | Ratio of test files found vs total files (0.0 if no test files exist) | Coverage |
| `getPrRiskProfile` | Ratio of signals that had data (0.8 if 4 of 5 signals available) | Coverage |

**Freshness from git state first, filesystem second:**
- `fresh`: `git status --porcelain` empty + stored `head_commit` matches current `git rev-parse HEAD`
- `edited_uncommitted`: `git status --porcelain` has tracked changes for relevant files
- `stale_index`: stored `head_commit` differs from current HEAD (reindex needed)

**Schema change:** The `code_repos` table currently has no commit hash column. Add `head_commit TEXT` to `code_repos` via migration in `db.js`. At index time, capture `git rev-parse HEAD` and store it. The PageRank cache in Section 2A also uses this — cache key includes `head_commit` so it auto-invalidates only on real code changes, not on redundant reindexes. This is the **only schema change** in the entire spec.

**Non-git repos:** For repos without a `.git` directory, `head_commit` is stored as NULL. Freshness falls back to filesystem metadata: `fresh` if all indexed file mtimes match their values at index time, `stale_index` if any mtime has changed. The `edited_uncommitted` state is not possible for non-git repos (no version control to diff against).

**Freshness caching:** Git status is a subprocess spawn. To avoid spawning git on every analysis query, `response-meta.js` caches freshness per repo in a module-level map keyed by `repoId`. Cache TTL is 60 seconds. Subsequent calls within the same minute reuse the cached result. Cache invalidates automatically on TTL expiry.

**Implementation:** New `response-meta.js` module — pure functions for confidence/freshness computation, with an internal freshness cache (module-level `Map`, 60s TTL). Fully testable independently.

### 1B. Compact Wire Format (MUNCH encoding)

Every CLI subcommand gains an optional `--format` parameter:

```
--format json     → current verbose JSON (default, backward-compat)
--format compact  → CSV-packed homogeneous lists with single-char tags
--format auto     → use compact when savings ≥ 20%, otherwise json
```

**Compact encoding rules:**

1. **Homogeneous list of objects → tagged CSV**
   - `_header` defines column order once
   - Pipe-delimited rows. Escape sequence: `\` → `\\` first, then `|` → `\p`. During decode: `\p` → `|` first, then `\\` → `\`. This ensures round-trip is always lossless, even for values containing literal backslashes or `\p`.
   - Null/undefined → empty string between pipes
   - Always lossless — decode restores original objects exactly

2. **Path prefix interning**
   - When ≥3 rows share the same path prefix, extract to `_prefixes` map
   - `@0` resolves to the prefix at index `"0"`

3. **What stays as JSON**
   - `_meta` envelope — always verbose JSON (small, needs to be readable)
   - Non-homogeneous results (objects with different shapes)
   - Single-result responses (no list to compress)
   - Error responses

**Implementation:** New `wire-format.js` module with two functions:
- `compactResponse(data, opts)` → packed shape
- `expandResponse(compact)` → original object shape (for testing round-trip)

Neither touches `code-analysis.js` — the analysis layer always returns native objects. Wrapping happens at the output boundary in `memory-store.js`.

**jsonOut format awareness:** The existing `jsonOut` in `db.js` calls `JSON.stringify(obj, null, 2)` (pretty-printed). When format is `compact`, the wrapping layer in `memory-store.js` produces the compact shape and calls `jsonOut` with single-line JSON (`JSON.stringify(obj)` without `null, 2`). When format is `json` (default), current behavior is unchanged. The compact savings come from both the CSV encoding and the elimination of pretty-printing whitespace.

**Dispatch helper in `memory-store.js`:** The existing dispatch table has 30+ entries, each repeating the same repo lookup + error pattern (parse args → lookup repo → call analysis → return). Before adding new subcommands, extract a `_dispatch(repoName, fn)` helper that handles the repo lookup and error case. New subcommands become ~5 lines each. This keeps `memory-store.js` manageable as it grows past 2196 lines.

**Expected savings:**

| Tool | Typical rows | Est. savings |
|---|---|---|
| `getSymbolImportance` | 20 | ~55% |
| `getHotspots` | 20 | ~50% |
| `getDeadCode` | 30-100 | ~60% |
| `getCouplingMetrics` | 50+ | ~55% |
| `getExtractionCandidates` | 20 | ~45% |
| `getCallHierarchy` | 10-30 | ~40% |
| `getBlastRadius` | 5-15 | ~25% |
| `getDependencyCycles` | 5-10 | ~20% |
| Single-result tools | 1 | ~0% |

### 1C. Token Efficiency Benchmark

A reproducible benchmark script (`bench/bench-tokens.js`) that:

1. Checks for an existing index of the PiMemoryExtension repo (skips re-indexing unless `--reindex` is passed)
2. Runs each analysis tool in three modes: raw, with `_meta`, with `_meta` + compact
3. Measures byte count and estimated token count (`bytes / 3.5` heuristic)
4. Outputs a comparison table

**Files:** `bench/bench-tokens.js`, `bench/bench-helper.js`

**Benchmark matrix:** importance, hotspots, dead-code, coupling, extraction, call-hierarchy, cycles, blast-radius

**Integration:** Runs via `node bench/bench-tokens.js`. Informational only in Phase 1 (no CI gate). Pass `--reindex` to force a fresh index.

---

## Phase 2: Smarter Queries

### 2A. Winnow — Multi-Axis Query

Single command that composes all filter axes into one AND-intersected query:

```
winnow --repo NAME \
  [--kind function|method|class|...] \
  [--min-complexity N] \
  [--min-churn N] \
  [--min-pagerank N] \
  [--min-callers N] \
  [--file-glob GLOB] \
  [--name-regex PATTERN] \
  [--sort-by pagerank|complexity|churn|callers] \
  [--top N]
```

Single SQL query JOINing across `code_symbols`, `symbol_complexity`, `churn_metrics`, `code_calls`, plus PageRank joined from a cached computation.

**PageRank caching:** The existing `getSymbolImportance` computes a full 10-iteration PageRank on every call. Winnow needs the same data. Rather than computing it fresh, extract `buildPageRank(db, repoId)` as a standalone function with a module-level cache keyed by `repoId`. Cache key includes `code_repos.head_commit` — it auto-invalidates only on real code changes, not on redundant reindexes. Both `getSymbolImportance` and `winnow` share this cache. For repos under 5000 symbols, the computation adds <50ms on first call and 0ms on subsequent calls.

**Operator support per axis:**

| Axis | Operator | Example |
|---|---|---|
| `--kind` | eq | `--kind function` |
| `--min-complexity` | gte | `--min-complexity 10` |
| `--min-churn` | gte | `--min-churn 5` |
| `--min-pagerank` | gte | `--min-pagerank 0.005` |
| `--min-callers` | gte | `--min-callers 3` |
| `--file-glob` | SQL GLOB | `--file-glob "src/**/*.js"` |
| `--name-regex` | JS REGEXP | `--name-regex "^build.*"` |
| `--sort-by` | DESC | `--sort-by complexity` |

**Implementation:** New `winnow(db, repoId, opts)` function in `code-analysis.js`. CLI subcommand in `memory-store.js`. No schema changes — reuses all existing tables.

**File size note:** `code-analysis.js` is currently 1406 lines. Adding winnow (~80 lines) plus Phase 3 additions (~300 lines) pushes it to ~1800. If it exceeds 2000 lines after Phase 3, extract analytics functions (winnow, untested, pr-risk, hotspots, importance, coupling) into a new `analytics.js` module. The threshold is a guideline, not a hard rule — extract when readability degrades.

**Response:** Uses Phase 1 envelope + compact format. Confidence reflects how many axes had data.

### 2B. Tool Tiering

Three tiers controlling which commands appear in session-start context:

| Tier | Commands | Use case |
|---|---|---|
| `core` | search, save, context, search-code, get-code-source, importance, outline, winnow | Quick lookups |
| `standard` | core + complexity, dead-code, hotspots, blast-radius, call-hierarchy, cycles, coupling, churn, signal-chains | Deep analysis |
| `full` | all commands | Admin / full exploration |

**Config:** `~/.pi/memory/tier.jsonc`:

```jsonc
{
  "tier": "standard",
  "extra_commands": [],
  "hidden_commands": []
}
```

**Mechanism:** `session-start` reads config, returns `tool_tier` + `available_commands` in response. Agent prompt instructs preference for listed commands. Default is `full` (no change from current behavior).

**Token impact:** `standard` saves ~285 tokens vs `full` per session.

**Implementation:** Tier definitions as constants in `memory-store.js`. Config reading in `session-start` function.

---

## Phase 3: Analysis Depth

### 3A. AST Pattern Matching

New `ast-patterns` command scanning all indexed symbol bodies against preset anti-pattern detectors.

**10 preset detectors:**

| Category | Detector | Pattern |
|---|---|---|
| Error handling | `empty_catch` | `catch {}` or `catch (e) {}` with empty body |
| Quality | `empty_function` | Functions with empty bodies (`function foo() {}`, `() => {}`) — forgotten implementations or stubs |
| Complexity | `deeply_nested` | Nesting depth ≥ 5 |
| Performance | `nested_loops` | ≥ 3 nested loops |
| Complexity | `god_function` | Body ≥ 100 lines |
| Security | `eval_exec` | `eval()`, `Function()`, `new Function()` |
| Security | `hardcoded_secret` | String literals matching password/api_key/secret patterns |
| Maintenance | `todo_fixme` | Comments with TODO/FIXME/HACK |
| Maintenance | `magic_number` | Unexplained numeric literals (not 0, 1, -1, 2) |
| Quality | `reassigned_param` | Parameters reassigned within body |

**Custom DSL:**

```
--pattern "call:eval"           → calls matching "eval"
--pattern "string:/password/i"  → string literals matching regex
--pattern "nesting:5+"          → nesting depth ≥ 5
--pattern "lines:80+"           → body ≥ 80 lines
```

Parse as `type:value` where type is one of `call`, `string`, `nesting`, `lines`, splitting on the first colon only. This handles values containing colons (e.g., `string:/api/v1/users` → type=`string`, value=`/api/v1/users`).

**Implementation:** Hybrid approach — symbol body retrieval from indexed bytes + regex detection. Complexity-cross-ref for nesting/lines detectors. New `ast-patterns.js` module.

**CLI:** `ast-patterns --repo NAME [--category CATEGORY] [--pattern CUSTOM]`

Valid categories: `error_handling`, `quality`, `complexity`, `performance`, `security`, `maintenance`, `all` (default).

**Confidence:** Ratio of symbols with body data available vs total scanned.

**Detector scope clarification:** `empty_function` operates at the symbol level — it checks `symbol_complexity.lines_of_code === 0` or whether the full symbol body is whitespace-only. `empty_catch` operates within function bodies as a regex pattern (`catch\s*\([^)]*\)\s*\{\s*\}`). They work at different levels: one is a symbol-level check from pre-computed complexity data, the other is a pattern scan inside the body text.

### 3B. Symbol Provenance (Git Archaeology)

New `provenance` command tracing a symbol's full git history:

```
provenance --repo NAME --symbol SYMBOL
```

**Pipeline:**
1. Resolve symbol → `file_path`, `start_line`, `end_line`
2. `git log --follow --format="%H|%an|%aI|%s" -- FILEPATH`
3. `git blame -L START,END -- FILEPATH` to filter relevant commits
4. Classify commits: creation, bugfix, refactor, feature, perf, rename, revert
5. Generate narrative summary

**Implementation:** Extends `git-analysis.js` with `getProvenance(db, repoId, symbolName)`.

**Confidence:** Ratio of commits successfully classified vs total touching the lines.

### 3C. Untested Symbol Detection

New `untested` command finding symbols with no test-file reachability:

```
untested --repo NAME [--min-confidence 0.5] [--include-private true]
```

**Algorithm:**
1. Identify test files (`*.test.js`, `*.spec.js`, `test/**`, `__tests__/**`)
2. Trace import graph from test files → production files
3. Trace call graph from test functions → production symbols (direct + transitive)
4. Subtract: all symbols - tested symbols = untested

**Per-symbol confidence:**
- `1.0` — File has zero test imports, no test calls any function in it
- `0.7` — File imported by tests, but no test calls this specific symbol
- `0.4` — Called indirectly (test → helper → symbol) but not directly

**Default exclusions:** Test files, entry points, barrel files, private symbols (leading `_`) unless `--include-private`. Entry point identification reuses the same logic as `getDeadCode` in `code-analysis.js`: filename patterns (`main.js`, `index.js`, `cli.js`, `app.js`, `server.js`), shebang files, `package.json` main/bin entries, and barrel re-exports.

**Implementation:** New `getUntestedSymbols(db, repoId, opts)` in `code-analysis.js`. No schema changes.

**Confidence:** Ratio of test files found vs total files (0.0 if no test files exist).

### 3D. PR Risk Profiling

New `pr-risk` command fusing multiple signals into a composite risk score:

```
pr-risk --repo NAME [--branch BRANCH] [--base main]
```

**Signals and weights:**

| Signal | Source | Weight |
|---|---|---|
| Blast radius | Caller count via `getBlastRadius` | 30% |
| Complexity | `symbol_complexity.cyclomatic` | 20% |
| Churn | `churn_metrics.commits` | 20% |
| Test coverage | From untested detection (3C) | 20% |
| Change volume | Lines in diff | 10% |

**Composite:** Weighted sum, normalized 0.0–1.0.

**Risk levels:** low (0.0–0.3), medium (0.3–0.6), high (0.6–0.8), critical (0.8–1.0).

**Implementation:** New `getPrRiskProfile(db, repoId, opts)` in `code-analysis.js`. Depends on 3C — falls back to skipping test-coverage signal if unavailable.

**Performance:** For branches with >20 changed symbols, batch the blast radius computation: create a temporary table `temp_changed_ids` populated with all changed symbol IDs, then run a single recursive CTE with `WHERE cc.callee_symbol_id IN (SELECT id FROM temp_changed_ids)`. Drop the temp table after the query. This produces one result set of all affected callers keyed by originating symbol, avoiding O(n) recursive queries on large PRs.

**Implementation order:** Phase 3 must be implemented in order: 3A, 3B, 3C, then 3D. The 3D test suite must include a test case where untested data is unavailable (fallback path where test-coverage weight is redistributed to other signals).

**Confidence:** Based on how many signals had data. Missing churn/untested data drops confidence proportionally.

---

## File Summary

### New files

| File | Phase | Responsibility |
|---|---|---|
| `response-meta.js` | 1 | `_meta` envelope construction, confidence calibration, freshness checks |
| `wire-format.js` | 1 | Compact encoding/decoding (MUNCH) |
| `bench/bench-tokens.js` | 1 | Token efficiency benchmark harness |
| `bench/bench-helper.js` | 1 | Shared benchmark utilities |
| `ast-patterns.js` | 3 | Anti-pattern detection |
| `test/response-meta.test.js` | 1 | Tests for _meta envelope |
| `test/wire-format.test.js` | 1 | Tests for compact encoding round-trip |
| `test/ast-patterns.test.js` | 3 | Tests for pattern detection |
| `test/git-analysis.test.js` | 3 | Tests for provenance |

### Modified files

| File | Phase | Changes |
|---|---|---|
| `memory-store.js` | 1, 2, 3 | Add `--format` handling, `_meta` wrapping, new CLI subcommands (winnow, ast-patterns, provenance, untested, pr-risk), tier config in session-start |
| `code-analysis.js` | 2, 3 | Add `winnow`, `getUntestedSymbols`, `getPrRiskProfile` functions |
| `git-analysis.js` | 3 | Add `getProvenance` function |
| `db.js` | 1 | v6 migration: add `head_commit TEXT` to `code_repos` in `runMigrations()`. Update `_CRITICAL_TABLES` array. Also add at index time: capture `git rev-parse HEAD` and store it |
| `~/.pi/agent/skills/memory-layer/SKILL.md` | 1, 2, 3 | Document new commands, compact format, tier system. **Must update all response shape examples** to reflect `{ _meta, data }` envelope — every analysis command's response example changes from `{ edges: [...] }` to `{ _meta: {...}, data: { edges: [...] } }` |
| `schema.sql` | 1 | Add `head_commit TEXT` column to `code_repos` CREATE TABLE (for fresh install parity with migration) |
| `test/code-analysis.test.js` | 2, 3 | Tests for winnow, untested, pr-risk |
| `test/db.test.js` | 2 | Tests for tier config reading in session-start |

### Schema change (one)

Add `head_commit TEXT` column to `code_repos` table. Migration handled in `db.js` `runMigrations()`. At index time, `git rev-parse HEAD` is captured and stored. Used by freshness checks (Section 1A) and PageRank cache invalidation (Section 2A). All other features reuse existing tables with no changes.
