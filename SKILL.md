---
name: memory-layer
description: Standalone persistent memory for Pi — smart search, symbol clustering, dedup, auto-recovery, trust scoring. Zero external dependencies.
---

# Pi Memory Layer v4

Persistent memory via a single SQLite database (`~/.pi/memory/memory.db`).
All operations through `memory-store.js` — zero external dependencies, zero MCP servers.

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

### Code Indexing (v3 — tree-sitter AST parser)
- `index-repo --path ABS_PATH [--name NAME]` — Index a local folder with tree-sitter.
- `reindex-repo --repo NAME [--mode full|incremental]` — Incremental reindex via mtime.
- `search-code --query TEXT [--repo NAME] [--kind TYPE] [--max-results N]` — FTS5 BM25 over code symbols.
- `get-code-source --repo NAME --file PATH --name SYMBOL` — Byte-accurate source retrieval.
- `list-code-repos` / `remove-code-repo --repo NAME` — Manage indexed repos.

**Supported:** JavaScript, TypeScript, SQL. Requires Python 3.10+ with tree-sitter packages.

### Workspace Management (v4)
- `list-workspaces` — All workspaces with counts and archive status.
- `create-workspace --name NAME` — Create a named workspace.
- `archive-workspace --name NAME` — Soft-archive (data preserved).

### Symbol-aware recall
- `symbol-cluster --symbol SYMBOL_ID [--repo NAME]` — all memories for a symbol
- `related --id INT` — memories linked to the same symbols
- `link-symbol --memory TEXT --symbol TEXT --repo TEXT [--trust REAL]`
- `auto-link --project NAME`
- `sync-code-trust --repo TEXT --changed-symbols-json JSON` — trust sync with jCodeMunch

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

- No sqlite3 → fails with install instructions
- DB corrupted → suggest deleting `~/.pi/memory/memory.db`
- No MCP server needed — fully self-contained
