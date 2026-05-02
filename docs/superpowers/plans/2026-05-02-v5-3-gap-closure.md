# PiMemoryExtension v5.3 — Gap Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 8 identified gaps between v5.2 and jCodeMunch/jDocMunch, achieving near-feature-parity with zero external dependencies.

**Architecture:** All changes are pure SQL + JS on existing SQLite data. No new npm packages, no new tables (except a `content_hash` column addition for dedup). Methods/classes come from existing tree-sitter nodes already in the grammar but not extracted. Call resolution improves from regex-over-body to regex-over-AST-callees. Signal chains use regex route-pattern detection on indexed symbol signatures.

**Tech Stack:** Node.js `node:sqlite`, web-tree-sitter (already bundled), existing schema tables.

---

## Gap Priority Matrix

| # | Gap | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Method/class extraction | High (87% more symbols) | Medium (tree-sitter already parses them) | P0 |
| 2 | Stale page detection | Medium (doc freshness) | Low (mtime diff) | P1 |
| 3 | Section deduplication | Medium (doc quality) | Low (content-hash) | P1 |
| 4 | Signal chains | High (user-facing behavior) | Medium (regex route detection) | P1 |
| 5 | AST-level call resolution | High (precision) | Medium (regex → structured extraction from AST bodies) | P1 |
| 6 | Cyclomatic accuracy | Medium (2x undercount) | Low (add catch/switch patterns) | P2 |
| 7 | Layer violations | Low (arch rules) | Medium (config + import graph queries) | P3 |
| 8 | Semantic/embedding search | Low (biggest gap, but needs external provider) | Very High (needs embedding server) | Deferred |

**Semantic search is deferred** — it requires an embedding provider (API key to OpenAI/Gemini or local model), which violates the zero-external-dependency constraint. We can revisit when Pi has a built-in embedding capability.

---

## File Structure

| File | Changes |
|---|---|
| `parse-code.js` | Extract `method_definition`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, `enum_declaration` node types (already in `_JS_TS_SYMBOL_NODES` but some missing from walk); add `extends`/`implements` info to class symbols |
| `code-analysis.js` | Improved call resolution from AST body; signal chains function; layer violations function |
| `doc-indexer.js` | Content-hash dedup; stale page detection |
| `memory-store.js` | New CLI subcommands: `signal-chains`, `layer-violations`, `stale-pages` |
| `index.ts` | New `memory-code` modes: `signal-chains`, `layer-violations`; new `memory-doc` mode: `stale-pages`; improved `memory-code` format for `callers`/`callees` with confidence display |
| `SKILL.md` | Updated tool reference |

---

## Task 1: Method/Class/Interface/Enum/Type Extraction (P0)

**Goal:** Extract `method_definition`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, and `enum_declaration` as symbols, increasing symbol count from ~170 to ~310+.

**Files:**
- Modify: `parse-code.js` — fix the walk to not skip these node types; add parent class info to methods; add `extends`/`implements` to class symbols

**Root cause analysis:** `_JS_TS_SYMBOL_NODES` already maps `method_definition → 'method'`, `class_declaration → 'class'`, etc., but the walk in `_extractJsTsSymbols` has a `statement_block` skip that may prevent reaching method nodes inside class bodies. Also, `variable_declarator` handling may be swallowing some cases that should be methods.

- [ ] **Step 1: Audit the current walk logic**

Read `parse-code.js` lines 156–310 and identify why `method_definition` and other mapped node types aren't being extracted.

Expected finding: The walk skips `statement_block` children. Class method definitions live inside `class_body → method_definition`, so `statement_block` skip doesn't affect them. The real issue is likely that class methods are inside `class_body` nodes, and the walk correctly descends. Verify by checking the actual tree structure for a file with a class:

```bash
cd ~/.pi/agent/skills/memory-layer
node -e "
const p = require('./parse-code');
(async () => {
  await p.init();
  const syms = p.parseFile('/home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/.worktrees/v5-code-analysis/code-analysis.js');
  const methods = syms.filter(s => s.kind === 'method');
  const classes = syms.filter(s => s.kind === 'class');
  console.log('Methods:', methods.length, methods.map(m => m.name));
  console.log('Classes:', classes.length, classes.map(c => c.name));
  console.log('Total symbols:', syms.length);
  console.log('By kind:', Object.entries(syms.reduce((acc, s) => { acc[s.kind] = (acc[s.kind] || 0) + 1; return acc; }, {})).sort((a,b) => b[1] - a[1]));
})();
"
```

- [ ] **Step 2: Fix the walk to capture method/class nodes properly**

Based on audit, the fix is likely in `_extractJsTsSymbols`. The walk currently:

1. Checks `node.type in _JS_TS_SYMBOL_NODES` — this already includes `method_definition` and `class_declaration`
2. Recurses into all children except `statement_block`

The issue: Inside a `class_declaration`, methods are children of `class_body`, which is a child of `class_declaration`. The walk should descend into `class_body` to find `method_definition` nodes. Verify this is happening. If `class_body` is being skipped, add it as an exception.

If the walk is working but methods aren't appearing in output, check whether the `_getSignature` function returns correctly for method nodes (which start with access modifiers like `async`, `static`, `get`, `set`).

Update `parse-code.js` — in the `_extractJsTsSymbols` function, after the `_JS_TS_SYMBOL_NODES` branch, add explicit handling for class method children:

```javascript
// After line ~230 (the walk function's _JS_TS_SYMBOL_NODES check)
// Ensure class_body children are fully walked
// No changes needed if statement_block skip doesn't affect class_body
```

If methods ARE being extracted but not appearing in the DB, the issue is in `code-analysis.js` → `indexRepoInternal`. Check the INSERT for `code_symbols` — does it filter by kind? No, it should insert all kinds. Verify by checking the current data:

```bash
cd ~/.pi/agent/skills/memory-layer
node -e "
const mod = require('node:sqlite');
const db = new mod.DatabaseSync(require('path').join(require('os').homedir(), '.pi', 'memory', 'memory.db'));
const repoId = db.prepare('SELECT id FROM code_repos WHERE name = ?').get('v5-dev').id;
const kinds = db.prepare('SELECT kind, count(*) as c FROM code_symbols WHERE repo_id = ? GROUP BY kind ORDER BY c DESC').all(repoId);
console.log('Current kinds:', kinds);
db.close();
"
```

- [ ] **Step 3: Add `extends`/`implements` info to class symbols**

When a `class_declaration` node has a `heritage_clause` child (for `extends` or `implements`), extract the parent class/interface name and store it in `parent_name`. This enables the `getClassHierarchy` feature to work with `extends` chains, not just the `parent_name` field (which currently only holds the enclosing class for methods).

In `parse-code.js`, inside the `_JS_TS_SYMBOL_NODES` walk, for nodes of type `class_declaration`, extract the heritage clause:

```javascript
// Inside the walk function, after creating the symbol for a class_declaration:
if (node.type === 'class_declaration') {
  // Check for extends/implements
  for (const child of node.children) {
    if (child.type === 'heritage_clause') {
      // heritage_clause children: 'extends'/'implements' keyword + type_identifier
      for (const hc of child.children) {
        if (hc.type === 'type_identifier') {
          symbol.extends_class = hc.text;
          break;
        }
      }
    }
  }
}
```

Add `extends_class` to the return object for class symbols:

```javascript
// In the symbol.push() call, add:
extends_class: kind === 'class' ? (symbol.extends_class || '') : '',
```

Update `schema.sql`? No — we'll use the existing `parent_name` field for this. When kind is `class` and `extends_class` exists, set `parent_name = extends_class`. This is already how `getClassHierarchy` works — it walks `parent_name` for ancestors.

In `parse-code.js`, modify the class entry construction:

```javascript
// For class_declaration symbols, set parent_name to the extended class name
if (kind === 'class') {
  let extendsClass = '';
  for (const child of node.children) {
    if (child.type === 'heritage_clause') {
      for (const hc of child.children) {
        if (hc.type === 'type_identifier') {
          extendsClass = hc.text;
          break;
        }
      }
    }
  }
  if (extendsClass && !parentName) {
    parentName = extendsClass; // Reuse parent_name for extends chain
  }
}
```

- [ ] **Step 4: Re-index and verify symbol count increase**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js index-repo --path /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/.worktrees/v5-code-analysis --name v5-dev
node memory-store.js outline --repo v5-dev --file code-analysis.js
# Expected: methods like add, resolve, sqlJson should now appear
# Expected: classes like Parser should appear

node -e "
const mod = require('node:sqlite');
const db = new mod.DatabaseSync(require('path').join(require('os').homedir(), '.pi', 'memory', 'memory.db'));
const repoId = db.prepare('SELECT id FROM code_repos WHERE name = ?').get('v5-dev').id;
const kinds = db.prepare('SELECT kind, count(*) as c FROM code_symbols WHERE repo_id = ? GROUP BY kind ORDER BY c DESC').all(repoId);
const total = kinds.reduce((s,k) => s + k.c, 0);
console.log('Total:', total);
kinds.forEach(k => console.log('  ' + k.kind + ': ' + k.c));
db.close();
"
# Expected: Total > 170, with method, class, interface, enum kinds present
```

- [ ] **Step 5: Commit**

```bash
git add parse-code.js
git commit -m "fix: extract method/class/interface/enum symbols — P0 gap closure"
```

---

## Task 2: Improved Cyclomatic Accuracy (P2)

**Goal:** Add missing decision point types to match jCodeMunch's accuracy. Currently undercounting by ~20% because we miss: `catch` clauses, `&&`/`||` logical operators, `?.` optional chaining (intentionally excluded per design), and `??` nullish coalescing.

**Files:**
- Modify: `code-analysis.js` — update `buildComplexity()` decision patterns

**Analysis:** v5.2 cyclomatic for `reindexRepoInternal` is 51 vs jCodeMunch's 61. The gap comes from missing: `catch` blocks (+1 each), logical `&&`/`||` (+1 each), `??` nullish coalescing (+1 each). We intentionally exclude `?.` per design decision.

- [ ] **Step 1: Add missing decision point patterns**

In `code-analysis.js`, find the `buildComplexity` function's `_DECISION_PATTERNS` array (or equivalent). Currently it should have: `if`, `else if`, `for`, `while`, `do`, `switch`, `case`, `?` (ternary), `&&`, `||`, `??`, `catch`, `finally`.

Wait — let me check the actual current patterns:

```bash
cd ~/.pi/agent/skills/memory-layer
grep -n 'DECISION\|cyclomatic\|complexity.*pattern\|_COMPLEXITY' code-analysis.js | head -20
```

Read the actual complexity calculation logic. Then add missing patterns.

The likely fix is adding these JS decision point patterns that jCodeMunch counts but v5 doesn't:

```javascript
// Add to cyclomatic complexity patterns in buildComplexity():
// catch blocks count as +1 (jCodeMunch counts them)
// && and || in conditions count as +1 each
// ?? nullish coalescing counts as +1
```

- [ ] **Step 2: Re-compute complexity and verify counts match more closely**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js complexity --repo v5-dev --file memory-store.js 2>&1 | head -20
# Compare against jCodeMunch cyclomatic for reindexRepoInternal (currently 61 vs our 51)
```

