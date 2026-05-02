# PiMemoryExtension v5 — Code Analysis & Doc Indexing

## Goal

Expand PiMemoryExtension into a self-contained code intelligence and documentation indexing engine. No external MCP servers, no Python dependencies, no subprocess spawns beyond optional `git` for churn analysis. Everything runs in-process against a single SQLite database.

## Scope

### Code Analysis
- Import/dependency graphs (file→file edges)
- Call hierarchies (symbol→symbol edges, callers and callees)
- Blast radius (transitive dependency walk from a symbol)
- Dead code detection (symbols with zero importers)
- Cyclomatic complexity per symbol
- Git churn metrics per file/symbol
- File outline (all symbols in a file)

### Doc Indexing
- Markdown section extraction with heading hierarchy
- Doc section FTS5 search
- Heading outline tree (nested parent→child)
- Internal link extraction and backlink computation
- Broken link detection
- Glossary/term lookup (from `**Term** — definition` patterns)
- Tutorial path detection (ordered section chains from next/prev links or numeric prefixes)
- Fenced code block search (by language + content)

### Language Support
JavaScript, TypeScript, TSX, SQL — via existing web-tree-sitter WASM grammars.

### Not in Scope
- Additional language grammars (Python, Rust, Go, etc.)
- Third-party API documentation (Auth0, etc.)
- Semantic/embedding-based search
- OpenAPI/protobuf/GraphQL schema indexing
- Runtime test coverage analysis

## Architecture

### Module Layout

```
PiMemoryExtension/
├── memory-store.js       # CLI entry point + existing features (modified: delegate to new modules)
├── parse-code.js         # WASM tree-sitter parser (existing, extended)
├── code-analysis.js      # NEW: import graph, call graph, dead code, complexity
├── doc-indexer.js        # NEW: markdown sections, links, glossary, code blocks
├── git-analysis.js       # NEW: git log/blame wrappers for churn
├── grammars/             # WASM grammar files (unchanged)
├── schema.sql            # Schema v5 (new tables + all existing tables)
├── install.sh
├── SKILL.md
├── package.json
└── test/
```

### Design Principles

1. **Single process, single database.** All modules write to `~/.pi/memory/memory.db`. No child process spawns for analysis (except `git` for churn, which is unavoidable).
2. **Memory-store.js is the dispatcher.** It `require()`s each module and routes subcommands. Each module exports functions that accept the shared `db` instance.
3. **Lazy initialization.** WASM parser initializes on first use (existing pattern). Module functions are stateless after init — they read/write through the shared DB handle.
4. **Graceful degradation.** Missing `git` → churn metrics disabled. Missing WASM grammars → code analysis disabled, doc indexing still works. Corrupted index → `reindex-repo` / `reindex-docs` rebuilds from source.

### Module Contracts

#### `code-analysis.js`

Exports functions that receive `db` and return JSON results:

```js
module.exports = {
  buildImportGraph(db, repoId),         // walk all code_files, extract import edges
  buildCallGraph(db, repoId),           // walk all code_symbols bodies, extract call edges
  buildComplexity(db, repoId),          // compute cyclomatic complexity for all symbols
  getImportGraph(db, repoId, opts),     // query: file-level dependency edges
  getCallHierarchy(db, repoId, opts),   // query: callers/callees with depth
  getBlastRadius(db, repoId, opts),     // query: transitive walk from symbol
  getDeadCode(db, repoId, opts),        // query: symbols with zero importers
  getComplexity(db, repoId, symbolId),  // query: cyclomatic complexity for one symbol
  getFileOutline(db, repoId, filePath), // query: all symbols in a file
};
```

#### `doc-indexer.js`

```js
module.exports = {
  indexDocs(db, rootPath, repoName),            // parse .md/.mdx files into sections
  searchDocs(db, repoId, query, opts),          // FTS5 search over doc sections
  getDocOutline(db, repoId, filePath),          // heading hierarchy tree
  getBacklinks(db, repoId, docPath),            // inbound references
  getBrokenLinks(db, repoId),                   // unresolved internal links
  lookupTerm(db, repoId, term),                 // glossary lookup
  getTutorialPath(db, repoId, sectionId),       // ordered section chain
  findCodeExamples(db, repoId, query, lang),    // fenced code block search
};
```

