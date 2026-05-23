# Scope-Aware Edge Extraction Design

**Date:** 2026-05-23  
**Status:** Approved (Revision 2 — review round 2 feedback incorporated)  
**Replaces:** Heuristic callee resolution in `call-graph-impl.js` (`resolveCallee` function)

## Problem

Code analysis queries (`callers`, `callees`, `deps`, `importance`) frequently return empty or inaccurate results because the callee resolution pipeline uses a heuristic cascade — seven strategies tried in sequence, most producing edges with `calleeSymbolId = null` and low confidence. The fundamental issue is that resolution happens without scope context: the resolver doesn't know which names are visible at each call site.

## Solution

Build per-file scope tables at parse time that map every local binding to its origin (import, declaration, parameter, etc.). Resolution then becomes a deterministic lookup against these tables instead of a chain of guesses.

## Architecture

### Data Flow

```
tree-sitter parse
      ↓
extractSymbolsFromFile (existing)
buildScopeBindings (new — same tree, same content)
      ↓
insertSymbols + insertScopeBindings (batched)
      ↓
derivedPhase
      ↓
resolveBindings (new — multi-pass resolution into scope_resolution table)
buildCallGraph (simplified — reads scope_resolution instead of heuristics)
```

### New Database Tables

#### `file_scope_bindings` (parse artifact — immutable after parse)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `repo_id` | INTEGER NOT NULL | FK to code_repos |
| `file_id` | INTEGER NOT NULL | FK to code_files |
| `name` | TEXT NOT NULL | The local binding name visible in scope |
| `kind` | TEXT NOT NULL | Syntactic form that introduced the name |
| `origin` | TEXT NOT NULL | Semantic binding category |
| `source_file_id` | INTEGER NULL | File the name originates from (NULL for external/unresolved) |
| `source_name` | TEXT NULL | Original name at source (for aliasing) |
| `line_start` | INTEGER NOT NULL | Scope visibility begins (1-indexed) |
| `line_end` | INTEGER NOT NULL | Scope visibility ends |
| `scope_depth` | INTEGER NOT NULL DEFAULT 0 | Nesting depth (0 = file-level, 1 = function, 2 = block inside function, etc.) |
| `byte_start` | INTEGER NULL | Optional: byte-range precision for languages that need it |
| `byte_end` | INTEGER NULL | Optional: byte-range precision for languages that need it |
| `first_seen_pass` | INTEGER NOT NULL DEFAULT 0 | Which pass first created this binding. **0 = parse-time artifact** (not a resolution pass). **1+ = synthetic binding created during resolution pass N**. Health check queries should filter `first_seen_pass >= 1` to find synthetic bindings. |

Indexes: `(repo_id, file_id, name, line_start)`, `(repo_id, file_id, line_start, line_end)`, `(file_id, scope_depth)`

No unique constraint. Correctness comes from the delete-then-insert strategy per file (see Reindex Compatibility).

#### `scope_resolution` (resolution pass — mutable, rebuildable)

| Column | Type | Description |
|--------|------|-------------|
| `binding_id` | INTEGER PK | FK to file_scope_bindings.id |
| `resolved_symbol_id` | INTEGER NULL | FK to code_symbols.id (internal resolution) |
| `resolved_file_id` | INTEGER NULL | FK to code_files.id (for re-export chains) |
| `status` | TEXT NOT NULL | `resolved_internal` / `resolved_external` / `unresolved` |
| `resolved_at_pass` | INTEGER NOT NULL | Which resolution pass produced this (1=direct, 2=re-export chain, etc.) |
| `confidence` | REAL NOT NULL DEFAULT 1.0 | Resolution confidence |

Indexes: `(binding_id)`, `(resolved_symbol_id)`, `(status)`, `(resolved_at_pass)`

### kind/origin Value Space

**Design decision:** `kind` is the syntactic form. `origin` is the semantic binding category. They are orthogonal.

#### JavaScript/TypeScript

