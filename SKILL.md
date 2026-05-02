---
name: memory-layer
description: Standalone persistent memory for Pi — smart search, symbol clustering, dedup, auto-recovery, trust scoring. Zero Python dependency.
---

# Pi Memory Layer v5

Persistent memory via a single SQLite database (`~/.pi/memory/memory.db`).
All operations through `memory-store.js` — zero Python dependency, zero MCP servers.
Code parsing uses web-tree-sitter (WASM) in-process.
Code analysis (imports, call graph, complexity, dead code, churn) and doc indexing (markdown sections, links, glossary, code examples) built in — no external tools needed.

## CLI Quick Reference

### Session lifecycle
- `session-start --project NAME` → auto-recovers incomplete sessions, returns `{ sessionId, recoveredSession }`
- `session-end --id INT --memories INT [--auto]` → trust-recovery + close

### Observations
- `save --title TEXT --content TEXT [--type TYPE] [--project NAME] [--scope project|personal] [--topic-key KEY] [--session-id ID] [--force]`
  - Dedup pipeline: trigram overlap checked against existing observations of the same type+project.
  - **≥85% overlap** → auto-merges (keeps new, soft-deletes old, records `observation_relations`).
  - **60-84% overlap** → `potential_duplicate` warning, lists matching IDs.
  - Use `--force` to bypass dedup entirely.
- `search --query TEXT [--project NAME] [--type TYPE] [--scope SCOPE] [--limit N] [--session-id ID]`
  - Hybrid ranking: FTS5 relevance × recency × trust × recall history.
  - **Recall auto-logged** when `--session-id` is provided.
  - Results include `_score` for transparency.
  - `--include-code` flag returns both memories AND indexed code symbols.
- `context --project NAME [--limit N] [--session-id ID] [--topic-key KEY] [--query TEXT] [--deep true]`
  - Priority-weighted: decisions/architecture first, then bugfixes/patterns, then discoveries.
  - Includes cross-project personal-scope observations.
  - Excludes `skill` type from project context.

### Code Indexing (v3 — tree-sitter AST parser, WASM)
- `index-repo --path ABS_PATH [--name NAME]` — Index a local folder with tree-sitter.
- `reindex-repo --repo NAME [--mode full|incremental]` — Incremental reindex via mtime.
- `search-code --query TEXT [--repo NAME] [--kind TYPE] [--max-results N]` — FTS5 BM25 over code symbols.
- `get-code-source --repo NAME --file PATH --name SYMBOL` — Byte-accurate source retrieval.
- `list-code-repos` / `remove-code-repo --repo NAME` — Manage indexed repos.

**Supported:** JavaScript, TypeScript, TSX, SQL. Uses web-tree-sitter (WASM) — zero Python dependency.
Grammar .wasm files bundled in `grammars/`.

### Code Analysis (v5 — import graph, call graph, complexity, dead code)
- `import-graph --repo NAME [--file F] [--direction imports|importers|both] [--depth N]` — Import dependency graph with recursive traversal
- `call-hierarchy --symbol S --repo NAME [--direction callers|callees] [--depth N]` — Call graph hierarchy
- `blast-radius --symbol S --repo NAME [--depth N]` — What breaks if a symbol changes
- `dead-code --repo NAME [--min-confidence 0.5] [--include-tests true]` — Find unused code
- `complexity --repo NAME [--symbol S]` — Cyclomatic complexity per function
- `outline --repo NAME --file F` — File symbol outline (classes, methods, standalone)
- `churn --repo NAME [--file F] [--days 90] [--refresh true]` — Git commit frequency metrics

### Code Analytics (v5.2 — hotspots, cycles, importance, coupling, extraction, hierarchy)
- `hotspots --repo NAME [--top N] [--days N]` — Top N symbols by complexity × churn (bug risk)
- `cycles --repo NAME` — Dependency cycles via Tarjan SCC on import graph
- `importance --repo NAME [--top N] [--scope DIR]` — Symbol PageRank on call graph
- `coupling --repo NAME [--file F] [--sort-by instability|afferent|efferent]` — Afferent/efferent/instability per file
- `extractable --repo NAME [--min-complexity N] [--min-callers N] [--top N]` — Refactoring candidates (complex functions called from many files)
- `hierarchy --repo NAME --symbol S [--direction both|ancestors|descendants]` — Class hierarchy from parent_name

### Code Analytics (v5.3 — signal chains, layer violations, AST calls)
- `signal-chains --repo NAME [--kind http|cli] [--symbol S] [--max-depth N]` — Detect HTTP/CLI gateways and trace call chains
- `layer-violations --repo NAME [--rules JSON]` — Check import rules against declared architecture layers

**Note:** Layer rules can be defined inline via `--rules` or in a `.pimemory-layers.jsonc` file at the repo root.
Signal chains detect Express routes (`app.get/post/...`), router patterns, and CLI commands.
AST call resolution (v5.3) uses tree-sitter `call_expression` nodes instead of regex for JS/TS.

