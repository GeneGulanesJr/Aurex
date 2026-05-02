# PiMemoryExtension v5.2 — Tier 1 Analytics Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 zero-dependency analytics features that use existing SQLite data — hotspots, dependency cycles, PageRank importance, coupling metrics, extraction candidates, orphan doc sections, and doc coverage.

**Architecture:** Each feature is a pure SQL + JS function in `code-analysis.js` or `doc-indexer.js`. No new tables, no new indexing, no new dependencies. Each gets a CLI subcommand in `memory-store.js` and a mode in the `memory-code`/`memory-doc` Pi extension tools.

**Tech Stack:** Node.js, SQLite (node:sqlite), existing schema tables (`code_symbols`, `code_imports`, `code_calls`, `symbol_complexity`, `churn_metrics`, `doc_sections`, `doc_links`, `doc_terms`)

---

## File Structure

| File | Responsibility |
|---|---|
| `code-analysis.js` | 7 new exported functions: `getHotspots`, `getDependencyCycles`, `getSymbolImportance`, `getCouplingMetrics`, `getExtractionCandidates`, plus existing 6 functions |
| `doc-indexer.js` | 2 new exported functions: `getOrphanSections`, `getDocCoverage`, plus existing functions |
| `memory-store.js` | 9 new CLI subcommands in the dispatch table |
| `index.ts` | 6 new modes in `memory-code` tool enum, 2 new modes in `memory-doc` tool enum, 8 new format helpers |
| `SKILL.md` | Update tool reference with new modes |

No schema changes. No new tables. All features are SQL queries over existing data.

---

## Task 1: Hotspots (`memory-code hotspots`)

**Files:**
- Modify: `code-analysis.js` — add `getHotspots()`
- Modify: `memory-store.js` — add `hotspots` subcommand
- Modify: `index.ts` — add `hotspots` mode to `memory-code`

Hotspot score = `cyclomatic × log(1 + churn_commits_in_window)`. Returns top-N symbols ranked by risk.

### Step-by-step

- [ ] **Step 1: Write the `getHotspots` function in `code-analysis.js`**

Add after the existing `getComplexity` function (around line 450):

```javascript
// ══════════════════════════════════════════════════════════
// HOTSPOTS (complexity × churn)
// ══════════════════════════════════════════════════════════

function getHotspots(db, repoId, opts = {}) {
  const topN = opts.top || 20;
  const days = opts.days || 90;

  // Ensure churn data exists for this repo
  const churnCount = db.prepare('SELECT count(*) as c FROM churn_metrics WHERE repo_id = ? AND window_days = ?').get(repoId, days);
  if (!churnCount || churnCount.c === 0) {
    return { hotspots: [], note: 'No churn data. Run `churn --repo X` first to populate git history metrics.' };
  }

  const rows = db.prepare(`
    SELECT
      cs.name,
      cs.kind,
      cs.file_path,
      sc.cyclomatic,
      sc.nesting_depth,
      cm.commits,
      cm.churn_per_week,
      cm.unique_authors,
      ROUND(sc.cyclomatic * LOG(1 + cm.commits), 2) as hotspot_score,
      CASE
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 20 THEN 'critical'
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 10 THEN 'high'
        WHEN sc.cyclomatic * LOG(1 + cm.commits) >= 5 THEN 'medium'
        ELSE 'low'
      END as risk
    FROM symbol_complexity sc
    JOIN code_symbols cs ON cs.id = sc.symbol_id
    JOIN churn_metrics cm ON cm.repo_id = cs.repo_id AND cm.file_path = cs.file_path
    WHERE cs.repo_id = ? AND cm.window_days = ?
    ORDER BY hotspot_score DESC
    LIMIT ?
  `).all(repoId, days, topN);

  return { hotspots: rows };
}

module.exports.getHotspots = getHotspots;
```

- [ ] **Step 2: Add the `hotspots` CLI subcommand in `memory-store.js`**

Add to the command dispatch object (next to `dead-code`):

```javascript
  'hotspots': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js hotspots --repo X [--top N] [--days N]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getHotspots(db, repoRow[0].id, {
      top: args.top ? parseInt(args.top) : 20,
      days: args.days ? parseInt(args.days) : 90,
    });
  },
```

- [ ] **Step 3: Add `hotspots` mode to `memory-code` in `index.ts`**

In the `memory-code` tool definition, add `hotspots` to the mode enum:

```typescript
mode: Type.String({
  description: "Analysis mode: callers|callees|blast-radius|dead-code|complexity|deps|outline|churn|hotspots|cycles|importance|coupling|extractable|hierarchy",
  enum: ["callers", "callees", "blast-radius", "dead-code", "complexity", "deps", "outline", "churn", "hotspots", "cycles", "importance", "coupling", "extractable", "hierarchy"],
}),
```