| kind | origin | Example |
|------|--------|---------|
| `named_import` | `external_file` | `import { foo } from './bar'` |
| `named_import` | `external_package` | `import { z } from 'zod'` |
| `default_import` | `external_file` | `import foo from './bar'` |
| `default_import` | `external_package` | `import React from 'react'` |
| `namespace_import` | `external_file` | `import * as utils from './utils'` |
| `namespace_import` | `external_package` | `import * as fs from 'fs'` |
| `require` | `external_file` | `const foo = require('./bar')` |
| `require` | `external_package` | `const path = require('path')` |
| `destructure_import` | `external_file` | `const { foo } = require('./bar')` |
| `destructure_import` | `external_package` | `const { exec } = require('child_process')` |
| `re_export` | `external_file` | `export { foo } from './bar'` |
| `declaration` | `local` | `function foo() {}`, `const x = 1` |
| `destructure_local` | `local` | `const { foo, bar } = obj` |
| `parameter` | `local` | `function(foo, bar)` |
| `class_member` | `local` | `method() {}` inside a class |
| `dynamic_import` | `unresolved` | `import('./path')` |

#### Python

| kind | origin | Example |
|------|--------|---------|
| `named_import` | `external_file` | `from module import foo` |
| `named_import` | `external_package` | `from zod import z` |
| `from_import` | `external_file` | `import module` |
| `wildcard_import` | `external_file` | `from module import *` |
| `wildcard_import` | `external_package` | `from numpy import *` (not expanded, marked unresolved) |
| `re_export` | `external_file` | `__all__ = ['foo']; foo = imported.foo` — **v1: detection deferred** (requires light semantic pass beyond AST; see Known Limitations) |
| `declaration` | `local` | `def foo():`, `class Foo:` |
| `parameter` | `local` | `def foo(bar):` |
| `assignment` | `local` | `x = 1` |
| `destructure` | `local` | `a, b = func()` |
| `decorator` | `external_file` | `@decorator` |

#### Go

| kind | origin | Example |
|------|--------|---------|
| `named_import` | `external_package` | `import "fmt"` |
| `named_import` | `internal_package` | `import "./pkg"` |
| `dot_import` | `external_package` | `import . "fmt"` |
| `dot_import` | `internal_package` | `import . "./pkg"` |
| `declaration` | `local` | `func foo()` |
| `receiver_param` | `local` | `func (r *Receiver) foo()` |
| `type_declaration` | `local` | `type Foo struct` |
| `var_declaration` | `local` | `var x int` |

#### Rust

| kind | origin | Example |
|------|--------|---------|
| `use` | `external_package` | `use serde::Deserialize` |
| `use` | `internal_module` | `use crate::module::Foo` |
| `declaration` | `local` | `fn foo()` |
| `let_binding` | `local` | `let x = 1` |
| `impl_method` | `local` | `fn foo(&self)` |
| `type_declaration` | `local` | `struct Foo` |

#### SQL

| kind | origin | Example |
|------|--------|---------|
| `table_ref` | `external` | `SELECT * FROM users` |
| `alias` | `local` | `SELECT u.name FROM users u` |
| `cte` | `local` | `WITH cte AS (...)` |
| `column_ref` | `local` | Column in WHERE/SELECT |

#### HTML

| kind | origin | Example |
|------|--------|---------|
| `element_id` | `local` | `<div id="app">` |
| `css_class` | `local` | `<div class="container">` |
| `script_src` | `external_file` | `<script src="./app.js">` |
| `inline_script` | `local` | `<script>...</script>` → **v1: no scope bindings generated** |

**HTML v1 limitation:** Inline scripts have fundamentally different scope semantics than module files (no import/export, potentially multiple scripts per file with separate scopes, execution ordering). For v1, inline scripts produce no scope bindings. This can be addressed in a follow-up with a dedicated inline-script scope builder that handles `window.foo = ...` assignments and script ordering.

## Multi-Pass Resolution

### Pass 1 — Parse all files, build scope tables

Process all files in any order. For each file, extract bindings but leave `source_file_id` NULL for imports. All bindings start as `status = 'unresolved'`. Each binding records its `scope_depth` — 0 for file-level (imports, top-level declarations), 1 for function body, 2 for nested blocks, etc. This enables innermost-scope resolution.

### Pass 2 — Direct resolution

For each binding:
- `origin = 'external_file'` → resolve `source_file_id` using `resolveImportTarget` (existing function). If found, look up the symbol in that file. Mark `status = 'resolved_internal'` or `'unresolved'`.
- `origin = 'external_package'` → mark `status = 'resolved_external'`, no symbol lookup needed.
- `origin = 'local'` → find matching `code_symbols` row in the same file by name AND line range (symbol's `start_line`/`end_line` must overlap with the binding's `line_start`/`line_end`). This handles overloaded names correctly: two `helper` functions in different classes each match their own scope binding. If multiple symbols match, prefer the one with the closest line range. Mark `status = 'resolved_internal'`.
- `origin = 'unresolved'` → mark `status = 'unresolved'`.

