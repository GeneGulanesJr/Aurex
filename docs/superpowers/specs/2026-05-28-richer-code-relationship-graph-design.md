# Richer Code Relationship Graph

**Date:** 2026-05-28
**Status:** Proposed
**Deciders:** Gene Gulanes Jr.

## Problem

When code changes, the AI misses affected files because the relationship graph is too shallow. Today the indexer only tracks two edge types — file imports (`code_imports`) and function calls (`code_calls`) — and the blast radius query walks each one independently without combining signals. This means:

1. **Re-export chains are invisible** — `legacy-core.js` re-exports `getBlastRadius` from `import-graph-impl.js`, but the blast radius stops at `legacy-core.js` because there's no edge connecting it to `impact.js`.
2. **Inheritance is invisible** — When a base class changes, subclasses that extend or implement it aren't flagged.
3. **Non-call references are invisible** — Using a type, constant, or config from another file doesn't create any edge.
4. **Historical co-change is invisible** — Files that frequently change together in git commits share no edge.

The blast radius is like a map with only highways — it sees major roads but misses neighborhoods.

## Approach

Add **4 new relationship signals** and a **unified weighted propagation engine** that combines all edges into a single traversal.

**Consistent with ADR: crosshash-strategy.md** — The JS path remains canonical for single-repo analysis. This work stays entirely in the JS codebase. No crosshash dependencies.

## Schema changes

### `code_relations` table

Symbol-to-symbol and file-to-file semantic edges beyond imports and calls.

```sql
CREATE TABLE IF NOT EXISTS code_relations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id             INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  source_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
  target_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
  source_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
  target_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,  -- 'extends'|'implements'|'reexport'|'references'
  weight              REAL NOT NULL DEFAULT 1.0,
  line_number         INTEGER,
  UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                   COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
);
CREATE INDEX idx_cr_source_sym ON code_relations(source_symbol_id);
CREATE INDEX idx_cr_target_sym ON code_relations(target_symbol_id);
CREATE INDEX idx_cr_source_file ON code_relations(source_file_id);
CREATE INDEX idx_cr_target_file ON code_relations(target_file_id);
CREATE INDEX idx_cr_repo_kind ON code_relations(repo_id, kind);
```

**Design notes:**
- Nullable symbol IDs + file IDs support both symbol-level edges (extends, implements, references) and file-level edges (reexport for `export * from`).
- The UNIQUE constraint uses `COALESCE` to handle nullable columns — a reexport edge with no symbol IDs but valid file IDs is distinct from an extends edge with symbol IDs.
- `weight` allows future confidence scoring per edge.

### `file_cochange` table

Git co-change frequency — statistical signal of behavioral coupling.

```sql
CREATE TABLE IF NOT EXISTS file_cochange (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  file_a_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  file_b_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  co_commit_count INTEGER NOT NULL DEFAULT 0,
  strength        REAL NOT NULL DEFAULT 0,  -- normalized 0-1
  window_days     INTEGER NOT NULL DEFAULT 90,
  UNIQUE(repo_id, file_a_id, file_b_id)
);
CREATE INDEX idx_fcc_a ON file_cochange(file_a_id);
CREATE INDEX idx_fcc_b ON file_cochange(file_b_id);
CREATE INDEX idx_fcc_repo ON file_cochange(repo_id);
```

**Design notes:**
- Both directions stored (A→B and B→A) for simpler queries — no UNION needed.
- `strength` = `co_commit_count / max_co_commit_count_in_repo`, normalized 0–1.
- `window_days` is configurable — 90 days default.

### Migration

Added as `runMigrationV13` in `db.js`. Uses `CREATE TABLE IF NOT EXISTS` (idempotent). Sets `PRAGMA user_version = 13`.

## Edge extraction

Four new extraction functions in `src/code-analysis/`. Each called during `rebuildDerivedIndexes()` and `rebuildDerivedIncremental()` in `src/code-index/incremental-indexer.js`, alongside existing import/call graph builders.

### `buildExtendsEdges(db, repoId)`

**Source:** `code_symbols` rows where `kind = 'class'`, using the `signature` column.

**Language-aware regex:**
- JS/TS: `/extends\s+(\w+)/` on signature
- Python: `/class\s+\w+\(([^)]+)\)/` — first argument is base class
- Rust, Go: skipped (Rust impl blocks already captured as symbol names; Go has no extractable heritage from signatures alone)

**Resolution:** Match the extracted name against `code_symbols` in the same repo by `name` and `kind` (class/interface). Creates a `code_relations` row with `kind = 'extends'`, symbol-level IDs.

**Weight:** 1.0 (static, high-confidence).

### `buildImplementsEdges(db, repoId)`

**Source:** `code_symbols` rows where `kind = 'class'` and language is JS/TS, using the `signature` column.

