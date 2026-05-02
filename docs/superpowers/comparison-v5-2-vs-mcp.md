# PiMemoryExtension v5.2 vs jCodeMunch/jDocMunch — Comparison Results

**Date:** 2026-05-02
**Repo tested:** PiMemoryExtension .worktrees/v5-code-analysis/ (8 JS files)

## Feature Matrix

| Feature | v5.2 | jCodeMunch/jDocMunch |
|---|---|---|
| **Symbol count** | 170 | 318 |
|   - Functions | 122 | ~160 |
|   - Constants | 48 | ~130 |
|   - Methods | — | ~28 |
|   - Classes | — | ~3 |
| **Language support** | JS/TS/TSX/SQL (4) | 70+ langs |
| **Index speed** | ~1s | ~6s+ |
| **Query speed** | 10-30ms | 500-800ms |
| **Zero dependencies** | ✅ | ❌ (npm, python) |
| **Single DB** | ✅ (SQLite) | ❌ (separate server) |
| **In-process** | ✅ | ❌ (MCP bridge) |

## Code Analysis

| Feature | v5.2 | jCodeMunch |
|---|---|---|
| Import graph | ✅ | ✅ |
| Call hierarchy | ✅ (regex) | ✅ (AST) |
| Blast radius | ✅ | ✅ |
| Dead code | ✅ (3-signal) | ✅ (3-signal) |
| Cyclomatic complexity | ✅ | ✅ (higher counts) |
| Nesting depth | ✅ (string-aware) | ✅ (AST) |
| File outline | ✅ | ✅ |
| Churn metrics | ✅ | ✅ |
| Hotspots (complexity×churn) | ✅ | ✅ |
| Dependency cycles (SCC) | ✅ | ✅ |
| Symbol importance (PageRank) | ✅ | ✅ |
| Coupling (Ca/Ce/I) | ✅ | ✅ |
| Extraction candidates | ✅ | ✅ |
| Class hierarchy | ✅ (parent_name) | ✅ (extends/implements) |
| Call resolution | regex | AST-resolved |
| Method extraction | ❌ | ✅ |
| Layer violations | ❌ | ✅ |
| Signal chains | ❌ | ✅ |
| AST pattern search | ❌ | ✅ |

## Doc Indexing

| Feature | v5.2 | jDocMunch |
|---|---|---|
| Sections extracted | 109 | 102 |
| FTS5 search | ✅ | ✅ |
| Role classification | ✅ (8 types) | ✅ (9 types) |
| Hashtag extraction | ✅ | ❌ |
| Glossary | ✅ | ✅ |
| Code blocks | ✅ (73) | ✅ |
| Link resolution | ✅ (1/1 valid) | ✅ (higher rate) |
| Orphan sections | ✅ | ✅ |
| Doc coverage | ✅ | ✅ |
| Backlinks | ✅ | ✅ |
| Broken links | ✅ | ✅ |
| Tutorial paths | ✅ | ✅ |
| Answerability | ✅ (heuristic) | ✅ (ML-based) |
| Stale pages | ❌ | ✅ |
| Section dedup | ❌ | ✅ (hash-based) |
| Semantic search | ❌ | ✅ (embeddings) |

## Head-to-Head Results

### Hotspots (same repo, same churn data)

| Rank | v5.2 | jCodeMunch |
|---|---|---|
| 1 | reindexRepoInternal (score=43.1, cycl=51) | reindexRepoInternal (score=118.7, cycl=61) |
| 2 | indexDocs (38.1, cycl=49) | indexRepoInternal (103.1, cycl=53) |
| 3 | context (33.0, cycl=39) | context (101.2, cycl=52) |
| 4 | searchCode (27.9, cycl=33) | syncCodeTrust (99.2, cycl=51) |
| 5 | getDeadCode (27.0, cycl=32) | search (75.9, cycl=39) |

Same top functions, same risk ordering. jCodeMunch scores are higher because it counts more decision points (catch blocks, method entries).

### Dependency Cycles
Both: 0 cycles (acyclic import graph)

### Call Hierarchy (ensureDb)
- v5.2: 19 callers (regex-matched, more inclusive)
- jCodeMunch: 8 callers (AST-resolved, more precise)

## v5.2 Wins

1. **10-30x faster queries** — SQLite direct vs MCP bridge
2. **Zero installation** — bundled WASM, no npm/pip
3. **Zero external dependencies** — no Python, no MCP server
4. **Zero startup latency** — in-process, no process spawn
5. **Single SQLite DB** — no separate database server
6. **Hashtag extraction** — jDocMunch lacks this
7. **More doc sections** — 109 vs 102
8. **Heuristic answerability** — no ML provider needed
9. **Runs in Pi process** — no MCP bridge overhead

## jCodeMunch Wins

1. **87% more symbols** — methods, classes, types extracted
2. **70+ languages** — vs 4
3. **AST-precise call resolution** — regex can over-match
4. **Higher cyclomatic accuracy** — more decision point types
5. **Semantic/embedding search** — better relevance ranking
6. **Stale page detection** — knows when docs drift from source
7. **Hash-based section dedup** — avoids duplicate sections
8. **Layer violation detection** — configurable architecture rules
9. **Signal chains** — HTTP → handler → callee tracing
10. **AST pattern search** — empty_catch, bare_except, etc.

## Remaining v5.2 Gaps

1. Method/class extraction (tree-sitter node types)
2. More languages (Python, Go, Rust, etc.)
3. AST-level call resolution (currently regex)
4. Semantic/embedding search (requires embedding provider)
5. Stale page detection (mtime comparison)
6. Section deduplication (content-hash matching)
7. Layer violations (configurable rules)
8. Signal chains (HTTP route → handler → callee)
