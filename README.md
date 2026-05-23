# LaPis 💎

> 🇵🇭 _lapis_ — pencil, to write
> 🪨 _lapis_ — stone, precious gem
> 🧠 La**Pi**s — memory for Pi

Persistent memory for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). One SQLite database, zero cloud dependencies, zero API keys.

## Architecture

LaPis is a **modular monolith** for Pi memory: one Pi extension and one local Node.js backend, with strict internal boundaries between extension adapters, CLI routing, feature services, and shared platform/storage infrastructure. The extension calls the backend via in-process `dispatch()` (shared Node.js process) with child process fallback for streaming operations like indexing.

![LaPis Modular Memory Architecture](memory-layer-architecture.png)

### Module boundaries

![LaPis module boundaries](docs/diagrams/lapis-module-boundaries.png)

### Memory lifecycle

![LaPis memory lifecycle](docs/diagrams/lapis-memory-lifecycle.png)

For dependency rules and module ownership details, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/MODULE_MAP.md`](docs/MODULE_MAP.md).

## Development

Start with the contributor guide when changing the codebase: [`CONTRIBUTING.md`](CONTRIBUTING.md). The concise architecture overview is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and the authoritative module ownership table is in [`docs/MODULE_MAP.md`](docs/MODULE_MAP.md).

Current development entry points:

| Path                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `memory-store.js`          | CLI entry point that delegates runtime dispatch.                                                                 |
| `cli.js`                   | Runtime command dispatch setup.                                                                                  |
| `src/cli/gateway.js`       | Feature command gateway and router composition.                                                                  |
| `src/memory-domain/`       | Declarative memory features such as observations, search, context, sessions, dedupe, compaction, and workspaces. |
| `src/workflow-memory/`     | Procedural workflow memory, steps, outcomes, and scoring.                                                        |
| `src/code-index/`          | Code repository indexing, parsing, symbol extraction, edges, incremental indexing, and source retrieval.         |
| `src/code-analysis/`       | Code intelligence queries such as graphs, blast radius, complexity, coupling, risk, and dead-code analysis.      |
| `src/doc-index/`           | Markdown documentation indexing, links, glossary, examples, and doc analytics.                                   |
| `src/trust-sync/`          | Integration boundary for memory/code symbol trust updates.                                                       |
| `src/platform/`            | Shared storage composition and protocol/output formatting.                                                       |
| `extensions/memory-layer/` | Pi extension hooks, host adapters, tool adapters, and result formatting.                                         |

Before opening a PR, run:

```bash
npm test
node test/smoke-cli.js
npm run check
```

## One-command install

```bash
pi install git:github.com/GeneGulanesJr/LaPis
```

Restart Pi and memory auto-wires on session start. Use `pi update --extensions` to keep it up to date.

LaPis does not install npm dependencies at runtime. If you are running from a local clone or developing the extension, install dependencies explicitly:

```bash
npm install
```

## What it does

- **Remembers across sessions** — decisions, bugfixes, patterns, discoveries persist
- **Auto-injects context** — next session starts with relevant memories loaded; injects visible warning if context fails to load
- **Code indexing** — web-tree-sitter (WASM) AST parses JS/TS/Go/Python/Rust/SQL files, searchable by issue description
- **Trust scoring** — memories linked to changed code lose trust; stable code boosts it
- **Deduplication** — trigram overlap prevents duplicate saves (≥85% auto-merges, 60–84% warns)
- **Workspaces** — formal project isolation with create/list/archive
- **Session lifecycle** — auto-recovery of incomplete sessions, trust recovery on close
- **Zero servers** — single Node.js CLI + SQLite, called on demand by Pi. Zero Python dependency.
- **Dream Cycle** — per-project, every 10th session, cleans superseded, zero-recall, stale corrections, and replaced configs (runs after session ends)
- **Update & delete** — update memories in-place instead of spawning correction entries

## What LaPis stores

LaPis stores memory locally in SQLite, by default at `~/.pi/memory/memory.db`. It does not require cloud services or API keys.

The memory layer can store:

- Explicit memories saved through `memory-save` or the `save` CLI command.
- Search/context recall metadata used to rank useful memories.
- Session start/end records and session summaries.
- Edited-file checkpoints, limited to file paths and brief progress metadata.
- Auto-detected assistant decisions, bugfix notes, discoveries, and constraints inferred from assistant messages (quality-gated: requires contextual words like "because"/"since"; dedup pipeline active).
- Code and documentation indexes for repositories you explicitly index with `memory-code` / `memory-doc`.
- Symbol links and trust scores that decay when linked code changes and improve when linked code stays stable.

The Dream Cycle runs per-project every 10 sessions (after session ends) and reviews memory quality. It removes or consolidates superseded memories, stale zero-recall auto memories, correction entries that should have been in-place updates, replaced setup/config memories, low-value auto titles, and related topic duplicates before running database compaction.

## Commands (called by Pi automatically)

### Observations & Search

| Command                 | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `save`                  | Save an observation (decision, bugfix, pattern, etc.) |
| `update --id`           | Update an existing observation in-place by ID         |
| `delete --id`           | Soft-delete an observation by ID (recoverable)        |
| `search`                | FTS5 full-text search with hybrid ranking             |
| `search --include-code` | Search both memories AND indexed code symbols         |
| `context`               | Load session context by project                       |
| `get`                   | Retrieve a single observation by ID                   |

### Code Indexing (v3 — WASM tree-sitter)

| Command                                | Purpose                               |
| -------------------------------------- | ------------------------------------- |
| `index-repo --path`                    | Index a local folder with tree-sitter |
| `reindex-repo --repo`                  | Incremental reindex via mtime         |
| `health-code-repo --repo`              | Report freshness, diagnostics, and index quality |
| `search-code --query`                  | FTS5 BM25 search over code symbols    |
| `get-code-source --repo --file --name` | Byte-accurate source retrieval        |
| `list-code-repos`                      | List indexed code repos               |
| `remove-code-repo --repo`              | Remove an indexed code repo           |

### Code Analysis (v5 — import graph, call graph, complexity, dead code)

| Command                          | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `import-graph --repo`            | Import dependency graph with recursive traversal   |
| `call-hierarchy --symbol --repo` | Call graph hierarchy (callers/callees)             |
| `blast-radius --symbol --repo`   | What breaks if a symbol changes                    |
| `dead-code --repo`               | Find unused code                                   |
| `complexity --repo`              | Cyclomatic complexity per function                 |
| `outline --repo --file`          | File symbol outline (classes, methods, standalone) |
| `churn --repo`                   | Git commit frequency metrics                       |

### Code Analytics (v5.2–v5.3 — hotspots, cycles, importance, coupling, signal chains)

| Command                     | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `hotspots --repo`           | Top symbols by complexity × churn (bug risk)            |
| `cycles --repo`             | Dependency cycles via Tarjan SCC                        |
| `importance --repo`         | Symbol PageRank on call graph                           |
| `coupling --repo`           | Afferent/efferent/instability per file                  |
| `extractable --repo`        | Refactoring candidates                                  |
| `hierarchy --symbol --repo` | Class hierarchy from parent_name                        |
| `signal-chains --repo`      | Detect HTTP/CLI gateways and trace call chains          |
| `layer-violations --repo`   | Check import rules against declared architecture layers |

### Doc Indexing (v5 — markdown sections, links, glossary, code examples)

| Command                          | Purpose                                        |
| -------------------------------- | ---------------------------------------------- |
| `index-docs --path --name`       | Index a markdown doc tree                      |
| `reindex-docs --repo`            | Re-index a doc repo                            |
| `doc-search --query --repo`      | Full-text search across doc sections           |
| `doc-outline --repo --file`      | Section hierarchy outline                      |
| `backlinks --repo --path`        | Find all docs that link TO a given doc         |
| `broken-links --repo`            | Find broken internal doc links                 |
| `glossary --repo --term`         | Look up glossary terms                         |
| `tutorial-path --section --repo` | Reconstruct ordered tutorial chain             |
| `code-examples --query --repo`   | Search fenced code blocks by content           |
| `doc-orphans --repo`             | Find sections with zero inbound links          |
| `doc-coverage --repo`            | Which code symbols have documentation coverage |
| `stale-pages --repo`             | Find docs modified since last index            |
| `doc-duplicates --repo`          | Find duplicate sections by content hash        |

### Workspace Management

| Command                    | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `list-workspaces`          | List all workspaces                        |
| `create-workspace --name`  | Create a workspace                         |
| `archive-workspace --name` | Archive a workspace (soft, data preserved) |

### Maintenance

| Command         | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `compact`       | Prune dead links, decay trust, VACUUM, optimize FTS5                               |
| `dream`         | Dream Cycle — clean **stale** memories (not just old). Auto-runs per-project every 10 sessions, after session ends |
| `stats`         | Database statistics                                                                |
| `list-projects` | List all known project names                                                       |

#### Dream Cycle

Unlike `compact` (housekeeping: vacuum, FTS optimize), the Dream Cycle targets **staleness** — information that is no longer accurate or useful:

| Phase               | What it cleans                                                   | Why it's stale                      |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| Superseded          | Memories with `duplicate`/`supersedes` relations                 | A newer memory replaces it          |
| Stale auto-progress | `progress` & `accomplished` types with zero recall               | Never useful, just noise            |
| Stale auto-detected | Auto-detected decisions with zero recall + low trust             | Pattern-matched junk never acted on |
| Stale corrections   | Titles starting with "CORRECTION:"                               | Should've used `update` instead     |
| Replaced configs    | Superseded configs (e.g. "using frpc" → "switched to CF Tunnel") | Superseded setup info               |

**Age alone is NOT a signal.** A 6-month-old valid decision stays. A 1-day-old superseded one goes.

## Configuration

Create `~/.pi/memory/config.jsonc` to override defaults. The file supports JSONC (JSON with `//` and `/* */` comments).