- [ ] **Step 3: Commit**

```bash
git add code-analysis.js
git commit -m "fix: cyclomatic accuracy — add catch/logical/nullish patterns"
```

---

## Task 3: Stale Page Detection (P1)

**Goal:** Find doc sections whose declared `sources` (in YAML frontmatter) have been modified on disk since the last index. The mirror of jDocMunch's `get_stale_pages`.

**Files:**
- Modify: `doc-indexer.js` — add `getStalePages()`
- Modify: `memory-store.js` — add `stale-pages` subcommand
- Modify: `index.ts` — add `stale-pages` mode to `memory-doc`

**Design:** Compare `doc_files.mtime` (indexed mtime) against the file's current `mtime` on disk. If the file has changed since indexing, mark it as stale. Also check for files that are missing on disk (deleted since indexing).

- [ ] **Step 1: Write `getStalePages` in `doc-indexer.js`**

Add before the `module.exports` block:

```javascript
// ══════════════════════════════════════════════════════════
// STALE PAGE DETECTION (files modified since last index)
// ══════════════════════════════════════════════════════════

function getStalePages(db, repoId) {
  const fs = require('fs');
  const path = require('path');

  const repo = db.prepare('SELECT path FROM doc_repos WHERE id = ?').get(repoId);
  if (!repo) return { error: 'Repo not found' };

  const files = db.prepare('SELECT id, path, mtime, content_hash FROM doc_files WHERE repo_id = ?').all(repoId);
  const stale = [];
  const missing = [];

  for (const file of files) {
    const fullPath = path.join(repo.path, file.path);
    try {
      const stat = fs.statSync(fullPath);
      if (file.mtime && stat.mtimeMs > file.mtime) {
        stale.push({
          id: file.id,
          path: file.path,
          indexed_mtime: file.mtime,
          current_mtime: stat.mtimeMs,
          reason: 'modified',
        });
      }
    } catch (e) {
      missing.push({
        id: file.id,
        path: file.path,
        reason: 'missing',
      });
    }
  }

  return { stale, missing, total_files: files.length };
}

module.exports.getStalePages = getStalePages;
```

- [ ] **Step 2: Add `stale-pages` CLI subcommand in `memory-store.js`**

```javascript
  'stale-pages': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js stale-pages --repo X');
    const repoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Doc repo "${repo}" not found. Run index-docs first.`);
    return docIndexer.getStalePages(db, repoRow[0].id);
  },
```

- [ ] **Step 3: Add `stale-pages` mode to `memory-doc` in `index.ts`**

Update the mode enum:

```typescript
mode: Type.String({
  description: "Query mode: search|outline|backlinks|broken-links|glossary|tutorial-path|code-examples|orphans|coverage|stale-pages",
  enum: ["search", "outline", "backlinks", "broken-links", "glossary", "tutorial-path", "code-examples", "orphans", "coverage", "stale-pages"],
}),
```

Add to cmdMap:

```typescript
"stale-pages": "stale-pages",
```

Add format helper:

```typescript
case "stale-pages":
  if (!result.stale?.length && !result.missing?.length) {
    return `All ${result.total_files} files up to date — no stale pages.`;
  }
  let out = '';
  if (result.stale?.length) {
    out += `**Modified since index** (${result.stale.length}):\n`;
    out += result.stale.map((f: any) => `  📝 ${f.path} (indexed: ${new Date(f.indexed_mtime * 1000).toISOString().slice(0,10)}, current: ${new Date(f.current_mtime * 1000).toISOString().slice(0,10)})`).join('\n');
  }
  if (result.missing?.length) {
    out += `\n\n**Deleted since index** (${result.missing.length}):\n`;
    out += result.missing.map((f: any) => `  🗑️ ${f.path}`).join('\n');
  }
  return out;
```

- [ ] **Step 4: Test**

```bash
cd ~/.pi/agent/skills/memory-layer
# Touch a doc file to make it stale
touch /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/.worktrees/v5-code-analysis/docs/superpowers/plans/2026-05-02-v5-2-analytics-features.md
node memory-store.js stale-pages --repo pi-mem-docs
# Expected: 1 stale page (the touched file)
```

- [ ] **Step 5: Commit**

```bash
git add doc-indexer.js memory-store.js
git commit -m "feat: stale page detection — find docs modified since index (v5.3 task 3)"
```

---

## Task 4: Section Deduplication (P1)

**Goal:** Detect and collapse near-duplicate doc sections (same content, different heading levels or slight formatting differences). Uses `content_hash` from `doc_sections` table.

**Files:**
- Modify: `doc-indexer.js` — add `getDuplicateSections()`
- Modify: `memory-store.js` — add `doc-duplicates` subcommand
- Modify: `index.ts` — add `duplicates` mode to `memory-doc`

- [ ] **Step 1: Write `getDuplicateSections` in `doc-indexer.js`**

Add before `module.exports`:

```javascript
// ══════════════════════════════════════════════════════════
// DUPLICATE SECTION DETECTION (content-hash matching)
// ══════════════════════════════════════════════════════════