**Regex:** `/implements\s+([\w,\s]+?)(?:\s*\{|$)/` on signature — captures comma-separated interface names.

**Resolution:** For each interface name, match against `code_symbols` where `kind = 'interface'`. Creates one `code_relations` row per interface with `kind = 'implements'`.

**Weight:** 1.0 (static, high-confidence).

**Note:** The existing `_getExtendsClass()` in `parse-code.js` only grabs the first `type_identifier` from the heritage clause, dropping `implements` names. This extraction works from the stored signature, not re-parsing, so it's independent of that limitation.

### `buildReexportEdges(db, repoId)`

**Source:** `code_imports` rows where `import_type = 're-export'`.

**Logic:**
1. Collect all re-export rows from `code_imports`.
2. For each re-export where `target_file_id` is resolved, create a `code_relations` row with `kind = 'reexport'`, file-level IDs.
3. **Transitive walk** (max depth 3): If file A re-exports from file B, and file B re-exports from file C, create an edge from A to C with `weight = 0.7^depth`.
4. For named re-exports (`export { foo } from './bar'`), also create symbol-level edges when the re-exported name resolves to a symbol in the target file.

**Weight:** `1.0` for direct, `0.7^hop` for transitive.

### `buildReferenceEdges(db, repoId)`

**Source:** `scope_resolution` table joined with `code_symbols`.

**Logic:**
1. For each resolved binding in `scope_resolution` where `status = 'resolved'`:
   - Look up the resolved symbol via `resolved_symbol_id`.
   - If the resolved symbol's `kind` is **not** `function` or `method` (those are already in `code_calls`), create a `code_relations` row with `kind = 'references'`.
2. This captures: type usage, constant access, class instantiation, interface implementation checks (`instanceof`), enum member access.

**Weight:** 0.8 (resolved scope bindings are high-confidence).

**Excludes calls:** Function/method calls are already tracked in `code_calls` — we don't duplicate them.

### `buildCochangeEdges(db, repoId)`

**Source:** `git log --name-only --format="COMMIT:%H"` over the last 90 days.

**Logic:**
1. Parse git log, group files by commit.
2. For each commit with 2+ files, increment `co_commit_count` for every file pair.
3. Normalize: `strength = co_commit_count / max(co_commit_count)`.
4. Store both directions (A→B and B→A).

**When run:** Full reindex only (not incremental). Cached in `file_cochange` table. Can be refreshed via a separate command.

**Skipped if:** Repo is not a git repository, or git is unavailable.

### Integration into indexing pipeline

In `src/code-index/incremental-indexer.js`, both `rebuildDerivedIndexes()` (full) and `rebuildDerivedIncremental()` (incremental) get new steps:

```
Step 5/5 (existing): build import graph → resolve scopes → build call graph → compute complexity
Step 6/5 (new):      build extends edges → build implements edges → build reexport edges → build reference edges
Step 7/5 (new):      build cochange edges (full reindex only)
```

For incremental: relation edges are rebuilt for changed files + their direct importers (same scope as the existing incremental call graph). Cochange is skipped.

New files:
- `src/code-analysis/relation-builder.js` — exports `buildExtendsEdges`, `buildImplementsEdges`, `buildReexportEdges`, `buildReferenceEdges`
- `src/code-analysis/cochange-builder.js` — exports `buildCochangeEdges`

Both follow the existing pattern in `src/code-analysis/` — pure functions that take `(db, repoId, opts)` and return `{ success, count }`.

## Propagation engine

New file: `src/code-analysis/propagation-impl.js`

### `getAffectedGraph(db, repoId, opts)`

Replaces the current `getBlastRadius` for the `blast-radius` mode. Falls back to old behavior if `code_relations` table doesn't exist.

**Inputs:**
- `symbol` (optional) — changed symbol name
- `file` (optional) — changed file path
- `minReachability` (default: 0.1) — stop expanding when score drops below this
- `maxDepth` (default: 5) — hard cap on hop count

**Algorithm:**

```
1. Seed: collect starting nodes from the changed symbol + its file
2. BFS queue, each entry: { nodeId, fileId, reachability, depth, viaEdges }
3. For each node popped from queue:
   a. Query ALL incoming edges across 4 tables:
      - code_calls:      caller_symbol_id → this node  (decay 0.7)
      - code_imports:    source_file_id → this file    (decay 0.5)
      - code_relations:  target → this node/file       (decay varies by kind)
      - file_cochange:   other_file → this file        (decay 0.3)
   b. For each edge:
      score = edge.weight × decay_per_edge_type × (0.85 ^ depth)
      if score >= minReachability AND node not already visited with higher score:
        add to queue, record trace
4. Collect all visited nodes with their reachability scores
5. Group into affected_files (with max reachability per file) and affected_symbols
```

