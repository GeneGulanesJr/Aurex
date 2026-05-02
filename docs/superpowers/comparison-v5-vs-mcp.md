# PiMemoryExtension v5 vs jCodeMunch/jDocMunch — Comparison Test Results

**Date:** 2026-05-02  
**Test repo:** PiMemoryExtension (.worktrees/v5-code-analysis) — 8 JS files, 4,180 LOC  
**Doc repo:** 4 markdown files, 4,427 lines in `docs/`

---

## 1. Code Indexing

| Metric | v5 (memory-store.js) | jCodeMunch (MCP/uvx) |
|---|---|---|
| **Files indexed** | 8 (JS only) | 11 (JS + bash + SQL + JSON) |
| **Symbols extracted** | 122 (functions only) | 288 (functions + constants + methods) |
| **Import edges** | 30 | 4 (same edges, different count method) |
| **Call edges** | 848 | N/A (separate build step) |
| **Complexity computed** | 122 symbols | N/A (separate query) |
| **Wall time** | ~1,061ms | ~6,000ms+ (uvx spawn + Python + MCP) |
| **Process overhead** | Single process, in-memory | uvx spawn + Python startup + MCP bridge |
| **Dependencies** | Zero (Node.js builtins + WASM) | Python 3.11+, uvx, 60+ packages |

### Key Difference: Symbol Coverage
- **v5**: Only extracts `function` declarations (tree-sitter `function_declaration` nodes)
- **jCodeMunch**: Extracts functions, constants (`const X = ...`), methods, classes, and inner functions
- **Gap**: v5 misses ~166 symbols (constants, object properties, nested functions)
- **Impact**: Call graph and dead code analysis are less comprehensive in v5

### Key Difference: Language Support
- **v5**: JS/TS/TSX/SQL only (WASM grammars)
- **jCodeMunch**: 70+ languages (Python, Rust, Go, Java, etc.)

---

## 2. Import Graph

| Metric | v5 | jCodeMunch |
|---|---|---|
| **Edges for memory-store.js** | 10 (path + fs + os + 4 module requires + 3 relative) | 4 (JS module imports only) |
| **Resolution** | Resolves relative imports to file IDs | Resolves via `node_modules` aware import graph |
| **Package imports** | Captured with `target_file_id=null` | Also tracked but with richer metadata |
| **Query speed** | 30ms | ~500ms (MCP round-trip) |
| **Recursive depth** | CTE-based depth traversal to N | `get_dependency_graph` up to 3 hops |

**v5 advantage**: Full file-level import graph includes `require('path')`, `require('fs')` etc.  
**jCodeMunch advantage**: Better node_modules resolution, barrel file awareness

---

## 3. Call Hierarchy (`ensureDb`)

| Metric | v5 | jCodeMunch |
|---|---|---|
| **Direct callers found** | 8 | 8 |
| **Same result** | ✅ searchCode, getCodeSource, listCodeRepos, removeCodeRepo, listWorkspaces, createWorkspace, archiveWorkspace | ✅ Same 7 + search (depth 2) |
| **Resolution method** | Regex-based with confidence scoring (0.7-1.0) | AST-based `ast_resolved` |
| **Query speed** | 29ms | ~600ms (MCP round-trip) |

**Both found the same callers** — v5's regex approach matches jCodeMunch's AST for this case.

---

## 4. Cyclomatic Complexity (`search` function)

| Metric | v5 | jCodeMunch |
|---|---|---|
| **Cyclomatic** | 30 | 39 |
| **Nesting** | 1 | 4 |
| **Lines** | 82 | 95 |
| **Assessment** | high | high |
| **Query speed** | 32ms | ~500ms |

**Discrepancy analysis**:
- v5 counts `if`, `else if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`, ternary
- jCodeMunch counts AST decision nodes which may catch more patterns
- v5 nesting=1 is likely wrong (should be 4) — nesting counter may not handle JS brace depth correctly
- Both agree the function is high-complexity, which is the actionable signal

---

## 5. Dead Code Detection

| Metric | v5 | jCodeMunch |
|---|---|---|
| **Dead files** | 4 (SQL, JSON, sh files) | 0 (indexed all file types) |
| **Dead symbols** | 0 (only checks functions) | 129 at confidence ≥0.34 |
| **Entry point detection** | filename patterns + shebang + `export default` | filename patterns + `entry_point_patterns` param |
| **Confidence scoring** | 0.33 per signal (2 signals max) | 0.33 per signal (3 signals: unreachable, no_callers, not_barrel) |
| **Query speed** | 34ms | ~800ms |