Add to the cmdMap:

```typescript
const cmdMap: Record<string, string> = {
  callers: "call-hierarchy",
  callees: "call-hierarchy",
  "blast-radius": "blast-radius",
  "dead-code": "dead-code",
  complexity: "complexity",
  deps: "import-graph",
  outline: "outline",
  churn: "churn",
  hotspots: "hotspots",
  cycles: "cycles",
  importance: "importance",
  coupling: "coupling",
  extractable: "extractable",
  hierarchy: "hierarchy",
};
```

Add to the formatCodeResult function:

```typescript
case "hotspots":
  if (!result.hotspots?.length) return "No hotspots found" + (result.note ? ` (${result.note})` : "") + ".";
  return result.hotspots.map((h: any, i: number) =>
    `${i+1}. **${h.name}** (${h.kind}) — ${h.file_path.split("/").pop()}\n   Risk: ${h.risk} | Score: ${h.hotspot_score} | Complexity: ${h.cyclomatic} | Commits: ${h.commits} | Churn: ${h.churn_per_week}/wk`
  ).join("\n\n");
```

- [ ] **Step 4: Test with the existing repos**

```bash
cd ~/.pi/agent/skills/memory-layer
# First populate churn data (requires git history)
node memory-store.js churn --repo v5-dev
# Then run hotspots
node memory-store.js hotspots --repo v5-dev --top 10
# Expected: JSON with top 10 symbols ranked by hotspot_score
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: hotspots — complexity × churn risk ranking (v5.2 task 1)"
```

---

## Task 2: Dependency Cycles (`memory-code cycles`)

**Files:**
- Modify: `code-analysis.js` — add `getDependencyCycles()`
- Modify: `memory-store.js` — add `cycles` subcommand
- Modify: `index.ts` — add `cycles` mode to `memory-code`

Tarjan's SCC algorithm on `code_imports`. Finds circular import chains like `A → B → C → A`.

### Step-by-step

- [ ] **Step 1: Write the `getDependencyCycles` function in `code-analysis.js`**

Add after the `getHotspots` function:

```javascript
// ══════════════════════════════════════════════════════════
// DEPENDENCY CYCLES (Tarjan's SCC on import graph)
// ══════════════════════════════════════════════════════════

function getDependencyCycles(db, repoId) {
  // Build adjacency list from import edges (source → target)
  const edges = db.prepare(`
    SELECT DISTINCT cf_source.path as source, cf_target.path as target
    FROM code_imports ci
    JOIN code_files cf_source ON cf_source.id = ci.source_file_id
    JOIN code_files cf_target ON cf_target.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
  `).all(repoId);

  const adj = new Map();
  const allNodes = new Set();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
    allNodes.add(e.source);
    allNodes.add(e.target);
  }

  // Tarjan's SCC
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of (adj.get(v) || [])) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const v of allNodes) {
    if (!indices.has(v)) strongconnect(v);
  }

  // Find actual cycles (paths that close the loop)
  const cycles = sccs.map(scc => {
    const sccSet = new Set(scc);
    const cycleEdges = [];
    for (const node of scc) {
      for (const neighbor of (adj.get(node) || [])) {
        if (sccSet.has(neighbor)) {
          cycleEdges.push({ from: node, to: neighbor });
        }
      }
    }
    return { files: scc, edges: cycleEdges, size: scc.length };
  });

  return { cycles: cycles.sort((a, b) => b.size - a.size), total_circular_files: cycles.reduce((sum, c) => sum + c.size, 0) };
}

module.exports.getDependencyCycles = getDependencyCycles;
```

- [ ] **Step 2: Add the `cycles` CLI subcommand in `memory-store.js`**

```javascript
  'cycles': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js cycles --repo X');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getDependencyCycles(db, repoRow[0].id);
  },
```

- [ ] **Step 3: Add `cycles` format to `formatCodeResult` in `index.ts`**

```typescript
case "cycles":
  if (!result.cycles?.length) return "No dependency cycles found — import graph is acyclic.";
  return result.cycles.map((c: any, i: number) =>
    `${i+1}. **Cycle ${i+1}** (${c.size} files)\n   Files: ${c.files.map((f: string) => f.split("/").pop()).join(" → ")}\n   Edges: ${c.edges.map((e: any) => `${e.from.split("/").pop()} → ${e.to.split("/").pop()}`).join(", ")}`
  ).join("\n\n");
```

- [ ] **Step 4: Test**

```bash
node memory-store.js cycles --repo v5-dev
# Expected: JSON with cycles array (likely 0 cycles for our small project)
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: dependency cycles — Tarjan SCC on import graph (v5.2 task 2)"
```

---

## Task 3: Symbol Importance / PageRank (`memory-code importance`)

