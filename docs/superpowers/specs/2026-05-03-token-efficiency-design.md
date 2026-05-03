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

**Freshness from git state first, filesystem second:**
- `fresh`: `git status --porcelain` empty + index build commit matches `git rev-parse HEAD`
- `edited_uncommitted`: `git status --porcelain` has tracked changes for relevant files
- `stale_index`: index `updated_at` older than 7 days

**Implementation:** New `response-meta.js` module — pure functions, no side effects, fully testable independently.

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
   - Pipe-delimited rows, pipe in values escaped as `\p`
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

1. Indexes the PiMemoryExtension repo itself as a test codebase
2. Runs each analysis tool in three modes: raw, with `_meta`, with `_meta` + compact
3. Measures byte count and estimated token count (`bytes / 3.5` heuristic)
4. Outputs a comparison table

**Files:** `bench/bench-tokens.js`, `bench/bench-helper.js`

**Benchmark matrix:** importance, hotspots, dead-code, coupling, extraction, call-hierarchy, cycles, blast-radius

**Integration:** Runs via `node bench/bench-tokens.js`. Informational only in Phase 1 (no CI gate).

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

Single SQL query JOINing across `code_symbols`, `symbol_complexity`, `churn_metrics`, `code_calls`, plus in-memory PageRank joined via temp map.

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
| Error handling | `bare_except` | `catch` with no error type filter |
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

**Implementation:** Hybrid approach — symbol body retrieval from indexed bytes + regex detection. Complexity-cross-ref for nesting/lines detectors. New `ast-patterns.js` module.

**CLI:** `ast-patterns --repo NAME [--category CATEGORY] [--pattern CUSTOM]`

**Confidence:** Ratio of symbols with body data available vs total scanned.

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

**Default exclusions:** Test files, entry points, barrel files, private symbols (leading `_`) unless `--include-private`.

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

### Modified files

| File | Phase | Changes |
|---|---|---|
| `memory-store.js` | 1, 2, 3 | Add `--format` handling, `_meta` wrapping, new CLI subcommands (winnow, ast-patterns, provenance, untested, pr-risk), tier config in session-start |
| `code-analysis.js` | 2, 3 | Add `winnow`, `getUntestedSymbols`, `getPrRiskProfile` functions |
| `git-analysis.js` | 3 | Add `getProvenance` function |
| `db.js` | 1 | Minor: expose helper for git state queries (if needed) |
| `~/.pi/agent/skills/memory-layer/SKILL.md` | 1, 2, 3 | Document new commands, compact format, tier system |
| `test/code-analysis.test.js` | 2, 3 | Tests for winnow, untested, pr-risk |
| `test/response-meta.test.js` | 1 | Tests for _meta envelope |
| `test/wire-format.test.js` | 1 | Tests for compact encoding round-trip |
| `test/ast-patterns.test.js` | 3 | Tests for pattern detection |
| `test/git-analysis.test.js` | 3 | Tests for provenance |

### No schema changes

All features reuse existing tables. No migrations required.