#### `git-analysis.js`

```js
module.exports = {
  getChurn(db, repoId, target, days),  // commits per file, unique authors, churn rate
  isGitAvailable(),                    // check if git CLI exists
};
```

## Schema Changes (v5)

All existing tables remain unchanged. New tables:

```sql
-- ═══════════════════════════════════════════════════════════
-- IMPORT EDGES  (file→file dependency graph)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS code_imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  source_file_id  INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  target_module   TEXT NOT NULL,           -- the import specifier (e.g. './utils', 'react')
  target_file_id  INTEGER REFERENCES code_files(id) ON DELETE SET NULL,  -- resolved, or NULL if external
  import_type     TEXT NOT NULL DEFAULT 'static',  -- 'static', 'dynamic', 're-export'
  line_number     INTEGER,
  UNIQUE(repo_id, source_file_id, target_module)
);
CREATE INDEX IF NOT EXISTS idx_ci_source ON code_imports(source_file_id);
CREATE INDEX IF NOT EXISTS idx_ci_target ON code_imports(target_file_id);
CREATE INDEX IF NOT EXISTS idx_ci_repo ON code_imports(repo_id);

-- ═══════════════════════════════════════════════════════════
-- CALL EDGES  (symbol→symbol call graph)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS code_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id           INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  caller_symbol_id  INTEGER NOT NULL REFERENCES code_symbols(id) ON DELETE CASCADE,
  callee_name       TEXT NOT NULL,          -- the name as it appears in the call
  callee_symbol_id  INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,  -- resolved, or NULL
  confidence        REAL NOT NULL DEFAULT 1.0,  -- 1.0=AST-confirmed, 0.7=name-heuristic
  line_number       INTEGER,
  UNIQUE(repo_id, caller_symbol_id, callee_name)
);
CREATE INDEX IF NOT EXISTS idx_cc_caller ON code_calls(caller_symbol_id);
CREATE INDEX IF NOT EXISTS idx_cc_callee_name ON code_calls(repo_id, callee_name);
CREATE INDEX IF NOT EXISTS idx_cc_callee ON code_calls(callee_symbol_id);

-- ═══════════════════════════════════════════════════════════
-- DOC REPOS  (doc indexing scope)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_repos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  path          TEXT NOT NULL UNIQUE,
  file_count    INTEGER DEFAULT 0,
  section_count INTEGER DEFAULT 0,
  indexed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- DOC FILES  (raw markdown content + mtime)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES doc_repos(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  mtime         REAL,
  UNIQUE(repo_id, path)
);

-- ═══════════════════════════════════════════════════════════
-- DOC SECTIONS  (heading-bounded sections with hierarchy)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES doc_repos(id) ON DELETE CASCADE,
  file_id       INTEGER NOT NULL REFERENCES doc_files(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  level         INTEGER NOT NULL,       -- heading level: 1=H1, 2=H2, etc.
  parent_id     INTEGER REFERENCES doc_sections(id) ON DELETE SET NULL,
  content       TEXT DEFAULT '',        -- section body (excluding heading and children)
  content_hash  TEXT NOT NULL,
  byte_start    INTEGER NOT NULL,
  byte_end      INTEGER NOT NULL,
  role          TEXT DEFAULT 'other',   -- concept, tutorial, how_to, reference, api, example, troubleshooting, changelog, faq, other
  tags          TEXT DEFAULT '',         -- comma-separated #hashtags extracted from content
  UNIQUE(repo_id, file_id, byte_start)
);
CREATE INDEX IF NOT EXISTS idx_ds_file ON doc_sections(file_id);
CREATE INDEX IF NOT EXISTS idx_ds_parent ON doc_sections(parent_id);
CREATE INDEX IF NOT EXISTS idx_ds_repo ON doc_sections(repo_id);
CREATE INDEX IF NOT EXISTS idx_ds_level ON doc_sections(level);

-- FTS5 for doc sections
CREATE VIRTUAL TABLE IF NOT EXISTS doc_sections_fts USING fts5(
  title,
  content,
  tags,
  content=doc_sections,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS ds_fts_insert AFTER INSERT ON doc_sections BEGIN
  INSERT INTO doc_sections_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS ds_fts_delete AFTER DELETE ON doc_sections BEGIN
  INSERT INTO doc_sections_fts(doc_sections_fts, rowid, title, content, tags)
  VALUES ('delete', old.id, old.title, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS ds_fts_update AFTER UPDATE ON doc_sections BEGIN
  INSERT INTO doc_sections_fts(doc_sections_fts, rowid, title, content, tags)
  VALUES ('delete', old.id, old.title, old.content, old.tags);
  INSERT INTO doc_sections_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;

-- ═══════════════════════════════════════════════════════════
-- DOC LINKS  (internal cross-references)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_links (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_section_id INTEGER NOT NULL REFERENCES doc_sections(id) ON DELETE CASCADE,
  target_path       TEXT NOT NULL,          -- the href as written
  target_section_id INTEGER REFERENCES doc_sections(id) ON DELETE SET NULL,  -- resolved, or NULL
  link_text         TEXT DEFAULT '',
  is_broken         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dl_source ON doc_links(source_section_id);
CREATE INDEX IF NOT EXISTS idx_dl_target ON doc_links(target_section_id);
CREATE INDEX IF NOT EXISTS idx_dl_broken ON doc_links(is_broken);

-- ═══════════════════════════════════════════════════════════
-- DOC GLOSSARY TERMS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_terms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES doc_repos(id) ON DELETE CASCADE,
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  section_id  INTEGER REFERENCES doc_sections(id) ON DELETE SET NULL,
  UNIQUE(repo_id, term)
);
CREATE INDEX IF NOT EXISTS idx_dt_term ON doc_terms(term);
CREATE INDEX IF NOT EXISTS idx_dt_repo ON doc_terms(repo_id);

-- ═══════════════════════════════════════════════════════════
-- CODE BLOCKS  (fenced code blocks in docs)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_code_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id  INTEGER NOT NULL REFERENCES doc_sections(id) ON DELETE CASCADE,
  lang        TEXT DEFAULT '',
  content     TEXT NOT NULL,
  byte_start  INTEGER NOT NULL,
  byte_end    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dcb_section ON doc_code_blocks(section_id);
CREATE INDEX IF NOT EXISTS idx_dcb_lang ON doc_code_blocks(lang);

-- ═══════════════════════════════════════════════════════════
-- CHURN METRICS  (git commit frequency per file)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS churn_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  commits       INTEGER NOT NULL DEFAULT 0,
  unique_authors INTEGER NOT NULL DEFAULT 0,
  first_seen    TEXT,
  last_modified TEXT,
  churn_per_week REAL DEFAULT 0.0,
  window_days   INTEGER NOT NULL DEFAULT 90,
  UNIQUE(repo_id, file_path, window_days)
);
CREATE INDEX IF NOT EXISTS idx_cm_repo ON churn_metrics(repo_id);

-- ═══════════════════════════════════════════════════════════
-- SYMBOL COMPLEXITY  (cyclomatic complexity per symbol)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS symbol_complexity (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id         INTEGER NOT NULL UNIQUE REFERENCES code_symbols(id) ON DELETE CASCADE,
  cyclomatic        INTEGER NOT NULL DEFAULT 1,
  nesting_depth     INTEGER NOT NULL DEFAULT 0,
  param_count       INTEGER NOT NULL DEFAULT 0,
  lines_of_code     INTEGER NOT NULL DEFAULT 0,
  assessment        TEXT NOT NULL DEFAULT 'low'  -- 'low' (1-4), 'medium' (5-10), 'high' (11+)
);
CREATE INDEX IF NOT EXISTS idx_sc_symbol ON symbol_complexity(symbol_id);
```