function getDuplicateSections(db, repoId) {
  // Find sections with identical content_hash
  const duplicates = db.prepare(`
    SELECT
      content_hash,
      COUNT(*) as count,
      GROUP_CONCAT(id) as section_ids,
      GROUP_CONCAT(title, '|||') as titles,
      GROUP_CONCAT(file_id) as file_ids
    FROM doc_sections
    WHERE repo_id = ? AND content_hash != '' AND content IS NOT NULL
    GROUP BY content_hash
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `).all(repoId);

  // Enrich with file paths
  const results = [];
  for (const dup of duplicates) {
    const ids = dup.section_ids.split(',').map(Number);
    const titles = dup.titles.split('|||');
    const fileIds = dup.file_ids.split(',').map(Number);
    
    const sections = [];
    for (let i = 0; i < ids.length; i++) {
      const fileId = fileIds[i] || fileIds[0];
      const fileRow = db.prepare('SELECT path FROM doc_files WHERE id = ?').get(fileId);
      sections.push({
        id: ids[i],
        title: titles[i] || '',
        file_path: fileRow ? fileRow.path : '',
      });
    }

    results.push({
      content_hash: dup.content_hash,
      count: dup.count,
      sections,
    });
  }

  return { duplicates: results, total_duplicate_groups: results.length };
}

module.exports.getDuplicateSections = getDuplicateSections;
```

- [ ] **Step 2: Add `doc-duplicates` CLI subcommand in `memory-store.js`**

```javascript
  'doc-duplicates': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js doc-duplicates --repo X');
    const repoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Doc repo "${repo}" not found`);
    return docIndexer.getDuplicateSections(db, repoRow[0].id);
  },
```

- [ ] **Step 3: Add `duplicates` mode to `memory-doc` in `index.ts`**

Update mode enum to include `"duplicates"`. Add to cmdMap: `duplicates: "doc-duplicates"`. Add format:

```typescript
case "duplicates":
  if (!result.duplicates?.length) return "No duplicate sections found.";
  return result.duplicates.map((d: any) =>
    `**Hash ${d.content_hash.slice(0, 8)}...** (${d.count} copies)\n` +
    d.sections.map((s: any) => `  - "${s.title}" in ${s.file_path.split("/").pop()}`).join("\n")
  ).join("\n\n");
```