### Pass 3 — Re-export chain resolution

Fixed-point iteration (runs until no new bindings are resolved):

- `kind = 're_export'` → follow the chain: `source_file_id` → that file's scope table → find the original binding → follow to its `source_file_id`. Resolve the chain and mark `resolved_symbol_id`.
- `kind = 'wildcard_import'` (Python) → enumerate the source file's exported symbols and create synthetic bindings for each.
- `kind = 'namespace_import'` (JS) → create synthetic bindings for the source file's exported symbols, prefixed with the namespace name.

In practice, most repos need 2-3 iterations. A maximum of 10 iterations prevents infinite loops from circular re-exports.

**Convergence tracking:** After each iteration, the resolver counts how many new bindings were resolved. If the cap is hit without convergence, a warning is logged with the count and binding IDs of unresolved re-export chains. The health check surfaces these as `resolution_health` diagnostics, showing bindings with `resolved_at_pass >= 5`.

**Wildcard expansion cap:** A maximum of 50 synthetic bindings per wildcard expansion. If exceeded, the remaining symbols are left unexpanded and a diagnostic warning is logged. Wildcard imports with `origin = 'external_package'` (e.g., `from numpy import *`) are marked `status = 'unresolved'` and never expanded — the exports can't be enumerated from the AST.

## Scope Builder Architecture

Per-language scope builders are isolated modules:

```
src/code-index/
  scope-builder/
    index.js              — orchestrator: picks the right builder per language
    js-ts-scope.js        — JS/TS scope builder
    python-scope.js       — Python scope builder
    go-scope.js           — Go scope builder
    rust-scope.js         — Rust scope builder
    sql-scope.js          — SQL scope builder
    html-scope.js         — HTML scope builder (v1: resource refs only — inline script bindings deferred)
    shared.js             — common utilities (addBinding, dedup, etc.)
```

Each builder is a pure function: `(tree, source, filePath) => Binding[]`

Output format:

```js
{
  name: string,          // local binding name
  kind: string,          // syntactic form (see kind/origin tables)
  origin: string,        // semantic category
  sourceModule: string|null,  // the import path string (e.g., './utils', 'react')
  sourceName: string|null,    // original name at source (for aliased imports)
  lineStart: number,
  lineEnd: number,
  scopeDepth: number,   // 0 = file-level, 1+ = nested
  byteStart: number|null,
  byteEnd: number|null,
}
```

The orchestrator (`index.js`) picks the right builder based on file extension using the existing `LANGUAGE_MAP`.

## Integration Points

### 1. Schema Migration

Add `file_scope_bindings` and `scope_resolution` tables to the schema file. Bump `user_version` to 7. Add index on `scope_resolution(resolved_at_pass)` for convergence diagnostics.

### 2. parsePhase in incremental-indexer.js

After `extractSymbolsFromFile` runs on each file, also run `buildScopeBindings`. Scope bindings are inserted using a **delete-then-insert strategy**: `DELETE FROM file_scope_bindings WHERE file_id = ?` then bulk insert all bindings for that file. This avoids stale-row accumulation from shifted line numbers after edits and eliminates the need for upsert-by-unique-key.

### 3. derivedPhase in incremental-indexer.js

After `buildImportEdges`, add a new `resolveScopeBindings` step that runs the multi-pass resolution. This populates `scope_resolution`.

### 4. buildCallGraph in call-graph-impl.js

Replace the `resolveCallee` heuristic cascade with an innermost-scope lookup:

```js
function resolveCallee(calleeName, callerSym, receiver, fileId) {
  // Primary: look up in scope_resolution, prefer innermost scope
  const binding = db.prepare(`
    SELECT sr.resolved_symbol_id, sr.confidence, sr.status, fsb.scope_depth
    FROM file_scope_bindings fsb
    JOIN scope_resolution sr ON sr.binding_id = fsb.id
    WHERE fsb.file_id = ? AND fsb.name = ? AND fsb.line_start <= ? AND fsb.line_end >= ?
      AND sr.status = 'resolved_internal'
    ORDER BY fsb.scope_depth DESC, sr.confidence DESC
    LIMIT 1
  `).get(fileId, calleeName, callerSym.start_line, callerSym.start_line);
  
  if (binding) {
    return { calleeSymbolId: binding.resolved_symbol_id, confidence: binding.confidence };
  }
  
  // Fallback: existing heuristic cascade for cases not covered by scope tables
  return resolveCalleeHeuristic(calleeName, callerSym, receiver, fileContent);
}
```

The `ORDER BY scope_depth DESC` ensures that for block-scoped bindings (e.g., `let` inside an `if`), the innermost scope wins over a file-level binding with the same name. This handles JS `let`/`const`, Python list comprehension variables, and Rust block-scoped `let` bindings correctly.

The heuristic cascade is preserved as a fallback, not deleted. Dynamic calls, complex expressions, and language features not yet covered by scope builders will still be resolved heuristically.

### 5. Reindex Compatibility

- **Full reindex:** Builds scope tables from scratch, runs all resolution passes.
- **Incremental reindex:** For changed files: (1) `DELETE FROM scope_resolution WHERE binding_id IN (SELECT id FROM file_scope_bindings WHERE file_id = ?)` to clean dangling resolution rows, (2) `DELETE FROM file_scope_bindings WHERE file_id = ?` to remove stale bindings, (3) re-parse and bulk insert new bindings. Then re-run resolution for the changed files and their importers (files that import the changed files, identified via the import graph). The two-step delete ensures `scope_resolution` rows keyed to old auto-increment IDs don't dangle.
- **Force-derived flag:** New `--force-derived` option triggers re-resolution without re-parsing. Deletes all `scope_resolution` rows and re-runs the multi-pass resolver. Does not touch `file_scope_bindings` (parse artifact is preserved).

## Implementation Order

1. **Schema migration** — add tables, bump version
2. **Scope builder module structure** — `index.js`, `shared.js`, orchestrator
3. **JS/TS scope builder** — covers the most complex import system first
4. **Multi-pass resolver** — populates `scope_resolution` table
5. **Simplified buildCallGraph** — reads from `scope_resolution`, falls back to heuristics
6. **Python scope builder** — second most complex (wildcard imports)
7. **Go scope builder** — straightforward imports
8. **Rust scope builder** — `use` statements
9. **SQL scope builder** — table refs, CTEs, aliases
10. **HTML scope builder** — resource refs only (inline script bindings deferred)
11. **Integration tests** — verify callers/callees/deps return meaningful results

## Success Criteria

- `callers` and `callees` queries return non-empty results for symbols that have known callers/callees in the codebase
- `deps` query returns import edges between files
- `importance` query returns ranked symbols
- Resolution confidence ≥ 0.9 for >80% of resolved edges (compared to heuristic cascade's current ~60%)
- No regression in parse time (scope building should add <20% overhead since it walks the same tree)
- Incremental reindex correctly updates scope tables for changed files

**Measurement harness:** The confidence comparison is measured by:
1. Run a full reindex on PiMemoryExtension itself
2. Query `SELECT confidence FROM code_calls WHERE callee_symbol_id IS NOT NULL` — this is the resolved-edge baseline
3. After the scope-aware rewrite, run the same query and compare the confidence distribution
4. The `resolved_at_pass` field on `scope_resolution` provides per-binding diagnostics
5. The `resolution_health` check surfaces any bindings that didn't converge

## Known Limitations (v1)

- **HTML inline scripts** produce no scope bindings. Inline `<script>` blocks have fundamentally different scope semantics (no module system, multiple scripts per file, execution ordering). Deferred to a follow-up.
- **Python `re_export` detection** is deferred to a follow-up. Detecting `__all__`-based re-exports requires a light semantic pass (correlating an `__all__` assignment with the bindings it names) that goes beyond pure AST walking. For v1, Python files with `__all__` will have their exported symbols resolved only through direct import analysis.
- **Wildcard imports from external packages** (`from numpy import *`) are marked `unresolved` and not expanded. Only wildcard imports from tracked internal files are expanded (with a 50-symbol cap).
- **Dynamic `import()` calls** produce `status = 'unresolved'` bindings. Static analysis cannot determine the target at parse time.