## Implementation Details

### Code Analysis: Import Graph (`code-analysis.js`)

**Extraction.** During `index-repo`, after symbols are extracted, walk each file's AST for import/require statements:

- **JS/TS static imports:** `import X from './path'`, `import { X } from 'pkg'`, `const X = require('./path')`
- **JS/TS dynamic imports:** `import('./path')`, `require('./path')` in expressions
- **Re-exports:** `export { X } from './path'`, `export * from './path'`

For each import, resolve `target_module`:
1. **Relative path** (`./`, `../`): resolve against source file's directory, check `code_files` for a match → set `target_file_id`
2. **Package import** (`react`, `fs`): `target_file_id` = NULL (external). The module name is stored as `target_module`, not resolved further.
3. **Path alias** (`@/utils`): check `tsconfig.json` paths if available, otherwise treat as unresolved.

**Query.** `getImportGraph` returns edges. Supports `--file` filter (edges from/to one file) and `--direction` (imports / importers / both). Depth param for transitive walks.

### Code Analysis: Call Graph (`code-analysis.js`)

**Extraction.** During `index-repo`, after symbols and imports are extracted, for each `code_symbol` re-parse its body (using byte range from `start_byte`/`end_byte` read from `code_files.content`) and extract identifier references:

1. **Method calls:** `obj.method()`, `func()` — extract the callee identifier
2. **Constructor calls:** `new ClassName()` — extract the class name
3. **Property access in calls:** `this.method()` — extract `method`