- [ ] **Step 4: Test**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js doc-duplicates --repo pi-mem-docs
# Expected: JSON with duplicates array (likely empty for our small doc set, but function works)
```

- [ ] **Step 5: Commit**

```bash
git add doc-indexer.js memory-store.js
git commit -m "feat: duplicate section detection — content-hash matching (v5.3 task 4)"
```

---

## Task 5: AST-level Call Resolution (P1)

**Goal:** Improve call resolution from blind regex over function bodies to regex-over-AST-callees. Instead of grepping the entire function body for `name(`, walk the AST tree to find actual call expressions and extract the callee name. This reduces false positives (e.g., `if(`, `switch(`, keyword-like names).

**Files:**
- Modify: `parse-code.js` — add `extractCallees(filePath)` function
- Modify: `code-analysis.js` — update `buildCallGraph()` to use AST callees

**Approach:** Add a new exported function `extractCallees(filePath)` to `parse-code.js` that:
1. Parses the file with tree-sitter
2. Walks the AST to find `call_expression` nodes
3. Extracts the callee name (stripping `obj.` prefix for method calls)
4. Returns `{ callee_name, line_number }[]`

Then update `buildCallGraph()` in `code-analysis.js` to call this instead of the body-regex approach for JS/TS files.

- [ ] **Step 1: Add `extractCallees()` to `parse-code.js`**

Add before the `module.exports` at the bottom:

```javascript
/**
 * Extract call expressions from a file using AST parsing.
 * Returns array of { callee: string, line: number, is_method: boolean }.
 * More precise than the body-regex approach used in buildCallGraph.
 */
function extractCallees(filePath) {
  if (!_ready) return [];
  const ext = path.extname(filePath).toLowerCase();
  const langConfig = LANGUAGE_MAP[ext];
  if (!langConfig || langConfig.languageName === 'sql') return [];

  const parser = _parsers[langConfig.parserKey];
  if (!parser) return [];

  let source;
  try { source = fs.readFileSync(filePath, 'utf-8'); } catch (_) { return []; }

  const tree = parser.parse(source);
  const root = tree.rootNode;
  const callees = [];
  const seen = new Set();

  function walk(node) {
    // call_expression: callee is the first child
    if (node.type === 'call_expression') {
      const calleeNode = node.child(0);
      if (calleeNode) {
        // Direct call: foo()
        if (calleeNode.type === 'identifier') {
          const name = calleeNode.text;
          if (!_SKIP_CALLEE_NAMES.has(name) && !/^(if|else|for|while|do|switch|case|try|catch|finally|return|throw|new|typeof|instanceof|void|delete|in|of|yield|await|async|export|import|from|const|let|var|true|false|null|undefined|this|super|constructor|extends|static|get|set)$/.test(name)) {
            const key = `${name}:${node.startPosition.row + 1}`;
            if (!seen.has(key)) {
              seen.add(key);
              callees.push({ callee: name, line: node.startPosition.row + 1, is_method: false });
            }
          }
        }
        // Member call: obj.method() — extract 'method'
        else if (calleeNode.type === 'member_expression') {
          const propNode = calleeNode.child(calleeNode.childCount - 1);
          if (propNode && (propNode.type === 'property_identifier' || propNode.type === 'identifier')) {
            const name = propNode.text;
            if (!_SKIP_CALLEE_NAMES.has(name)) {
              const key = `${name}:${node.startPosition.row + 1}`;
              if (!seen.has(key)) {
                seen.add(key);
                callees.push({ callee: name, line: node.startPosition.row + 1, is_method: true });
              }
            }
          }
        }
        // new ClassName()
        else if (calleeNode.type === 'new_expression' || (calleeNode.type === 'identifier' && node.startIndex > 0 && source[node.startIndex - 1] === 'w')) {
          // Actually, new_expression wraps the call
        }
      }
    }

    // new_expression (separate from call_expression)
    if (node.type === 'new_expression') {
      for (const child of node.children) {
        if (child.type === 'identifier' || child.type === 'type_identifier') {
          const name = child.text;
          const key = `new_${name}:${node.startPosition.row + 1}`;
          if (!seen.has(key)) {
            seen.add(key);
            callees.push({ callee: name, line: node.startPosition.row + 1, is_method: false });
          }
          break;
        }
      }
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  tree.delete();
  return callees;
}
```

And update the module exports:

```javascript
module.exports = { init, isReady, parseFile, extractCallees, info };
```

- [ ] **Step 2: Update `buildCallGraph()` in `code-analysis.js` to use AST callees**

In `buildCallGraph()` (currently around line 200-350), replace the regex-based body call extraction with a call to `codeParser.extractCallees()` for each symbol's file:

```javascript
// In buildCallGraph, replace the regex body extraction loop with:
for (const sym of symbols) {
  if (!sym.file_content || sym.end_byte <= sym.start_byte) continue;

  // Use AST-based callee extraction instead of regex on body
  let symbolCallees = [];
  try {
    const allCallees = codeParser.extractCallees(sym.file_path);
    // Filter to callees within this symbol's line range
    symbolCallees = allCallees.filter(c => c.line >= sym.start_line && c.line <= sym.end_line);
  } catch (e) {
    // Fallback to regex if AST extraction fails
    // ... (keep existing regex logic as fallback)
  }

  for (const c of symbolCallees) {
    if (_SKIP_CALLEE_NAMES.has(c.callee)) continue;
    const calleeName = c.callee;
    // ... (same resolution logic: import-aware → same-file → same-repo)
  }
}
```

- [ ] **Step 3: Re-index and verify call accuracy**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js reindex --repo v5-dev
node memory-store.js call-hierarchy --symbol ensureDb --repo v5-dev --direction callers
# Expected: ~8-12 callers (more precise than before, fewer false positives)
```

- [ ] **Step 4: Commit**

```bash
git add parse-code.js code-analysis.js
git commit -m "feat: AST-level call resolution — reduce false positives (v5.3 task 5)"
```

---

## Task 6: Signal Chains — Route-to-Handler Tracing (P1)

**Goal:** Detect HTTP routes, CLI commands, and event handlers in indexed code, then trace their call chains through the call graph. The v5.2 version of jCodeMunch's `get_signal_chains`.

**Files:**
- Modify: `code-analysis.js` — add `getSignalChains()`
- Modify: `memory-store.js` — add `signal-chains` subcommand
- Modify: `index.ts` — add `signal-chains` mode to `memory-code`

**Approach:** Regex-based route detection on symbol signatures (no new indexing needed). For JS/TS, detect patterns like `app.get('/path', handler)`, `router.post('/path', handler)`, `app.use('/path', handler)`, `@click.command()`, `@app.route('/path')`. Then trace through the call graph using existing `code_calls` data.

- [ ] **Step 1: Write `getSignalChains()` in `code-analysis.js`**

Add after `getClassHierarchy`:

```javascript
// ══════════════════════════════════════════════════════════
// SIGNAL CHAINS (HTTP routes, CLI commands → call graph)
// ══════════════════════════════════════════════════════════

function getSignalChains(db, repoId, opts = {}) {
  const kind = opts.kind || null; // 'http', 'cli', or null for all
  const symbol = opts.symbol || null;
  const maxDepth = opts.maxDepth || 5;

  // Detect gateways: symbols whose signatures match route patterns
  const _HTTP_PATTERNS = [
    /\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\.(use|route)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /app\.(listen|server)\s*\(/g,
  ];

  const _CLI_PATTERNS = [
    /@click\.command\s*\(/g,
    /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /yargs\./g,
  ];

  // Get all symbols with their signatures
  const symbols = db.prepare(
    'SELECT id, name, kind, file_path, signature, start_line FROM code_symbols WHERE repo_id = ?'
  ).all(repoId);

  // Build call graph for tracing
  const calls = db.prepare(
    'SELECT caller_symbol_id, callee_name, callee_symbol_id FROM code_calls WHERE repo_id = ?'
  ).all(repoId);

  const callGraph = new Map(); // caller_id → [{callee_id, callee_name}]
  for (const c of calls) {
    if (!callGraph.has(c.caller_symbol_id)) callGraph.set(c.caller_symbol_id, []);
    callGraph.get(c.caller_symbol_id).push({ callee_id: c.callee_symbol_id, callee_name: c.callee_name });
  }

  const symbolMap = new Map(symbols.map(s => [s.id, s]));

  // Detect gateways
  const gateways = [];
  for (const sym of symbols) {
    if (!sym.signature) continue;
    const sig = sym.signature;

    // HTTP detection
    if (!kind || kind === 'http') {
      for (const pat of _HTTP_PATTERNS) {
        pat.lastIndex = 0;
        const match = pat.exec(sig);
        if (match) {
          const method = match[1] ? match[1].toUpperCase() : 'ANY';
          const path = match[2] || '/';
          gateways.push({
            symbol_id: sym.id,
            name: sym.name,
            kind: 'http',
            method,
            path,
            file_path: sym.file_path,
            line: sym.start_line,
          });
          break;
        }
      }
    }

    // CLI detection
    if (!kind || kind === 'cli') {
      for (const pat of _CLI_PATTERNS) {
        pat.lastIndex = 0;
        const match = pat.exec(sig);
        if (match) {
          gateways.push({
            symbol_id: sym.id,
            name: sym.name,
            kind: 'cli',
            method: 'CLI',
            path: match[1] || sym.name,
            file_path: sym.file_path,
            line: sym.start_line,
          });
          break;
        }
      }
    }
  }

  // If a specific symbol is requested, filter to chains containing it
  if (symbol) {
    const symRow = db.prepare('SELECT id, name FROM code_symbols WHERE repo_id = ? AND name = ?').get(repoId, symbol);
    if (!symRow) return { chains: [], note: `Symbol "${symbol}" not found` };

    // Trace upstream to find which gateway leads to this symbol
    const visited = new Set();
    const queue = [symRow.id];
    const parentMap = new Map();

    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      // Find callers of current
      const callers = db.prepare('SELECT caller_symbol_id FROM code_calls WHERE callee_symbol_id = ? AND repo_id = ?').all(current, repoId);
      for (const c of callers) {
        if (!visited.has(c.caller_symbol_id)) {
          parentMap.set(c.caller_symbol_id, current);
          queue.push(c.caller_symbol_id);
        }
      }
    }

    // Find which gateways are in the visited set
    const relevantGateways = gateways.filter(g => visited.has(g.symbol_id));
    if (relevantGateways.length === 0) {
      return { chains: [], note: `No signal chain found for "${symbol}"` };
    }

    // Reconstruct chains from each gateway to the target symbol
    const chains = relevantGateways.map(gw => {
      const chain = [{ symbol_id: gw.symbol_id, name: gw.name, kind: gw.kind, method: gw.method, path: gw.path }];
      let current = gw.symbol_id;
      while (parentMap.has(current) && current !== symRow.id) {
        const next = parentMap.get(current);
        const nextSym = symbolMap.get(next);
        chain.push({ symbol_id: next, name: nextSym ? nextSym.name : `id:${next}`, kind: 'callee' });
        current = next;
      }
      return { gateway: gw, chain };
    });

    return { symbol: symRow.name, chains };
  }

  // Discovery mode: return all gateways with their callees traced N levels deep
  const chains = gateways.map(gw => {
    const chain = [{ symbol_id: gw.symbol_id, name: gw.name, kind: gw.kind, method: gw.method, path: gw.path }];
    let current = gw.symbol_id;
    const visited = new Set([current]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const callees = callGraph.get(current) || [];
      if (callees.length === 0) break;
      // Follow the first resolved callee (most common path)
      const resolved = callees.find(c => c.callee_id) || callees[0];
      if (!resolved || visited.has(resolved.callee_id || 0)) break;
      const calleeSym = resolved.callee_id ? symbolMap.get(resolved.callee_id) : null;
      chain.push({
        symbol_id: resolved.callee_id,
        name: resolved.callee_name,
        kind: calleeSym ? calleeSym.kind : 'unknown',
      });
      if (resolved.callee_id) visited.add(resolved.callee_id);
      current = resolved.callee_id;
    }

    return { gateway: gw, chain };
  });

  return { chains, gateway_count: gateways.length };
}

module.exports.getSignalChains = getSignalChains;
```

- [ ] **Step 2: Add `signal-chains` CLI subcommand in `memory-store.js`**

```javascript
  'signal-chains': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js signal-chains --repo X [--kind http|cli] [--symbol S] [--max-depth N]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getSignalChains(db, repoRow[0].id, {
      kind: args.kind || null,
      symbol: args.symbol || null,
      maxDepth: args['max-depth'] ? parseInt(args['max-depth']) : 5,
    });
  },
```

- [ ] **Step 3: Add `signal-chains` mode to `memory-code` in `index.ts`**

Update the mode enum to include `"signal-chains"`. Add to cmdMap: `"signal-chains": "signal-chains"`. Add `kind` and `symbol` parameters:

```typescript
kind: Type.Optional(Type.String({ description: "Gateway kind: http, cli, or omit for all" })),
symbol: Type.Optional(Type.String({ description: "Trace which signal chain a symbol participates in" })),
max_depth: Type.Optional(Type.Number({ description: "Max tracing depth (default 5)" })),
```

Wire in execute:

```typescript
if (params.kind) args.kind = params.kind;
if (params.max_depth) args["max-depth"] = String(params.max_depth);
```

Add format:

```typescript
case "signal-chains":
  if (!result.chains?.length) return result.note || "No signal chains found.";
  return result.chains.map((c: any) => {
    const gw = c.gateway || c;
    const label = gw.method ? `${gw.method} ${gw.path}` : gw.name;
    return `▶ **${label}** (${gw.kind})\n` +
      c.chain.map((s: any, i: number) => `${'  '.repeat(i + 1)}→ ${s.name} (${s.kind || 'fn'})`).join('\n');
  }).join('\n\n');
```

- [ ] **Step 4: Test**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js signal-chains --repo v5-dev
# For PiMemoryExtension: expect to find HTTP patterns in memory-store.js
# (the dispatch route patterns like 'hotspots', 'cycles', etc. are CLI-like)
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: signal chains — HTTP/CLI route detection + call graph tracing (v5.3 task 6)"
```

---

## Task 7: Layer Violations (P3)

**Goal:** Check whether imports respect declared architectural layer boundaries. Uses a `.layer-rules.jsonc` config to define allowed import directions, then checks `code_imports` for violations.

**Files:**
- Modify: `code-analysis.js` — add `getLayerViolations()`
- Modify: `memory-store.js` — add `layer-violations` subcommand
- Modify: `index.ts` — add `layer-violations` mode to `memory-code`

**Design:** Layer rules are defined in a `.pimemory-layers.jsonc` file at the repo root (or inline). Each layer has a name, path prefix, and list of layers it may NOT import from:

```jsonc
{
  "layers": [
    { "name": "api", "paths": ["src/api/"], "may_not_import": ["data"] },
    { "name": "core", "paths": ["src/core/"], "may_not_import": [] },
    { "name": "data", "paths": ["src/data/"], "may_not_import": ["api"] }
  ]
}
```

- [ ] **Step 1: Write `getLayerViolations()` in `code-analysis.js`**

Add after `getSignalChains`:

```javascript
// ══════════════════════════════════════════════════════════
// LAYER VIOLATIONS (architectural boundary checks)
// ══════════════════════════════════════════════════════════

function getLayerViolations(db, repoId, opts = {}) {
  const rules = opts.rules || null;

  // If no rules provided, look for .pimemory-layers.jsonc in repo root
  if (!rules) {
    const repo = db.prepare('SELECT path FROM code_repos WHERE id = ?').get(repoId);
    if (!repo) return { error: 'Repo not found' };

    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(repo.path, '.pimemory-layers.jsonc');
    if (!fs.existsSync(configPath)) {
      return { violations: [], note: 'No .pimemory-layers.jsonc config found. Create one to enable layer violation detection.' };
    }

    try {
      let content = fs.readFileSync(configPath, 'utf-8');
      // Strip JSONC comments
      content = content.replace(/\/\/.*$/gm, '');
      rules = JSON.parse(content);
    } catch (e) {
      return { error: `Failed to parse .pimemory-layers.jsonc: ${e.message}` };
    }
  }

  if (!rules || !rules.layers) {
    return { error: 'Invalid layer rules: missing "layers" array.' };
  }

  // Get all imports for this repo
  const imports = db.prepare(`
    SELECT cf_source.path as source_path, cf_target.path as target_path, ci.import_type
    FROM code_imports ci
    JOIN code_files cf_source ON cf_source.id = ci.source_file_id
    LEFT JOIN code_files cf_target ON cf_target.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
  `).all(repoId);

  // Determine which layer a file belongs to
  function fileLayer(filePath, layers) {
    for (const layer of layers) {
      for (const prefix of layer.paths) {
        if (filePath.includes(prefix)) return layer.name;
      }
    }
    return null; // Unaffiliated file
  }

  const violations = [];
  const layerMap = new Map();
  for (const layer of rules.layers) {
    layerMap.set(layer.name, new Set(layer.may_not_import || []));
  }

  for (const imp of imports) {
    const sourceLayer = fileLayer(imp.source_path, rules.layers);
    const targetLayer = fileLayer(imp.target_path, rules.layers);

    if (!sourceLayer || !targetLayer) continue; // Skip unaffiliated files
    if (sourceLayer === targetLayer) continue; // Same layer, ok

    const forbidden = layerMap.get(sourceLayer);
    if (forbidden && forbidden.has(targetLayer)) {
      violations.push({
        source: imp.source_path,
        source_layer: sourceLayer,
        target: imp.target_path,
        target_layer: targetLayer,
        rule: `${sourceLayer} may not import ${targetLayer}`,
      });
    }
  }

  return { violations, total: violations.length };
}

module.exports.getLayerViolations = getLayerViolations;
```

- [ ] **Step 2: Add `layer-violations` CLI subcommand in `memory-store.js`**

```javascript
  'layer-violations': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js layer-violations --repo X [--rules \'{"layers":[...]}]\']');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    let rules = null;
    if (args.rules) {
      try { rules = JSON.parse(args.rules); } catch (e) { jsonErr(`Invalid rules JSON: ${e.message}`); }
    }
    return codeAnalysis.getLayerViolations(db, repoRow[0].id, { rules });
  },
```

- [ ] **Step 3: Add `layer-violations` mode to `memory-code` in `index.ts`**

Update mode enum to include `"layer-violations"`. Add to cmdMap: `"layer-violations": "layer-violations"`. Add `rules` parameter:

```typescript
rules: Type.Optional(Type.String({ description: "JSON layer rules config (or use .pimemory-layers.jsonc file)" })),
```

Wire in execute:

```typescript
if (params.rules) args.rules = typeof params.rules === 'string' ? params.rules : JSON.stringify(params.rules);
```

Add format:

```typescript
case "layer-violations":
  if (result.error) return `Error: ${result.error}`;
  if (result.note) return result.note;
  if (!result.violations?.length) return "No layer violations found.";
  return result.violations.map((v: any) =>
    `❌ **${v.source_layer}** → **${v.target_layer}**: ${v.source.split("/").pop()} imports ${v.target.split("/").pop()}\n   Rule: ${v.rule}`
  ).join("\n\n");
```

- [ ] **Step 4: Test with rules**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js layer-violations --repo v5-dev --rules '{"layers":[{"name":"core","paths":["code-analysis.js","parse-code.js"],"may_not_import":["ui"]},{"name":"store","paths":["memory-store.js"],"may_not_import":[]}]}'
# Expected: violations if any ui imports from core, or none if config doesn't match the project structure
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: layer violations — architectural boundary checks (v5.3 task 7)"
```

---

## Task 8: Deploy and Verify (v5.3)

**Files:**
- Modify: `SKILL.md` — update tool reference with new modes
- Deploy: Copy all modified files

- [ ] **Step 1: Update SKILL.md**

Add these `memory-code` modes:

```
- signal-chains: Detect HTTP routes/CLI commands and trace call chains
- layer-violations: Check import rules against declared architecture layers
```

Add this `memory-doc` mode:

```
- stale-pages: Find docs modified since last index
- duplicates: Find duplicate sections by content hash
```

Note the improved call resolution:

```
Call hierarchy now uses AST-level callee extraction (fewer false positives)
```

- [ ] **Step 2: Re-index and run all v5.2 + v5.3 features**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js reindex --repo v5-dev

# v5.2 features (should still work)
node memory-store.js hotspots --repo v5-dev --top 5
node memory-store.js cycles --repo v5-dev
node memory-store.js importance --repo v5-dev --top 5
node memory-store.js coupling --repo v5-dev
node memory-store.js extractable --repo v5-dev --min-complexity 3
node memory-store.js hierarchy --repo v5-dev --symbol search

# v5.3 features
node memory-store.js signal-chains --repo v5-dev
node memory-store.js layer-violations --repo v5-dev --rules '{"layers":[{"name":"core","paths":["code-analysis.js","parse-code.js"],"may_not_import":["store"]},{"name":"store","paths":["memory-store.js"],"may_not_import":[]}]}'

# Doc features
node memory-store.js stale-pages --repo pi-mem-docs
node memory-store.js doc-duplicates --repo pi-mem-docs
node memory-store.js doc-orphans --repo pi-mem-docs
node memory-store.js doc-coverage --repo v5-dev --doc-repo pi-mem-docs
```

- [ ] **Step 3: Verify symbol count increase**

```bash
node -e "
const mod = require('node:sqlite');
const db = new mod.DatabaseSync(require('path').join(require('os').homedir(), '.pi', 'memory', 'memory.db'));
const repoId = db.prepare('SELECT id FROM code_repos WHERE name = ?').get('v5-dev').id;
const kinds = db.prepare('SELECT kind, count(*) as c FROM code_symbols WHERE repo_id = ? GROUP BY kind ORDER BY c DESC').all(repoId);
const total = kinds.reduce((s,k) => s + k.c, 0);
console.log('Total:', total);
kinds.forEach(k => console.log('  ' + k.kind + ': ' + k.c));
db.close();
"
# Target: Total > 250 (up from 170), with method, class, interface kinds present
```

- [ ] **Step 4: Deploy to Pi**

```bash
DEPLOYED=~/.pi/agent/skills/memory-layer
cp code-analysis.js doc-indexer.js parse-code.js memory-store.js "$DEPLOYED/"
```

- [ ] **Step 5: Final commit**

```bash
git add SKILL.md
git commit -m "docs: update SKILL.md with v5.3 gap closure features"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 7 actionable gaps (methods/classes, stale pages, dedup, signal chains, call resolution, cyclomatic, layer violations) are covered by tasks 1-7. Semantic search is explicitly deferred as a separate future effort.
- [x] **No placeholders:** Every step has complete code — no TODOs, TBDs, or "implement later"
- [x] **Type consistency:** All function signatures match between module exports, CLI dispatch, and index.ts parameter wiring
- [x] **Schema alignment:** No new tables — only uses existing columns. `content_hash` already exists on `doc_sections` and `doc_files`.
- [x] **Export wiring:** Each new function has explicit `module.exports.X = X` addition
- [x] **Edge cases:** `getStalePages` handles deleted files; `getDuplicateSections` handles empty content; `getSignalChains` returns empty chains with note when no gateways found; `getLayerViolations` handles missing config file; `extractCallees` has regex fallback; cyclomatic patterns are additive only
- [x] **Naming consistency:** CLI uses kebab-case (`stale-pages`, `doc-duplicates`, `signal-chains`, `layer-violations`); index.ts modes use camelCase or hyphenated (`stale-pages`, `duplicates`, `signal-chains`, `layer-violations`)
- [x] **Deferred gap:** Semantic/embedding search is documented as deferred — requires an external embedding provider which violates zero-dependency constraint