**Note:** Churn metrics require `git` CLI. All other analysis works on any indexed repo.
Complexity does NOT count `?.` optional chaining as a decision point.
Dead code confidence: 0.33 per signal (no callers, unreachable file), 1.0 = provably unreachable.

### Doc Indexing (v5 — markdown sections, links, glossary, code examples)
- `index-docs --path P --name NAME [--ignore GLOB]` — Index a markdown doc tree
- `reindex-docs --repo NAME [--mode full] [--ignore GLOB]` — Re-index a doc repo
- `doc-search --query Q --repo NAME [--level N] [--role TYPE]` — Full-text search across doc sections
- `doc-outline --repo NAME [--file F]` — Section hierarchy outline
- `backlinks --repo NAME --path F` — Find all docs that link TO a given doc
- `broken-links --repo NAME` — Find broken internal doc links
- `glossary --repo NAME [--term T]` — Look up glossary terms (`**Term** — definition` pattern)
- `tutorial-path --section INT --repo NAME` — Reconstruct ordered tutorial chain
- `code-examples --query Q --repo NAME [--lang X]` — Search fenced code blocks by content
- `doc-orphans --repo NAME [--include-same-doc]` — Find sections with zero inbound links
- `doc-coverage --repo NAME [--doc-repo DOC_REPO]` — Which code symbols have documentation coverage

### Doc Analytics (v5.3 — stale pages, duplicates)
- `stale-pages --repo NAME` — Find docs modified since last index (mtime comparison)
- `doc-duplicates --repo NAME` — Find duplicate sections by content hash

**Hashtag extraction:** `(?<!#)#(\w{2,})` with negative lookbehind (excludes ATX headings).
**Heading slugs:** lowercase → strip non-alphanumeric → replace spaces with hyphens (GitHub-compatible).
**Role classification:** tutorial, api, how_to, concept, troubleshooting, changelog, faq, example, other.

### Workspace Management (v4)
- `list-workspaces` — All workspaces with counts and archive status.
- `create-workspace --name NAME` — Create a named workspace.
- `archive-workspace --name NAME` — Soft-archive (data preserved).

### Symbol-aware recall
- `symbol-cluster --symbol SYMBOL_ID [--repo NAME]` — all memories for a symbol
- `related --id INT` — memories linked to the same symbols
- `link-symbol --memory TEXT --symbol TEXT --repo TEXT [--trust REAL]`
- `auto-link --project NAME`
- `sync-code-trust --repo TEXT --changed-symbols-json JSON` — trust sync with code changes

### Maintenance
- `compact` — prune dead links, decay stale trust, VACUUM, optimize FTS5 (auto-runs every 5 sessions)
- `stats`
- `list-projects`

## Project Detection (v3.2)

On session start, the extension:
1. Queries `list-projects` for all known project names
2. Walks up the current working directory tree
3. Returns the first directory name matching a known project
4. Falls back to `path.basename(cwd)` if nothing matches

### Cross-Project Fallback

When a project has zero memories, loads cross-project context from all known projects.
Personal preferences always load regardless of project.

## Session Protocol

### Start
1. `session-start --project <PROJECT>` → save `sessionId`
2. Incorporate context from returned `observations` and `personal` lists
3. If `recoveredSession` is present, review what was auto-recovered

### During Session
- Save immediately: decisions, preferences, bugfixes, architecture constraints
- Save if novel: new dependencies, file discoveries, repeated patterns
- Search before saving to avoid duplicates
- Use `--scope personal` for preferences that apply across all projects

### End
1. `session-summary --content "## Goal\n...\n## Accomplished\n..."`
2. `session-end --id <ID> --memories <COUNT> --auto`

## Search Ranking

- **FTS5 relevance** (40%) — text match quality
- **Recency** (30%) — exponential decay, 7-day half-life
- **Trust score** (15%) — from symbol links
- **Recall history** (15%) — how often this memory was useful
- **Type boost** — decisions/architecture ranked higher than summaries

## Dedup Policy

On `save`, trigram overlap checked against existing observations:
- **≥85% overlap** → auto-merge
- **60-84% overlap** → potential_duplicate warning
- Use `--force` to bypass

## Trust Scoring

| Trust Range | Behavior |
|---|---|
| 0.8 - 1.0 | Surface confidently |
| 0.5 - 0.7 | Surface with caveat |
| 0.3 - 0.4 | Surface with warning |
| 0.0 - 0.2 | Don't surface automatically |

## Graceful Degradation

- No web-tree-sitter → code indexing disabled gracefully, non-code features work
- No git → churn metrics disabled, all other features work
- No sqlite3 → fails with install instructions
- DB corrupted → suggest deleting `~/.pi/memory/memory.db`
- No MCP server needed — fully self-contained (v5 includes code analysis + doc indexing natively)