Walk the symbol body AST, collect all `call_expression` nodes, extract the function/method name from the callee.

**Resolution.** For each extracted `callee_name`:
1. Look up the `callee_name` in the importing file's `code_imports` — if the name was imported from a known file, search `code_symbols` in that target file → set `callee_symbol_id`, `confidence` = 1.0
2. If no import match, search `code_symbols` in the same repo for exact `name` match → prefer same-file, then same-repo → set `callee_symbol_id`, `confidence` = 0.7
3. If still unresolved, `callee_symbol_id` = NULL (could be external package, global, or built-in)

**Query.** `getCallHierarchy` supports `--direction callers|callees` and `--depth 1-5`. Uses recursive SQLite CTEs for traversal:

```sql
-- Callers (who calls this symbol?)
WITH RECURSIVE upstream AS (
  SELECT cc.caller_symbol_id, cs.name, cs.file_path, 1 as depth
  FROM code_calls cc
  JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
  WHERE cc.callee_symbol_id = ?
  UNION ALL
  SELECT cc.caller_symbol_id, cs.name, cs.file_path, u.depth + 1
  FROM code_calls cc
  JOIN upstream u ON cc.callee_symbol_id = u.caller_symbol_id
  JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
  WHERE u.depth < ?
)
SELECT * FROM upstream;

-- Callees (what does this symbol call?)
WITH RECURSIVE downstream AS (
  SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, 1 as depth
  FROM code_calls cc
  LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id
  WHERE cc.caller_symbol_id = ?
  UNION ALL
  SELECT cc.callee_name, cc.callee_symbol_id, cs.file_path, d.depth + 1
  FROM code_calls cc
  JOIN downstream d ON cc.caller_symbol_id = d.callee_symbol_id
  LEFT JOIN code_symbols cs ON cs.id = cc.callee_symbol_id
  WHERE d.depth < ?
)
SELECT * FROM downstream;
```

### Code Analysis: Blast Radius (`code-analysis.js`)

Combines import graph + call graph into a unified impact set. Given a symbol:
1. Find the file containing the symbol
2. Walk import graph forward (who imports this file?)
3. Walk call graph backward (who calls this symbol?)
4. Union the results, dedupe by file
5. Return grouped by depth (direct, 2-hop, 3-hop)

### Code Analysis: Dead Code (`code-analysis.js`)

Two detection signals combined:
1. **Import-reachability:** Start from known entry points (files never imported by anything) and walk the import graph. Unreachable files are dead.
2. **Call-reachability:** Symbols never referenced as a callee in any `code_calls` row are potentially dead.

Confidence scoring:
- 0.33 = one signal (e.g., no callers but file is imported)
- 0.67 = two signals (no callers AND file not imported)  
- 1.0 = provably unreachable (zero importers, file not an entry point, not re-exported)

Entry points: `main.js`, `index.js`, `index.ts`, `mod.ts`, files with `export default` at top level, files containing a shebang line (`#!/usr/bin/env node`), and files matching patterns in `package.json` `main`/`bin`/`exports` fields (if resolvable from the indexed repo root).