**Files:**
- Modify: `code-analysis.js` — add `getSymbolImportance()`
- Modify: `memory-store.js` — add `importance` subcommand
- Modify: `index.ts` — add `importance` format (already added enum in Task 1)

PageRank on the `code_calls` graph. Ranks symbols by how central they are to the call network.

### Step-by-step

- [ ] **Step 1: Write the `getSymbolImportance` function in `code-analysis.js`**

Add after `getDependencyCycles`:

```javascript
// ══════════════════════════════════════════════════════════
// SYMBOL IMPORTANCE (PageRank on call graph)
// ══════════════════════════════════════════════════════════

function getSymbolImportance(db, repoId, opts = {}) {
  const topN = opts.top || 20;
  const scope = opts.scope || null;

  // Build call graph: caller → [callees] (only for symbols in this repo)
  const calls = db.prepare(`
    SELECT cc.caller_symbol_id, cc.callee_symbol_id
    FROM code_calls cc
    JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
    WHERE cc.repo_id = ? AND cc.callee_symbol_id IS NOT NULL AND cs.repo_id = ?
  `).all(repoId, repoId);

  // Get all symbols in repo (optionally scoped)
  let symbolQuery = 'SELECT id, name, kind, file_path FROM code_symbols WHERE repo_id = ?';
  const symbolParams = [repoId];
  if (scope) {
    symbolQuery += ' AND file_path LIKE ?';
    symbolParams.push(`${scope}%`);
  }
  const symbols = db.prepare(symbolQuery).all(...symbolParams);
  const symbolSet = new Set(symbols.map(s => s.id));
  const symbolMap = new Map(symbols.map(s => [s.id, s]));

  // Build outgoing edges map (only between repo symbols)
  const outEdges = new Map();
  for (const call of calls) {
    if (!symbolSet.has(call.caller_symbol_id) || !symbolSet.has(call.callee_symbol_id)) continue;
    if (!outEdges.has(call.caller_symbol_id)) outEdges.set(call.caller_symbol_id, []);
    outEdges.get(call.caller_symbol_id).push(call.callee_symbol_id);
  }

  // Initialize PageRank
  const d = 0.85; // damping factor
  const n = symbolSet.size;
  let ranks = new Map();
  for (const id of symbolSet) ranks.set(id, 1 / n);

  // Iterate (10 iterations)
  for (let i = 0; i < 10; i++) {
    const newRanks = new Map();
    for (const id of symbolSet) newRanks.set(id, (1 - d) / n);

    for (const [callerId, calleeIds] of outEdges) {
      const outDegree = calleeIds.length;
      if (outDegree === 0) continue;
      const rankShare = ranks.get(callerId) / outDegree;
      for (const calleeId of calleeIds) {
        newRanks.set(calleeId, newRanks.get(calleeId) + d * rankShare);
      }
    }
    ranks = newRanks;
  }

  // Sort by rank and return top N
  const results = [...ranks.entries()]
    .map(([id, rank]) => ({ ...symbolMap.get(id), pagerank: Math.round(rank * 10000) / 10000 }))
    .sort((a, b) => b.pagerank - a.pagerank)
    .slice(0, topN);

  return { importance: results, total_symbols: n };
}

module.exports.getSymbolImportance = getSymbolImportance;
```

- [ ] **Step 2: Add the `importance` CLI subcommand in `memory-store.js`**

```javascript
  'importance': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js importance --repo X [--top N] [--scope dir/]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getSymbolImportance(db, repoRow[0].id, {
      top: args.top ? parseInt(args.top) : 20,
      scope: args.scope || null,
    });
  },
```

- [ ] **Step 3: Add `importance` format to `formatCodeResult` in `index.ts`**

```typescript
case "importance":
  if (!result.importance?.length) return "No symbols found.";
  return `Top ${result.importance.length} of ${result.total_symbols} symbols by PageRank:\n\n` +
    result.importance.map((s: any, i: number) =>
      `${i+1}. **${s.name}** (${s.kind}) — ${s.file_path.split("/").pop()} — PageRank: ${s.pagerank}`
    ).join("\n");
```

- [ ] **Step 4: Test**

```bash
node memory-store.js importance --repo v5-dev --top 10
# Expected: JSON with importance array, each entry has name, kind, file_path, pagerank
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: symbol importance — PageRank on call graph (v5.2 task 3)"
```

---

## Task 4: Coupling Metrics (`memory-code coupling`)

**Files:**
- Modify: `code-analysis.js` — add `getCouplingMetrics()`
- Modify: `memory-store.js` — add `coupling` subcommand
- Modify: `index.ts` — add `coupling` format (already in enum from Task 1)

Afferent coupling (Ca) = files importing this module. Efferent coupling (Ce) = modules this file imports. Instability I = Ce/(Ca+Ce): 0 = stable, 1 = unstable.

### Step-by-step