```jsonc
{
  // Database file path (default: ~/.pi/memory/memory.db)
  "db_path": "~/.pi/memory/memory.db",

  // SQLite WAL autocheckpoint threshold (default: 1000)
  "wal_autocheckpoint": 1000,

  // SQLite busy timeout in milliseconds (default: 5000)
  "busy_timeout_ms": 5000,

  // Search ranking weights (must sum to 1.0)
  "ranking": {
    "fts_relevance": 0.4,
    "recency": 0.3,
    "trust": 0.15,
    "recall": 0.15,
  },

  // Deduplication thresholds (0.0 - 1.0)
  "dedup": {
    // Auto-merge duplicates at or above this similarity
    "auto_merge_threshold": 0.85,
    // Flag potential duplicates at or above this similarity
    "warning_threshold": 0.6,
  },

  // Run compaction every N sessions for a project (default: 5)
  "compact_every_n_sessions": 5,

  // Path to tier config file (default: ~/.pi/memory/tier.jsonc)
  "tier_config_path": "~/.pi/memory/tier.jsonc",
}
```

All options are optional — only include the ones you want to change. Missing values use built-in defaults. Config changes are detected automatically via file mtime.

## Requirements

- **Node.js** with `@libsql/client` for async local SQLite/libSQL access
- No Python dependency — code parsing uses web-tree-sitter (WASM) in-process
- No API keys or cloud services needed