### Code Analysis: Complexity (`code-analysis.js`)

Cyclomatic complexity = 1 + count of decision points in the symbol body:
- `if`, `else if`, `for`, `while`, `do`, `case`, `catch`, `&&`, `||`, `??`, `?.`
- Ternary `? :`

**Extraction.** Re-parse the symbol's byte range via WASM tree-sitter. Walk the AST and count node types matching the decision set. Also compute:
- Nesting depth (max depth of block nesting)
- Parameter count (from the symbol's signature)
- Lines of code (end_line - start_line - blank/comment lines)

Stored in `symbol_complexity` table during `index-repo` or `reindex-repo`.

### Code Analysis: Churn (`git-analysis.js`)

Uses `git` CLI (not libgit2 — zero native dependencies):
- `git log --follow --format="%H|%an|%aI" -- <file>` — commit list per file
- `git log --since=<date> --oneline -- <file>` — recent commit count

`getChurn` computes:
- Total commits in window (default 90 days)
- Unique authors
- First seen / last modified dates
- `churn_per_week` = commits / (window_days / 7)

If `git` is unavailable, `isGitAvailable()` returns false and the `churn` subcommand returns an error message suggesting install.

Results are cached in `churn_metrics`. Add `--refresh` flag to force re-computation from git (otherwise cached results are returned if available).

### Code Analysis: File Outline (`code-analysis.js`)

Query existing `code_symbols` table filtered by file_path. Returns all symbols in the file with their signatures, lines, and complexity (via join to `symbol_complexity`). Grouped by kind (class → methods, standalone functions).

### Doc Indexing: Section Extraction (`doc-indexer.js`)

**Parser.** Custom regex-based markdown parser (no dependency). Handles:
- ATX headings (`# H1`, `## H2`, etc.) — level from `#` count
- Setext headings (underlined with `===` or `---`) — level 1 or 2
- YAML frontmatter (`---\nkey: value\n---`) — skipped, not a section
- Content between headings is the section body

**Hierarchy.** After extracting all sections from a file, build the parent tree:
- Walk headings in order. Track a stack of `(level, section_id)`.
- For each heading, pop the stack until the top has `level < current_level`. The top is the parent.
- Set `parent_id` accordingly.

**Role classification.** Simple heuristic from title/content:
- Title contains "tutorial\|getting started\|quickstart" → `tutorial`
- Title contains "api\|reference\|endpoint" → `api`
- Title contains "how to\|guide" → `how_to`
- Title contains "concept\|overview\|architecture" → `concept`
- Title contains "troubleshoot\|debug\|fix" → `troubleshooting`
- Title contains "changelog\|release\|history" → `changelog`
- Title contains "faq\|q&a" → `faq`
- Default → `other`

**Tag extraction.** Scan section content for `#hashtag` patterns (word characters after `#`, not ATX headings). Store comma-separated in `tags` column.

### Doc Indexing: Link Extraction (`doc-indexer.js`)

During `index-docs`, scan each section's content for:
- Inline links: `[text](url)`
- Reference links: `[text][ref]` and `[ref]: url`
- Auto-links: `<url>`

For each link:
1. **Internal link** (starts with `/`, `./`, `../`, or `#`): attempt to resolve against `doc_files` → set `target_section_id`
2. **External link** (starts with `http://`, `https://`, `mailto:`): skip (not tracked)
3. **Anchor-only** (`#heading`): resolve within same file

`is_broken` = 1 when `target_section_id` is NULL for an internal link.

**Backlinks.** Query `doc_links` where `target_section_id = ?` to find inbound references. Returns source section titles, file paths, and link text.

**Broken links.** Query `doc_links WHERE is_broken = 1` grouped by file.

### Doc Indexing: Glossary (`doc-indexer.js`)

Extract from two patterns:
1. **Bold-term definition:** `**Term** — definition text` or `**Term**: definition text`
2. **Definition list:** lines matching `Term\n  : definition`

Store in `doc_terms` with `term` (lowercased), `definition`, and `section_id`.

### Doc Indexing: Tutorial Path (`doc-indexer.js`)

Detect ordered section chains by three heuristics (tried in order):
1. **Frontmatter:** section has `next:` or `prev:` keys in YAML frontmatter
2. **Inline links:** section ends with `Next: [Title](link)` or `Previous: [Title](link)`
3. **Numeric prefix:** files named `01-intro.md`, `02-setup.md`, etc.

Returns ordered array of `{section_id, doc_path, title}`.

### Doc Indexing: Code Examples (`doc-indexer.js`)

During `index-docs`, scan each section for fenced code blocks:
- Opening fence: ` ```lang ` or ` ``` ` followed by optional info string
- Closing fence: ` ``` ` at the start of a line

Store in `doc_code_blocks` with `lang` (info string), `content` (block body), and byte offsets.

**Search.** LIKE query over `content` column of `doc_code_blocks` (no separate FTS5 table — code blocks are small enough for substring matching), filtered by `lang`. Returns section context + code snippet.

## New Subcommands

| Subcommand | Module | Description |
|---|---|---|
| `import-graph` | code-analysis | `--repo X [--file F] [--direction imports\|importers\|both] [--depth N]` |
| `call-hierarchy` | code-analysis | `--symbol S --repo X [--direction callers\|callees] [--depth N]` |
| `blast-radius` | code-analysis | `--symbol S --repo X [--depth N]` |
| `dead-code` | code-analysis | `--repo X [--min-confidence 0.5] [--include-tests]` |
| `complexity` | code-analysis | `--symbol S --repo X` or `--file F --repo X` |
| `outline` | code-analysis | `--file F --repo X` |
| `churn` | git-analysis | `--repo X [--file F\|--symbol S] [--days 90] [--refresh]` |
| `index-docs` | doc-indexer | `--path P --name X` |
| `reindex-docs` | doc-indexer | `--repo X [--mode full\|incremental]` |
| `doc-search` | doc-indexer | `--query Q --repo X [--level N] [--role TYPE]` |
| `doc-outline` | doc-indexer | `--repo X [--file F]` |
| `backlinks` | doc-indexer | `--repo X --path F` |
| `broken-links` | doc-indexer | `--repo X` |
| `glossary` | doc-indexer | `--term T --repo X` or `--repo X` (list all) |
| `tutorial-path` | doc-indexer | `--section S --repo X` |
| `code-examples` | doc-indexer | `--query Q --repo X [--lang X]` |

## Pi Extension Changes

Two new multiplexed tools added to `memory-layer/index.ts`:

### `memory-code`

```ts
pi.registerTool({
  name: "memory-code",
  label: "Code Analysis",
  description: "Analyze code structure: call hierarchies, dependency graphs, blast radius, dead code, complexity, churn, file outlines.",
  parameters: Type.Object({
    mode: Type.Union([Type.Literal("callers"), Type.Literal("callees"), Type.Literal("blast-radius"), Type.Literal("dead-code"), Type.Literal("complexity"), Type.Literal("deps"), Type.Literal("outline"), Type.Literal("churn")]),
    repo: Type.String({ description: "Repo name (from index-repo)" }),
    symbol: Type.Optional(Type.String({ description: "Symbol name (for call-hierarchy, blast-radius, complexity)" })),
    file: Type.Optional(Type.String({ description: "File path (for deps, outline, complexity)" })),
    direction: Type.Optional(Type.String({ description: "Graph direction: imports, importers, both (deps mode); callers, callees (call modes)" })),
    depth: Type.Optional(Type.Number({ description: "Traversal depth 1-5 (default 3)", default: 3 })),
    min_confidence: Type.Optional(Type.Number({ description: "Min confidence for dead-code (0-1, default 0.5)", default: 0.5 })),
    days: Type.Optional(Type.Number({ description: "Churn lookback window in days (default 90)", default: 90 })),
  }),
  async execute(_id, params, _signal, _onUpdate, _ctx) {
    // delegate to memory-store.js subcommand based on mode
  },
});
```

### `memory-doc`

```ts
pi.registerTool({
  name: "memory-doc",
  label: "Doc Index & Search",
  description: "Index and search documentation: sections, backlinks, broken links, glossary terms, tutorial paths, code examples.",
  parameters: Type.Object({
    mode: Type.Union([Type.Literal("search"), Type.Literal("outline"), Type.Literal("backlinks"), Type.Literal("broken-links"), Type.Literal("glossary"), Type.Literal("tutorial-path"), Type.Literal("code-examples")]),
    repo: Type.String({ description: "Repo name (from index-docs)" }),
    query: Type.Optional(Type.String({ description: "Search query (search, code-examples modes)" })),
    file: Type.Optional(Type.String({ description: "File path (outline, backlinks modes)" })),
    term: Type.Optional(Type.String({ description: "Glossary term (glossary mode)" })),
    section: Type.Optional(Type.String({ description: "Section ID (tutorial-path mode)" })),
    lang: Type.Optional(Type.String({ description: "Code language filter (code-examples mode)" })),
    level: Type.Optional(Type.Number({ description: "Heading level filter (search, outline modes)" })),
    role: Type.Optional(Type.String({ description: "Section role filter: concept, tutorial, how_to, reference, api, example, troubleshooting, faq" })),
  }),
  async execute(_id, params, _signal, _onUpdate, _ctx) {
    // delegate to memory-store.js subcommand based on mode
  },
});
```

## Indexing Pipeline

The `index-repo` command is extended to include import graph and call graph extraction:

1. **Walk files** (existing) → populate `code_files`
2. **Parse files** (existing, WASM) → populate `code_symbols`
3. **Extract imports** (new) → walk each file's AST for import statements → populate `code_imports`
4. **Extract calls** (new) → re-parse each symbol's body for call expressions → populate `code_calls`
5. **Compute complexity** (new) → count decision points per symbol → populate `symbol_complexity`
6. **Resolve cross-references** (new) → match import targets to files, call targets to symbols

The new `index-docs` command:

1. **Walk directory** for `.md` / `.mdx` files → populate `doc_files`
2. **Parse sections** (regex) → populate `doc_sections` with hierarchy
3. **Extract links** → populate `doc_links`
4. **Extract glossary terms** → populate `doc_terms`
5. **Extract code blocks** → populate `doc_code_blocks`
6. **Resolve links** → update `target_section_id` and `is_broken`

Both pipelines support **incremental re-index** via mtime comparison.

## Error Handling

| Condition | Behavior |
|---|---|
| WASM parser not initialized | `code-analysis` functions return error: "Parser not ready. Run index-repo first." |
| Git not found | `churn` returns error: "git not available. Install git for churn metrics." |
| Repo not indexed | All analysis commands return error with repo name and hint to run `index-repo` first |
| Partial import resolution | `target_file_id` / `callee_symbol_id` left as NULL; queries still work (just fewer edges) |
| Large repo (1000+ files) | Indexing may take 10-30s; `index-repo` and `index-docs` are explicit commands (not auto-run) |
| Malformed markdown | Parser skips to next heading; broken sections logged but don't halt indexing |
| Markdown with no headings | File indexed as single section with title = filename, level = 0 |

## Performance Estimates

| Operation | Estimated Time | Notes |
|---|---|---|
| `index-repo` (100 JS/TS files) | 2-5s | WASM in-process parsing + graph extraction |
| `index-docs` (50 markdown files) | 0.5-1s | Regex-based, no AST needed |
| `call-hierarchy` (depth 3) | 10-50ms | SQLite CTE traversal |
| `dead-code` (repo-wide) | 50-200ms | Set-complement query |
| `blast-radius` (depth 3) | 20-100ms | Union of import + call graph walks |
| `churn` (per file) | 100-500ms | git log subprocess |
| `doc-search` | 5-20ms | FTS5 |
| `broken-links` | 20-50ms | indexed query |

## Migration

Schema v4 → v5 migration is additive (new tables only, no existing table modifications):

```sql
-- Run on DB open if user_version < 5
-- (existing tables unchanged, new tables use CREATE IF NOT EXISTS)
PRAGMA user_version = 5;
```

No data loss. Existing `code_repos`, `code_files`, `code_symbols` data is preserved. Import/call graphs are computed on next `index-repo` or `reindex-repo`.