**Edge type decay table:**

| Edge type | Decay | Rationale |
|---|---|---|
| `code_calls` | 0.7 | Direct call — strong signal |
| `code_imports` | 0.5 | Import alone — might be one tiny thing |
| `extends` | 0.8 | Subclass very likely affected |
| `implements` | 0.8 | Interface change → implementor affected |
| `reexport` | 0.7 | Re-export chain = direct dependency |
| `references` | 0.4 | Type/constant usage — weaker than call |
| `cochange` | 0.3 | Statistical — suggestive, not definitive |

The `0.85^depth` factor provides additional distance decay on top of per-type decay.

**Output format:**

```json
{
  "symbol": "extractImportsFromSource",
  "seed_file": "src/code-analysis/import-graph-impl.js",
  "affected_files": [
    {
      "path": "src/code-analysis/import-graph-impl.js",
      "reachability": 0.7,
      "signals": ["call", "import"],
      "depth": 1
    },
    {
      "path": "src/code-analysis/call-graph-impl.js",
      "reachability": 0.35,
      "signals": ["import", "references"],
      "depth": 2
    }
  ],
  "affected_symbols": [
    {
      "name": "buildImportGraph",
      "file": "src/code-analysis/import-graph-impl.js",
      "reachability": 0.7,
      "via": "call"
    }
  ],
  "edge_trace": [
    "extractImportsFromSource --[call]→ buildImportGraph",
    "buildImportGraph --[reexport]→ legacy-core.js"
  ]
}
```

### LLM format

Updated in `src/platform/protocol/llm-format.ts` — the `'blast-radius'` case renders the richer output:

```
**Blast radius of extractImportsFromSource** (import-graph-impl.js)
Affected files: 7 (by reachability)

  [0.70] import-graph-impl.js — via call, import
  [0.49] incremental-builders.js — via call
  [0.35] call-graph-impl.js — via import
  [0.35] legacy-core.js → impact.js — via reexport
  [0.24] incremental-indexer.js — via import
  [0.17] code-impl.js — via reexport
  [0.15] code-analysis.test.js — via cochange

Affected symbols:
  [0.70] buildImportGraph (import-graph-impl.js)
  [0.49] buildImportGraphForFiles (incremental-builders.js)
  [0.35] resolveCallee (call-graph-impl.js)
```

### Backward compatibility

- Old `getBlastRadius` function remains unchanged. Other callers (e.g. `getPrRiskProfile`) continue to use it.
- The `blast-radius` gateway command checks if `code_relations` exists:
  - **Exists** → route to `getAffectedGraph` (new)
  - **Doesn't exist** → route to `getBlastRadius` (old)
- The tool mode name stays `blast-radius`. No new mode needed.

## Files changed

| File | Change |
|---|---|
| `schema.sql` | Add `code_relations` and `file_cochange` table definitions |
| `db.js` | Add `runMigrationV13` |
| `src/code-analysis/relation-builder.js` | **New** — 4 extraction functions |
| `src/code-analysis/cochange-builder.js` | **New** — git co-change extraction |
| `src/code-analysis/propagation-impl.js` | **New** — unified weighted BFS |
| `src/code-analysis/legacy-core.js` | Wire new modules into exports |
| `src/code-analysis/impact.js` | Route `blast-radius` to new propagation engine |
| `src/code-index/incremental-indexer.js` | Call new extraction functions in derived phase |
| `src/platform/protocol/llm-format.ts` | Updated blast-radius formatting |
| `src/platform/protocol/compact-format.ts` | Updated blast-radius compact payload |

## Testing

Each new module gets its own test file:

- `test/relation-builder.test.js` — test extends/implements/reexport/references extraction against a temp DB with known symbols. Test per-language regex patterns (JS/TS, Python).
- `test/cochange-builder.test.js` — test git log parsing and pair counting. Mock git output.
- `test/propagation-impl.test.js` — test weighted BFS with known graph topology. Verify reachability scores decay correctly. Verify fallback to old behavior when `code_relations` doesn't exist.
- `test/incremental-derived.test.js` — extend existing incremental derived tests to cover relation edge rebuilding.

## Scope and non-goals

**In scope:**
- New edge types (extends, implements, reexport, references)
- Git co-change signal
- Unified weighted propagation engine
- Backward-compatible blast radius upgrade

**Explicitly out of scope:**
- Replacing `getBlastRadius` entirely (keep for other callers like `getPrRiskProfile`)
- Cross-repo analysis (crosshash's domain per ADR)
- AI-inferred edges (future work — would add edges via LLM analysis)
- Type-level analysis requiring TypeScript compiler (we use regex on signatures)
- Adding new `memory-code` modes (the new functionality surfaces through existing `blast-radius`, `deps`, `callers`, `callees` modes)