- [ ] **Step 1: Write the `getCouplingMetrics` function in `code-analysis.js`**

Add after `getSymbolImportance`:

```javascript
// ══════════════════════════════════════════════════════════
// COUPLING METRICS (afferent/efferent/instability per file)
// ══════════════════════════════════════════════════════════

function getCouplingMetrics(db, repoId, opts = {}) {
  const filePath = opts.file || null;
  const minCa = opts.minCa || 0;
  const sortBy = opts.sortBy || 'instability'; // 'instability', 'afferent', 'efferent'

  // Afferent coupling (Ca): files that import this file
  const afferentRows = db.prepare(`
    SELECT tf.path as file_path, COUNT(DISTINCT ci.source_file_id) as ca
    FROM code_imports ci
    JOIN code_files tf ON tf.id = ci.target_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
    GROUP BY tf.path
  `).all(repoId);

  // Efferent coupling (Ce): files this file imports
  const efferentRows = db.prepare(`
    SELECT sf.path as file_path, COUNT(DISTINCT ci.target_file_id) as ce
    FROM code_imports ci
    JOIN code_files sf ON sf.id = ci.source_file_id
    WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL AND ci.import_type != 're-export'
    GROUP BY sf.path
  `).all(repoId);

  const afferentMap = new Map(afferentRows.map(r => [r.file_path, r.ca]));
  const efferentMap = new Map(efferentRows.map(r => [r.file_path, r.ce]));

  // Get all files in repo
  const allFiles = db.prepare('SELECT path FROM code_files WHERE repo_id = ?').all(repoId);
  const results = [];

  for (const f of allFiles) {
    if (filePath && f.path !== filePath && !f.path.endsWith(filePath)) continue;
    const ca = afferentMap.get(f.path) || 0;
    const ce = efferentMap.get(f.path) || 0;
    const total = ca + ce;
    const instability = total === 0 ? 0 : Math.round((ce / total) * 100) / 100;
    const category = instability <= 0.3 ? 'stable' : instability >= 0.7 ? 'unstable' : 'balanced';

    if (ca < minCa) continue;
    results.push({ file_path: f.path, afferent: ca, efferent: ce, instability, category });
  }

  const sortKey = sortBy === 'afferent' ? 'afferent' : sortBy === 'efferent' ? 'efferent' : 'instability';
  results.sort((a, b) => b[sortKey] - a[sortKey]);

  return { metrics: results };
}

module.exports.getCouplingMetrics = getCouplingMetrics;
```

- [ ] **Step 2: Add the `coupling` CLI subcommand in `memory-store.js`**

```javascript
  'coupling': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js coupling --repo X [--file F] [--sort-by instability|afferent|efferent]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getCouplingMetrics(db, repoRow[0].id, {
      file: args.file || null,
      minCa: args['min-ca'] ? parseInt(args['min-ca']) : 0,
      sortBy: args['sort-by'] || 'instability',
    });
  },
```

- [ ] **Step 3: Add `coupling` format to `formatCodeResult` in `index.ts`**

```typescript
case "coupling":
  if (!result.metrics?.length) return "No coupling data found.";
  return result.metrics.map((m: any) => {
    const short = m.file_path.split("/").pop();
    return `**${short}** (${m.category})\n   Ca=${m.afferent} Ce=${m.efferent} I=${m.instability}`;
  }).join("\n\n");
```

- [ ] **Step 4: Test**

```bash
node memory-store.js coupling --repo v5-dev
# Expected: JSON with metrics array showing Ca, Ce, I per file
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: coupling metrics — afferent/efferent/instability per file (v5.2 task 4)"
```

---

## Task 5: Extraction Candidates (`memory-code extractable`)

**Files:**
- Modify: `code-analysis.js` — add `getExtractionCandidates()`
- Modify: `memory-store.js` — add `extractable` subcommand
- Modify: `index.ts` — add `extractable` format (already in enum)

Score = `cyclomatic × log(1 + distinct_caller_files)`. Finds complex functions called from many places — good candidates for extraction to shared modules.

### Step-by-step

- [ ] **Step 1: Write the `getExtractionCandidates` function in `code-analysis.js`**

Add after `getCouplingMetrics`:

```javascript
// ══════════════════════════════════════════════════════════
// EXTRACTION CANDIDATES (complexity × caller spread)
// ══════════════════════════════════════════════════════════

function getExtractionCandidates(db, repoId, opts = {}) {
  const minComplexity = opts.minComplexity || 5;
  const minCallers = opts.minCallers || 2;
  const topN = opts.top || 20;

  // Find symbols with high complexity that are called from multiple files
  const rows = db.prepare(`
    SELECT
      cs.name,
      cs.kind,
      cs.file_path,
      sc.cyclomatic,
      sc.nesting_depth,
      sc.lines_of_code,
      COUNT(DISTINCT caller.file_path) as caller_file_count,
      ROUND(sc.cyclomatic * LOG(1 + COUNT(DISTINCT caller.file_path)), 2) as extraction_score,
      GROUP_CONCAT(DISTINCT caller.file_path) as caller_files
    FROM symbol_complexity sc
    JOIN code_symbols cs ON cs.id = sc.symbol_id
    JOIN code_calls cc ON cc.callee_symbol_id = cs.id AND cc.repo_id = cs.repo_id
    JOIN code_symbols caller ON caller.id = cc.caller_symbol_id AND caller.repo_id = cs.repo_id
    WHERE cs.repo_id = ? AND sc.cyclomatic >= ?
    GROUP BY cs.id
    HAVING COUNT(DISTINCT caller.file_path) >= ?
    ORDER BY extraction_score DESC
    LIMIT ?
  `).all(repoId, minComplexity, minCallers, topN);

  // Parse caller_files from GROUP_CONCAT
  const results = rows.map(r => ({
    ...r,
    caller_files: r.caller_files ? r.caller_files.split(',') : [],
  }));

  return { candidates: results };
}

module.exports.getExtractionCandidates = getExtractionCandidates;
```

- [ ] **Step 2: Add the `extractable` CLI subcommand in `memory-store.js`**

```javascript
  'extractable': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js extractable --repo X [--min-complexity N] [--min-callers N] [--top N]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getExtractionCandidates(db, repoRow[0].id, {
      minComplexity: args['min-complexity'] ? parseInt(args['min-complexity']) : 5,
      minCallers: args['min-callers'] ? parseInt(args['min-callers']) : 2,
      top: args.top ? parseInt(args.top) : 20,
    });
  },
```

- [ ] **Step 3: Add `extractable` format to `formatCodeResult` in `index.ts`**

```typescript
case "extractable":
  if (!result.candidates?.length) return "No extraction candidates found. Try lowering --min-complexity or --min-callers.";
  return result.candidates.map((c: any, i: number) =>
    `${i+1}. **${c.name}** (${c.kind}) — ${c.file_path.split("/").pop()}\n   Score: ${c.extraction_score} | Complexity: ${c.cyclomatic} | Callers: ${c.caller_file_count} files\n   Called from: ${c.caller_files.map((f: string) => f.split("/").pop()).join(", ")}`
  ).join("\n\n");
```

- [ ] **Step 4: Test**

```bash
node memory-store.js extractable --repo v5-dev --min-complexity 3
# Expected: JSON with candidates array, each with extraction_score, complexity, caller_files
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: extraction candidates — complexity × caller count (v5.2 task 5)"
```

---

## Task 6: Orphan Doc Sections (`memory-doc orphans`)

**Files:**
- Modify: `doc-indexer.js` — add `getOrphanSections()`
- Modify: `memory-store.js` — add `doc-orphans` subcommand
- Modify: `index.ts` — add `orphans` mode to `memory-doc`

Finds doc sections with zero inbound links — knowledge that no other page references.

### Step-by-step

- [ ] **Step 1: Write the `getOrphanSections` function in `doc-indexer.js`**

Add at the end of the `module.exports` block (before the final `}`):

```javascript
// ══════════════════════════════════════════════════════════
// ORPHAN SECTIONS (zero inbound links)
// ══════════════════════════════════════════════════════════

function getOrphanSections(db, repoId, opts = {}) {
  const includeSameDoc = opts.includeSameDoc || false;

  // Sections with zero inbound links from OTHER documents
  let query, params;
  if (includeSameDoc) {
    // Include intra-document links (e.g., TOC at top of page)
    query = `
      SELECT ds.id, ds.title, ds.level, df.path as file_path, ds.role
      FROM doc_sections ds
      JOIN doc_files df ON df.id = ds.file_id
      WHERE ds.repo_id = ?
        AND ds.id NOT IN (SELECT DISTINCT target_section_id FROM doc_links WHERE target_section_id IS NOT NULL)
      ORDER BY ds.level, ds.title
    `;
    params = [repoId];
  } else {
    // Only count cross-document inbound links
    query = `
      SELECT ds.id, ds.title, ds.level, df.path as file_path, ds.role
      FROM doc_sections ds
      JOIN doc_files df ON df.id = ds.file_id
      WHERE ds.repo_id = ?
        AND ds.id NOT IN (
          SELECT DISTINCT dl.target_section_id
          FROM doc_links dl
          JOIN doc_sections src ON src.id = dl.source_section_id
          WHERE dl.target_section_id IS NOT NULL AND src.file_id != ds.file_id
        )
        AND ds.level > 1
      ORDER BY ds.level, ds.title
    `;
    params = [repoId];
  }

  const orphans = db.prepare(query).all(...params);
  return { orphans, total: orphans.length };
}

module.exports.getOrphanSections = getOrphanSections;
```