## Supported Languages for Code Indexing

JavaScript, TypeScript, TSX, Go, Python, Rust, SQL

## Token Efficiency Benchmark

The wire format (`wire-format.js`) uses compact encoding (columnar CSV with path interning, uniform-column hoisting, and internal-ID stripping) to reduce the token footprint of analysis responses inside Pi's context window.

Measured via `bench/bench-tokens.js` — runs real CLI commands against indexed repos, passes output through `compactResponse()`, and compares byte sizes.

### Results: Percentage Saved per Tool

| Tool         | [PiMemoryExtension](https://github.com/GeneGulanesJr/PiMemoryExtension) | [Aether (PCBuilder)](https://github.com/GeneGulanesJr/Aether) |
| :----------- | :---------------------------------------------------------------------: | :-----------------------------------------------------------: |
| importance   |                                   27%                                   |                              26%                              |
| hotspots     |                                   48%                                   |                              0%                               |
| dead-code    |                                   42%                                   |                            **47%**                            |
| coupling     |                                   33%                                   |                            **39%**                            |
| extraction   |                                   33%                                   |                              24%                              |
| cycles       |                                   0%                                    |                              0%                               |
| import-graph |                                   24%                                   |                              20%                              |
| **OVERALL**  |                                 **36%**                                 |                            **37%**                            |

### Total Savings

|                |   PiMemoryExtension    |    Aether (PCBuilder)     |
| :------------- | :--------------------: | :-----------------------: |
| Repo size      | 38 files · 210 symbols | 154 files · 1,359 symbols |
| Raw JSON       |        42.6 KB         |         181.7 KB          |
| Compact format |        27.1 KB         |         114.3 KB          |
| Bytes saved    |        15.5 KB         |          67.4 KB          |
| Tokens saved   |     ~4,445 tokens      |      ~19,242 tokens       |

**Key findings:**

- Dead-code sees the biggest gains (42–47%) — the `signals` and `confidence` fields are uniform across rows and get hoisted, while `symbol_id` is stripped
- Coupling benefits from prefix interning on shared file paths (33–39%)
- Larger repos trend higher — Aether (154 files, 1,359 symbols) edged out PiMemoryExtension (38 files) at 37% vs 36%
- Cycles and very small result sets show no savings (no homogeneous lists to encode)

All transforms are **lossless round-trip** — verified by 217 tests in `test/wire-format.test.js`.

Run it yourself:

```bash
node bench/bench-tokens.js
```

## Paired Memory Benchmark

Measures whether memory actually helps — runs the same task twice: once with LaPis disabled (memory-off), once with LaPis active (memory-on). Graded on factual accuracy (expected facts matched via substring aliases) and token efficiency.

```bash
npm run bench:pi-paired
```

### Latest Results

| Metric | Memory Off | Memory On | Delta |
|--------|-----------|-----------|-------|
| Facts correct | 18/18 | 18/18 | ✅ Tie |
| Active tokens | 36,824 | 10,419 | **−71.7%** |
| Wall time | ~211s | ~82s | **−61%** |

#### Per-category breakdown

| Category | Facts (off → on) | Tokens (off → on) | Savings |
|----------|-------------------|---------------------|---------|
| prior-decision | 3/3 → 3/3 | 8,948 → 1,572 | 82.4% |
| bug-history | 3/3 → 3/3 | 6,803 → 1,300 | 80.9% |
| staleness | 3/3 → 3/3 | 7,311 → 691 | 90.5% |
| navigation | 3/3 → 3/3 | 11,346 → 3,893 | 65.7% |
| negative-control | 6/6 → 6/6 | 2,416 → 2,963 | −22.6% |

**Key findings:**

- Memory-on achieves **equal accuracy with 72% fewer tokens** on memory-dependent tasks (prior-decision, bug-history, staleness, navigation)
- Negative controls (tasks where memory shouldn't help) show expected neutral-to-slight overhead — memory doesn't hurt but doesn't help for pure code-reading tasks
- Staleness detection sees the biggest win (90.5% token savings) — the agent recovers the right reindex action from memory instead of re-reading docs

## License

MIT