**Major gap**: jCodeMunch's dead code is much more comprehensive because:
1. It detects "no standard entry points" and reports the framework warning
2. It has 3 signals vs v5's 2, giving better granularity
3. It tracks barrel exports (`index.js` re-exports)
4. v5's 0 dead symbols means its heuristics need tuning

**v5 false positive**: 4 dead "files" are non-JS files (SQL, JSON, shell scripts) that aren't imported via JS `require()` — correct behavior for JS import graph but misleading.

---

## 6. Doc Indexing

| Metric | v5 (doc-indexer.js) | jDocMunch (MCP/uvx) |
|---|---|---|
| **Files indexed** | 4 | 4 |
| **Sections extracted** | 89 | 68 |
| **Code blocks** | 73 | N/A (embedded in section content) |
| **Glossary terms** | 17 | N/A (not extracted) |
| **Links** | 12 | N/A (separate broken-link check) |
| **Index time** | 200ms | ~3,000ms+ (uvx spawn) |
| **Query speed (search)** | 35ms | ~800ms |
| **Roles** | auto-classified (tutorial, api, how_to, concept...) | auto-classified with confidence |
| **Hashtags** | Extracted | Not extracted |
| **Broken links** | 12 (but 0 resolved — link resolution needs work) | N/A |
| **Backlinks** | Supported | Supported |
| **Tutorial paths** | Supported (next/prev links + numeric filenames) | Supported |

**v5 advantage**:
- Glossary term extraction (`**Term** — definition` pattern)
- Code block indexing (separate table for code search)
- Hashtag extraction
- 89 sections vs 68 — v5 splits at more heading boundaries

**jDocMunch advantage**:
- Semantic search (when embeddings enabled)
- Answerability/quotability scoring
- More robust role classification
- Section deduplication

---

## 7. Startup Overhead (Session Cost)

| Metric | v5 | jCodeMunch + jDocMunch |
|---|---|---|
| **Session startup** | 0ms (already in-process) | ~800ms per uvx spawn × 2 = ~1,600ms |
| **Memory footprint** | ~30MB (single SQLite + WASM) | ~200MB+ (2 Python processes) |
| **Failure mode** | Graceful (WASM missing → code disabled) | uvx/Python missing → tools unavailable |

---

## Summary Scorecard

| Category | v5 | jCodeMunch/jDocMunch | Winner |
|---|---|---|---|
| **Speed** | 30-35ms queries, 1s index | 500-800ms queries, 6s+ index | 🟢 **v5** |
| **Symbol coverage** | Functions only (122) | All kinds (288) | 🟡 **jCodeMunch** |
| **Language support** | JS/TS/TSX/SQL | 70+ languages | 🟡 **jCodeMunch** |
| **Call hierarchy** | Same results, 20x faster | Same results | 🟢 **v5** (speed) |
| **Import graph** | More edges captured | Better package resolution | 🟡 **tie** |
| **Complexity** | Accurate magnitude, faster | More accurate nesting | 🟡 **jCodeMunch** |
| **Dead code** | Heuristic, needs tuning | Mature 3-signal model | 🟡 **jCodeMunch** |
| **Doc indexing** | More features (glossary, hashtags, code blocks) | Better search quality | 🟢 **v5** (features) |
| **Startup cost** | Zero | ~1.6 seconds | 🟢 **v5** |
| **Dependencies** | Zero Python | Python 3.11+ + uvx | 🟢 **v5** |
| **Blast radius** | ✅ Supported | ✅ Supported | 🟡 **tie** |
| **Churn metrics** | ✅ Supported (git CLI) | ✅ Supported (git) | 🟢 **v5** (integrated) |

**Verdict**: v5 wins on **speed** (10-30x faster queries), **startup overhead** (zero), and **dependency simplicity** (zero Python). jCodeMunch wins on **breadth** (70+ languages, more symbol kinds) and **analysis depth** (better dead code, more accurate nesting). For the PiMemoryExtension's JS/TS only use case, v5 is the right trade-off.

### Improvements Needed for v5 Parity
1. **Extract constants and classes** (not just functions) in parse-code.js
2. **Fix nesting depth counter** (currently undercounting)
3. **Add barrel export awareness** to dead code detection  
4. **Fix link resolution** (currently 0/12 resolved)
5. **Add a third dead code signal** (not barrel-exported)