- [ ] **Step 2: Add the `doc-orphans` CLI subcommand in `memory-store.js`**

```javascript
  'doc-orphans': (args) => {
    const repo = args.repo;
    if (!repo) jsonErr('Usage: node memory-store.js doc-orphans --repo X [--include-same-doc]');
    const repoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Doc repo "${repo}" not found`);
    return docIndexer.getOrphanSections(db, repoRow[0].id, {
      includeSameDoc: args['include-same-doc'] === 'true',
    });
  },
```

- [ ] **Step 3: Add `orphans` mode to `memory-doc` in `index.ts`**

In the `memory-doc` tool definition, update the mode enum:

```typescript
mode: Type.String({
  description: "Query mode: search|outline|backlinks|broken-links|glossary|tutorial-path|code-examples|orphans|coverage",
  enum: ["search", "outline", "backlinks", "broken-links", "glossary", "tutorial-path", "code-examples", "orphans", "coverage"],
}),
```

Add to cmdMap:

```typescript
const cmdMap: Record<string, string> = {
  search: "doc-search",
  outline: "doc-outline",
  backlinks: "backlinks",
  "broken-links": "broken-links",
  glossary: "glossary",
  "tutorial-path": "tutorial-path",
  "code-examples": "code-examples",
  orphans: "doc-orphans",
  coverage: "doc-coverage",
};
```

Add `include_same_doc` parameter:

```typescript
include_same_doc: Type.Optional(Type.Boolean({ description: "Include intra-document links when finding orphans (default: false)" })),
```

Wire in execute:

```typescript
if (params.include_same_doc) args["include-same-doc"] = "true";
```

Add format:

```typescript
case "orphans":
  if (!result.orphans?.length) return "No orphan sections found — all sections have inbound links.";
  return `Found ${result.total} orphan sections:\n\n` +
    result.orphans.map((s: any) =>
      `- **${s.title}** (L${s.level}) — ${s.file_path.split("/").pop()} [${s.role || "other"}]`
    ).join("\n");
```

- [ ] **Step 4: Test**

```bash
node memory-store.js doc-orphans --repo pi-mem-docs
# Expected: JSON with orphans array of sections with zero inbound links
```

- [ ] **Step 5: Commit**

```bash
git add doc-indexer.js memory-store.js index.ts
git commit -m "feat: orphan doc sections — find unreferenced knowledge (v5.2 task 6)"
```

---

## Task 7: Doc Coverage (`memory-doc coverage`)

**Files:**
- Modify: `doc-indexer.js` — add `getDocCoverage()`
- Modify: `memory-store.js` — add `doc-coverage` subcommand
- Modify: `index.ts` — add `coverage` format (already in enum from Task 6)

Matches code symbol names against doc section titles and content. Reports which symbols have docs and which don't.

### Step-by-step

- [ ] **Step 1: Write the `getDocCoverage` function in `doc-indexer.js`**

Add after `getOrphanSections`:

```javascript
// ══════════════════════════════════════════════════════════
// DOC COVERAGE (which code symbols have documentation)
// ══════════════════════════════════════════════════════════

function getDocCoverage(db, repoId, docRepoId, opts = {}) {
  // Get all function/constant symbols from the code repo
  const symbols = db.prepare(`
    SELECT id, name, kind, file_path FROM code_symbols
    WHERE repo_id = ? AND kind IN ('function', 'constant', 'method')
  `).all(repoId);

  // Get all doc section titles + content for matching
  const sections = db.prepare(`
    SELECT id, title, content, role FROM doc_sections WHERE repo_id = ?
  `).all(docRepoId);

  // Build lookup: lowercase name → section match
  const docNames = new Map();
  for (const s of sections) {
    const lowerTitle = s.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    docNames.set(lowerTitle, s);
    // Also extract heading-style names from content (e.g., `search(query)`)
    const fnRefs = s.content.match(/\b([a-z_][a-z0-9_]{2,})\s*\(/gi) || [];
    for (const ref of fnRefs) {
      const name = ref.replace(/\s*\($/, '').toLowerCase();
      if (!docNames.has(name)) docNames.set(name, s);
    }
  }

  let documented = 0;
  const documented_list = [];
  const undocumented_list = [];

  for (const sym of symbols) {
    const lowerName = sym.name.toLowerCase();
    // Check if symbol name appears in any doc section title or content
    const matched = docNames.has(lowerName) || docNames.has(lowerName.replace(/_/g, ''));
    if (matched) {
      documented++;
      documented_list.push(sym);
    } else {
      undocumented_list.push(sym);
    }
  }

  const total = symbols.length;
  const coveragePct = total > 0 ? Math.round((documented / total) * 100) : 0;

  return {
    total_symbols: total,
    documented: documented,
    undocumented: undocumented_list.length,
    coverage_pct: coveragePct,
    documented_list: documented_list.slice(0, 20),
    undocumented_list: undocumented_list.slice(0, 20),
  };
}

module.exports.getDocCoverage = getDocCoverage;
```

- [ ] **Step 2: Add the `doc-coverage` CLI subcommand in `memory-store.js`**

```javascript
  'doc-coverage': (args) => {
    const codeRepo = args.repo;
    const docRepo = args['doc-repo'] || codeRepo;
    if (!codeRepo) jsonErr('Usage: node memory-store.js doc-coverage --repo X [--doc-repo Y]');
    const codeRepoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [codeRepo]);
    if (!codeRepoRow.length) jsonErr(`Code repo "${codeRepo}" not found. Run index-repo first.`);
    const docRepoRow = sqlJson('SELECT id FROM doc_repos WHERE name = ?', [docRepo]);
    if (!docRepoRow.length) jsonErr(`Doc repo "${docRepo}" not found. Run index-docs first.`);
    return docIndexer.getDocCoverage(db, codeRepoRow[0].id, docRepoRow[0].id);
  },
```

- [ ] **Step 3: Add `coverage` format to `formatDocResult` in `index.ts`**

```typescript
case "coverage":
  return `Doc coverage: ${result.coverage_pct}% (${result.documented}/${result.total_symbols} symbols documented)\n\n` +
    `**Documented** (showing up to 20):\n` +
    result.documented_list.map((s: any) => `  ✅ ${s.name} (${s.kind}) — ${s.file_path.split("/").pop()}`).join("\n") +
    `\n\n**Undocumented** (showing up to 20):\n` +
    result.undocumented_list.map((s: any) => `  ❌ ${s.name} (${s.kind}) — ${s.file_path.split("/").pop()}`).join("\n");
```

Add `doc_repo` parameter to `memory-doc` tool:

```typescript
doc_repo: Type.Optional(Type.String({ description: "Code repo name to cross-reference (for coverage mode). Defaults to repo." })),
```

Wire in execute:

```typescript
if (params.doc_repo) args["doc-repo"] = params.doc_repo;
```

- [ ] **Step 4: Test**

```bash
node memory-store.js doc-coverage --repo v5-dev --doc-repo pi-mem-docs
# Expected: JSON with coverage_pct, documented/undocumented counts, sample lists
```

- [ ] **Step 5: Commit**

```bash
git add doc-indexer.js memory-store.js index.ts
git commit -m "feat: doc coverage — symbol-to-doc cross-reference matching (v5.2 task 7)"
```

---

## Task 8: Class Hierarchy (`memory-code hierarchy`)

**Files:**
- Modify: `code-analysis.js` — add `getClassHierarchy()`
- Modify: `memory-store.js` — add `hierarchy` subcommand
- Modify: `index.ts` — add `hierarchy` format (already in enum from Task 1)

Uses existing `code_symbols.parent_name` field to build ancestor/descendant trees via recursive CTE.

### Step-by-step

- [ ] **Step 1: Write the `getClassHierarchy` function in `code-analysis.js`**

Add after `getExtractionCandidates`:

```javascript
// ══════════════════════════════════════════════════════════
// CLASS HIERARCHY (parent_name → ancestors/descendants)
// ══════════════════════════════════════════════════════════

function getClassHierarchy(db, repoId, opts = {}) {
  const className = opts.class || opts.symbol;
  const direction = opts.direction || 'both'; // 'ancestors', 'descendants', 'both'

  if (!className) return { error: 'Class name required. Pass --class or --symbol.' };

  // Find the symbol
  const sym = db.prepare('SELECT id, name, kind, file_path, parent_name FROM code_symbols WHERE repo_id = ? AND name = ?').get(repoId, className);
  if (!sym) return { error: `Symbol "${className}" not found in repo.` };

  const result = { name: sym.name, kind: sym.kind, file_path: sym.file_path, parent_name: sym.parent_name };

  // Ancestors: walk parent_name chain upward
  if (direction === 'ancestors' || direction === 'both') {
    const ancestors = [];
    let current = sym;
    const visited = new Set();
    while (current.parent_name && !visited.has(current.parent_name)) {
      visited.add(current.parent_name);
      const parent = db.prepare('SELECT id, name, kind, file_path, parent_name FROM code_symbols WHERE repo_id = ? AND name = ?').get(repoId, current.parent_name);
      if (!parent) break;
      ancestors.push({ name: parent.name, kind: parent.kind, file_path: parent.file_path });
      current = parent;
    }
    result.ancestors = ancestors;
  }

  // Descendants: find symbols whose parent_name matches this class
  if (direction === 'descendants' || direction === 'both') {
    const descendants = db.prepare(`
      SELECT name, kind, file_path, parent_name FROM code_symbols
      WHERE repo_id = ? AND parent_name = ?
      ORDER BY kind, name
    `).all(repoId, className);
    result.descendants = descendants;
  }

  return result;
}

module.exports.getClassHierarchy = getClassHierarchy;
```

- [ ] **Step 2: Add the `hierarchy` CLI subcommand in `memory-store.js`**

```javascript
  'hierarchy': (args) => {
    const repo = args.repo;
    const symbol = args.symbol || args.class;
    if (!repo) jsonErr('Usage: node memory-store.js hierarchy --repo X --symbol S [--direction both|ancestors|descendants]');
    const repoRow = sqlJson('SELECT id FROM code_repos WHERE name = ?', [repo]);
    if (!repoRow.length) jsonErr(`Repo "${repo}" not found. Run index-repo first.`);
    return codeAnalysis.getClassHierarchy(db, repoRow[0].id, {
      class: args.class,
      symbol: args.symbol,
      direction: args.direction || 'both',
    });
  },
```

- [ ] **Step 3: Add `hierarchy` format to `formatCodeResult` in `index.ts`**

```typescript
case "hierarchy":
  if (result.error) return `Error: ${result.error}`;
  let out = `**${result.name}** (${result.kind}) — ${result.file_path.split("/").pop()}`;
  if (result.ancestors?.length) {
    out += `\n\nAncestors: ` + result.ancestors.map((a: any) => `${a.name} (${a.kind})`).join(" → ");
  }
  if (result.descendants?.length) {
    out += `\n\nMembers: ` + result.descendants.map((d: any) => `${d.name} (${d.kind})`).join(", ");
  }
  return out;
```

- [ ] **Step 4: Test**

```bash
node memory-store.js hierarchy --repo v5-dev --symbol search
# Expected: JSON with ancestors/descendants based on parent_name chain
```

- [ ] **Step 5: Commit**

```bash
git add code-analysis.js memory-store.js
git commit -m "feat: class hierarchy — parent_name chain walk (v5.2 task 8)"
```

---

## Task 9: Deploy, SKILL.md Update, and Verification

**Files:**
- Modify: `SKILL.md` — update tool reference with new modes
- Deploy: Copy all modified files to `~/.pi/agent/skills/memory-layer/`

- [ ] **Step 1: Update SKILL.md with new modes**

Add these to the `memory-code` tool modes section:

```
- hotspots: Top N symbols by complexity × churn risk score
- cycles: Dependency cycles (Tarjan SCC) in import graph
- importance: Symbol PageRank on call graph
- coupling: Afferent/efferent coupling metrics per file
- extractable: Extraction candidates (complex functions called from many files)
- hierarchy: Class hierarchy (parent/child) for a symbol
```

Add these to the `memory-doc` tool modes section:

```
- orphans: Doc sections with zero inbound links
- coverage: Code symbol → doc cross-reference coverage
```

- [ ] **Step 2: Copy all modified files to deployed location**

```bash
DEPLOYED=~/.pi/agent/skills/memory-layer
cp code-analysis.js doc-indexer.js memory-store.js "$DEPLOYED/"
cp ~/.pi/agent/extensions/memory-layer/index.ts "$DEPLOYED/../extensions/memory-layer/"
```

- [ ] **Step 3: Re-index test repo and verify all new features**

```bash
cd ~/.pi/agent/skills/memory-layer
node memory-store.js hotspots --repo v5-dev --top 5
node memory-store.js cycles --repo v5-dev
node memory-store.js importance --repo v5-dev --top 5
node memory-store.js coupling --repo v5-dev
node memory-store.js extractable --repo v5-dev --min-complexity 3
node memory-store.js hierarchy --repo v5-dev --symbol search
node memory-store.js doc-orphans --repo pi-mem-docs
node memory-store.js doc-coverage --repo v5-dev --doc-repo pi-mem-docs
```

Each command should return structured JSON with expected fields and no errors.

- [ ] **Step 4: Final commit**

```bash
git add SKILL.md
git commit -m "docs: update SKILL.md with v5.2 analytics modes"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 7 Tier 1 features + 1 Tier 2 feature (hierarchy) are covered by tasks 1-8
- [x] **No placeholders:** Every step has complete code — no TODOs, TBDs, or "implement later"
- [x] **Type consistency:** All function signatures match between `code-analysis.js` exports, `memory-store.js` calls, and `index.ts` parameter wiring
- [x] **Schema alignment:** All SQL queries reference existing columns — no new tables needed (verified against schema.sql)
- [x] **Export wiring:** Each new function is exported via `module.exports.X = X` in its module file
- [x] **Index.ts enum consistency:** All new modes appear in both the mode enum and the cmdMap
- [x] **Edge cases:** Hotspots returns note when no churn data exists; cycles returns empty array for acyclic graphs; importance handles scope filter; coverage handles zero symbols