# LaPis Phase 5: Runtime Reality + Blast Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime awareness to LaPis — ingest Istanbul coverage data to distinguish hot/cold paths, add a dedicated blast-radius command, and detect stale feature flags.

**Architecture:** This plan adds a runtime layer on top of the existing code index without requiring external APM infrastructure. Coverage data from Istanbul JSON provides hit counts per file/function. The blast command wraps existing call-graph analysis with a simpler interface. Stale flags are detected via branch direction analysis in source code.

**Tech Stack:** Node.js, SQLite (better-sqlite3), existing `code_symbols` + `code_calls` tables, Istanbul coverage JSON format.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/agent-intel/runtime-ingest.js` | Istanbul coverage JSON parsing + storage |
| Create | `src/agent-intel/blast.js` | Dedicated blast-radius command wrapper |
| Create | `src/agent-intel/stale-flags.js` | One-sided branch detection in source |
| Modify | `schema.sql` | New tables: `runtime_symbols`, `stale_flags` |
| Modify | `src/cli/commands/agent-intel.js` | Register `runtime-ingest`, `blast`, `stale-flags` commands |
| Modify | `src/agent-intel/preflight.js` | Enrich preflight with runtime hotness data |
| Modify | `src/agent-intel/audit-diff.js` | Consider runtime hotness in risk scoring |
| Create | `test/agent-intel/runtime-ingest.test.js` | Tests for coverage ingestion |
| Create | `test/agent-intel/blast.test.js` | Tests for blast command |
| Create | `test/agent-intel/stale-flags.test.js` | Tests for stale flag detection |

---

### Task 1: Schema — Add `runtime_symbols` and `stale_flags` tables

Store runtime hotness data per symbol and detected stale branches.

**Files:**
- Modify: `schema.sql`
- Test: `test/agent-intel/runtime-ingest.test.js`

- [ ] **Step 1: Write the schema**

At the end of `schema.sql`, add:

```sql
-- ═══════════════════════════════════════════════════════════
-- RUNTIME REALITY: Symbol hotness and stale flag detection
-- ═══════════════════════════════════════════════════════════

-- Runtime hotness per symbol (from Istanbul coverage)
CREATE TABLE IF NOT EXISTS runtime_symbols (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id           INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  symbol_id         INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
  file_path         TEXT NOT NULL,
  function_name     TEXT NOT NULL DEFAULT '',
  hit_count         INTEGER NOT NULL DEFAULT 0,
  line_start         INTEGER,
  line_end           INTEGER,
  traffic           TEXT NOT NULL DEFAULT 'unknown',  -- hot | warm | cold | unknown
  last_seen         TEXT,                              -- ISO date
  ingested_at       TEXT NOT NULL DEFAULT (datetime('now')),
  source_file       TEXT NOT NULL DEFAULT '',          -- coverage JSON path
  UNIQUE(repo_id, file_path, function_name)
);

CREATE INDEX IF NOT EXISTS idx_rs_repo ON runtime_symbols(repo_id);
CREATE INDEX IF NOT EXISTS idx_rs_traffic ON runtime_symbols(traffic);

-- Stale feature flags (one-sided branches detected in source)
CREATE TABLE IF NOT EXISTS stale_flags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  line_number     INTEGER NOT NULL,
  flag_name       TEXT NOT NULL,
  branch_type     TEXT NOT NULL,  -- always-true | always-false
  context         TEXT NOT NULL DEFAULT '',
  detected_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sf_repo ON stale_flags(repo_id);
CREATE INDEX IF NOT EXISTS idx_sf_traffic ON stale_flags(file_path);
```

- [ ] **Step 2: Verify the schema applies cleanly**

Run: `node -e "const db = require('better-sqlite3')(':memory:'); const sql = require('fs').readFileSync('schema.sql','utf8'); db.exec(sql); console.log('OK'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('runtime_symbols','stale_flags')\").all());"`
Expected: `OK` and `[{ name: 'runtime_symbols' }, { name: 'stale_flags' }]`

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "feat(schema): add runtime_symbols and stale_flags tables"
```

---

### Task 2: Runtime Ingest — Istanbul Coverage Parser

Parse Istanbul coverage JSON and store hit counts per symbol.

**Files:**
- Create: `src/agent-intel/runtime-ingest.js`
- Test: `test/agent-intel/runtime-ingest.test.js`

- [ ] **Step 1: Write the runtime-ingest module**

Create `src/agent-intel/runtime-ingest.js`:

```js
// Module boundary:
// Ingests Istanbul/NYC coverage JSON and stores runtime hotness per symbol.
// Must not mutate code indexes or memory.

const path = require('path');
const fs = require('fs');

/**
 * Istanbul coverage JSON shape:
 * {
 *   "/path/to/file.js": {
 *     "path": "/path/to/file.js",
 *     "statementMap": { "0": { "start": {...}, "end": {...} } },
 *     "fnMap": { "0": { "name": "fnName", "line": 5, "loc": {...} } },
 *     "s": { "0": 10, "1": 5 },  // statement hits
 *     "f": { "0": 3 }            // function hits
 *   }
 * }
 */

const TRAFFIC_THRESHOLDS = {
  hot: 1000,    // >= 1000 hits in coverage period
  warm: 100,    // >= 100 hits
  cold: 0,      // < 100 hits
};

function classifyTraffic(hitCount) {
  if (hitCount >= TRAFFIC_THRESHOLDS.hot) return 'hot';
  if (hitCount >= TRAFFIC_THRESHOLDS.warm) return 'warm';
  return 'cold';
}

function parseCoverageFile(coveragePath) {
  const raw = fs.readFileSync(coveragePath, 'utf-8');
  return JSON.parse(raw);
}

function extractFunctionHits(coverageData) {
  const results = [];
  for (const [filePath, data] of Object.entries(coverageData)) {
    if (!data || !data.fnMap || !data.f) continue;
    
    const fnMap = data.fnMap;
    const hitCounts = data.f;
    
    for (const [idx, fn] of Object.entries(fnMap)) {
      const hitCount = hitCounts[idx] || 0;
      results.push({
        filePath,
        functionName: fn.name || `anonymous_${idx}`,
        lineStart: fn.line,
        hitCount,
        traffic: classifyTraffic(hitCount),
      });
    }
  }
  return results;
}

function ingestCoverage(db, repoId, coveragePath, sourceFile = '') {
  if (!fs.existsSync(coveragePath)) {
    return { error: `Coverage file not found: ${coveragePath}` };
  }

  const coverageData = parseCoverageFile(coveragePath);
  const functions = extractFunctionHits(coverageData);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO runtime_symbols 
      (repo_id, file_path, function_name, line_start, hit_count, traffic, last_seen, source_file)
    VALUES 
      (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  const upsert = db.transaction((fnList) => {
    let inserted = 0;
    for (const fn of fnList) {
      insertStmt.run(repoId, fn.filePath, fn.functionName, fn.lineStart, fn.hitCount, fn.traffic, sourceFile);
      inserted++;
    }
    return inserted;
  });

  const inserted = upsert(functions);

  return {
    functions_ingested: inserted,
    traffic_breakdown: {
      hot: functions.filter(f => f.traffic === 'hot').length,
      warm: functions.filter(f => f.traffic === 'warm').length,
      cold: functions.filter(f => f.traffic === 'cold').length,
    },
    source_file: coveragePath,
  };
}

function getHotSymbols(db, repoId, limit = 20) {
  const rows = db.prepare(`
    SELECT rs.*, cs.qualified_name, cs.kind
    FROM runtime_symbols rs
    LEFT JOIN code_symbols cs ON cs.id = rs.symbol_id
    WHERE rs.repo_id = ? AND rs.traffic IN ('hot', 'warm')
    ORDER BY rs.hit_count DESC
    LIMIT ?
  `).all(repoId, limit);

  return rows;
}

function getColdSymbols(db, repoId, limit = 20) {
  const rows = db.prepare(`
    SELECT rs.*, cs.qualified_name, cs.kind
    FROM runtime_symbols rs
    LEFT JOIN code_symbols cs ON cs.id = rs.symbol_id
    WHERE rs.repo_id = ? AND rs.traffic = 'cold'
    ORDER BY rs.hit_count ASC
    LIMIT ?
  `).all(repoId, limit);

  return rows;
}

module.exports = {
  ingestCoverage,
  getHotSymbols,
  getColdSymbols,
  classifyTraffic,
  TRAFFIC_THRESHOLDS,
};
```

- [ ] **Step 2: Write the test**

Create `test/agent-intel/runtime-ingest.test.js`:

```js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', '..', 'memory-store.js');

function run(cmd, timeout = 30000) {
  const out = execSync(`node "${STORE}" ${cmd}`, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

function writeTmpRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function writeCoverage(coveragePath, data) {
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.writeFileSync(coveragePath, JSON.stringify(data));
}

describe('runtime ingest command', () => {
  const repoName = `test-runtime-${Date.now()}`;
  const tmpRepo = path.join('/tmp', repoName);
  const coveragePath = path.join(tmpRepo, 'coverage', 'coverage-final.json');

  beforeAll(() => {
    writeTmpRepo(tmpRepo, {
      'src/api/users.js': `
export function getUser(id) { return db.query("SELECT * FROM users WHERE id = ?", [id]); }
export function listUsers() { return db.query("SELECT * FROM users"); }
export function createUser(data) { return db.query("INSERT INTO users SET ?", [data]); }
`,
    });
    run(`index-repo --path "${tmpRepo}" --name ${repoName}`);
    
    // Write Istanbul coverage
    writeCoverage(coveragePath, {
      [`${tmpRepo}/src/api/users.js`]: {
        path: `${tmpRepo}/src/api/users.js`,
        fnMap: {
          '0': { name: 'getUser', line: 1 },
          '1': { name: 'listUsers', line: 2 },
          '2': { name: 'createUser', line: 3 },
        },
        f: { '0': 5000, '1': 150, '2': 50 },  // getUser=hot, listUsers=warm, createUser=cold
      },
    });
  }, 60000);

  afterAll(() => {
    try { run(`remove-code-repo --repo ${repoName}`); } catch {}
    try { fs.rmSync(tmpRepo, { recursive: true }); } catch {}
  });

  it('ingests Istanbul coverage JSON and classifies traffic', () => {
    const result = run(`runtime-ingest --repo ${repoName} --coverage "${coveragePath}"`);
    expect(result.error).toBeUndefined();
    expect(result.functions_ingested).toBe(3);
    expect(result.traffic_breakdown.hot).toBe(1);
    expect(result.traffic_breakdown.warm).toBe(1);
    expect(result.traffic_breakdown.cold).toBe(1);
  });

  it('returns hot symbols via hot-symbols command', () => {
    const result = run(`hot-symbols --repo ${repoName}`);
    expect(result.error).toBeUndefined();
    expect(result.hot_symbols.some(s => s.function_name === 'getUser')).toBe(true);
  });

  it('returns cold symbols via cold-symbols command', () => {
    const result = run(`cold-symbols --repo ${repoName}`);
    expect(result.error).toBeUndefined();
    expect(result.cold_symbols.some(s => s.function_name === 'createUser')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails (missing command)**

Run: `npx jest test/agent-intel/runtime-ingest.test.js --no-coverage 2>&1 | tail -20`
Expected: FAIL with "Unknown command: runtime-ingest"

- [ ] **Step 4: Register commands in CLI (intermediate step)**

In `src/cli/commands/agent-intel.js`, add:

```js
const runtimeIngest = require('../../agent-intel/runtime-ingest');

commands['runtime-ingest'] = (args) => {
  const db = deps.getDb ? deps.getDb() : deps.db;
  const repoName = args.repo;
  if (!repoName) return deps.jsonErrNoExit('Missing --repo');
  const repoRow = deps.sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) return deps.jsonErrNoExit(`Repo not found`);
  
  const coveragePath = args.coverage;
  if (!coveragePath) return deps.jsonErrNoExit('Missing --coverage <path>');
  
  return runtimeIngest.ingestCoverage(db, repoRow[0].id, coveragePath, coveragePath);
};

commands['hot-symbols'] = (args) => {
  const db = deps.getDb ? deps.getDb() : deps.db;
  const repoName = args.repo;
  if (!repoName) return deps.jsonErrNoExit('Missing --repo');
  const repoRow = deps.sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) return deps.jsonErrNoExit(`Repo not found`);
  
  return { hot_symbols: runtimeIngest.getHotSymbols(db, repoRow[0].id) };
};

commands['cold-symbols'] = (args) => {
  const db = deps.getDb ? deps.getDb() : deps.db;
  const repoName = args.repo;
  if (!repoName) return deps.jsonErrNoExit('Missing --repo');
  const repoRow = deps.sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) return deps.jsonErrNoExit(`Repo not found`);
  
  return { cold_symbols: runtimeIngest.getColdSymbols(db, repoRow[0].id) };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/agent-intel/runtime-ingest.test.js --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent-intel/runtime-ingest.js test/agent-intel/runtime-ingest.test.js src/cli/commands/agent-intel.js
git commit -m "feat(runtime): add Istanbul coverage ingestion with hot/cold symbol classification"
```

---

### Task 3: Blast Radius Command

A dedicated `lapis blast <symbol>` command that provides blast-radius analysis with runtime weighting.

**Files:**
- Create: `src/agent-intel/blast.js`
- Test: `test/agent-intel/blast.test.js`

- [ ] **Step 1: Write the blast module**

Create `src/agent-intel/blast.js`:

```js
// Module boundary:
// Computes blast radius for a symbol: direct/transitive callers, affected routes, tests, and risk score.
// Wraps existing call-graph analysis with a simpler interface and runtime weighting.

function blastRadius(db, repoId, symbolName, options = {}) {
  const { includeRuntime = true } = options;
  
  // Find the symbol
  const symbolRow = db.prepare(`
    SELECT id, name, qualified_name, kind, file_path
    FROM code_symbols
    WHERE repo_id = ? AND (name = ? OR qualified_name = ?)
    LIMIT 1
  `).get(repoId, symbolName, symbolName);

  if (!symbolRow) {
    return { error: `Symbol not found: ${symbolName}` };
  }

  // Direct callers
  const directCallers = db.prepare(`
    SELECT DISTINCT cs.id, cs.name, cs.qualified_name, cs.kind, cs.file_path
    FROM code_calls cc
    JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
    WHERE cc.repo_id = ? AND cc.callee_symbol_id = ?
  `).all(repoId, symbolRow.id);

  // Transitive callers (2 hops)
  const transitiveCallers = db.prepare(`
    SELECT DISTINCT cs2.id, cs2.name, cs2.qualified_name, cs2.kind, cs2.file_path
    FROM code_calls cc1
    JOIN code_symbols cs1 ON cs1.id = cc1.caller_symbol_id
    JOIN code_calls cc2 ON cc2.callee_symbol_id = cs1.id
    JOIN code_symbols cs2 ON cs2.id = cc2.caller_symbol_id
    WHERE cc1.repo_id = ? AND cc1.callee_symbol_id = ?
      AND cs2.id != ?
  `).all(repoId, symbolRow.id, symbolRow.id);

  // Tests that likely call this symbol
  const likelyTests = db.prepare(`
    SELECT DISTINCT cf.path
    FROM code_files cf
    WHERE cf.repo_id = ?
      AND (LOWER(cf.path) LIKE '%test%' OR LOWER(cf.path) LIKE '%spec%')
      AND cf.path LIKE ?
    LIMIT 20
  `).all(repoId, `%${symbolRow.name}%`);

  // Docs that reference this symbol
  const docsWithSymbol = db.prepare(`
    SELECT title, file_path
    FROM doc_sections
    WHERE repo_id = ? AND (content LIKE ? OR heading LIKE ?)
    LIMIT 10
  `).all(repoId, `%${symbolRow.name}%`, `%${symbolRow.name}%`);

  // Runtime hotness (if available)
  let runtime = null;
  if (includeRuntime) {
    const runtimeData = db.prepare(`
      SELECT hit_count, traffic, last_seen
      FROM runtime_symbols
      WHERE repo_id = ? AND symbol_id = ?
    `).get(repoId, symbolRow.id);

    if (runtimeData) {
      runtime = {
        hit_count: runtimeData.hit_count,
        traffic: runtimeData.traffic,
        last_seen: runtimeData.last_seen,
      };
    }
  }

  // Compute risk based on blast + runtime
  const totalCallers = directCallers.length + transitiveCallers.length;
  let risk = 'low';
  let riskScore = 0;

  if (totalCallers >= 20) {
    risk = 'critical';
    riskScore = 90;
  } else if (totalCallers >= 10) {
    risk = 'high';
    riskScore = 70;
  } else if (totalCallers >= 5) {
    risk = 'medium';
    riskScore = 40;
  }

  // Upgrade risk if hot runtime
  if (runtime && runtime.traffic === 'hot' && risk !== 'critical') {
    risk = risk === 'low' ? 'medium' : risk === 'medium' ? 'high' : 'critical';
    riskScore = Math.min(100, riskScore + 20);
  }

  const reason = runtime && runtime.traffic === 'hot'
    ? `Hot runtime path with ${totalCallers} total callers.`
    : `${totalCallers} total callers (${directCallers.length} direct, ${transitiveCallers.length} transitive).`;

  return {
    symbol: symbolRow.name,
    qualified_name: symbolRow.qualified_name,
    file: symbolRow.file_path,
    kind: symbolRow.kind,
    direct_callers: directCallers.length,
    transitive_callers: transitiveCallers.length,
    total_callers: totalCallers,
    routes_affected: likelyTests.length > 0 ? ['(inferred from test files)'] : [],
    tests_likely_affected: likelyTests.map(t => t.path),
    docs_affected: docsWithSymbol.map(d => d.file_path),
    runtime,
    risk,
    risk_score: riskScore,
    reason,
  };
}

module.exports = { blastRadius };
```

- [ ] **Step 2: Write the test**

Create `test/agent-intel/blast.test.js`:

```js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', '..', 'memory-store.js');

function run(cmd, timeout = 30000) {
  const out = execSync(`node "${STORE}" ${cmd}`, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

function writeTmpRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

describe('blast command', () => {
  const repoName = `test-blast-${Date.now()}`;
  const tmpRepo = path.join('/tmp', repoName);

  beforeAll(() => {
    writeTmpRepo(tmpRepo, {
      'src/core.js': `
export function criticalFunction() { return db.query("SELECT 1"); }
export function helper() { return "helper"; }
`,
      'src/handlers/api.js': `
import { criticalFunction } from '../core.js';
export function handleApi() { criticalFunction(); }
`,
      'src/handlers/admin.js': `
import { criticalFunction } from '../core.js';
export function handleAdmin() { criticalFunction(); }
`,
      'test/core.test.js': `
import { criticalFunction } from '../src/core.js';
test('core', () => { criticalFunction(); });
`,
    });
    run(`index-repo --path "${tmpRepo}" --name ${repoName}`);
  }, 60000);

  afterAll(() => {
    try { run(`remove-code-repo --repo ${repoName}`); } catch {}
    try { fs.rmSync(tmpRepo, { recursive: true }); } catch {}
  });

  it('returns blast radius for a symbol', () => {
    const result = run(`blast --repo ${repoName} --symbol criticalFunction`);
    expect(result.error).toBeUndefined();
    expect(result.symbol).toBe('criticalFunction');
    expect(result.direct_callers).toBeGreaterThanOrEqual(2);
    expect(['low', 'medium', 'high', 'critical']).toContain(result.risk);
    expect(result.tests_likely_affected.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for non-existent symbol', () => {
    const result = run(`blast --repo ${repoName} --symbol NonExistentFunctionXYZ`);
    expect(result.error).toContain('not found');
  });
});
```

- [ ] **Step 3: Register the blast command in CLI**

In `src/cli/commands/agent-intel.js`, add:

```js
const blastModule = require('../../agent-intel/blast');

commands.blast = (args) => {
  const db = deps.getDb ? deps.getDb() : deps.db;
  const repoName = args.repo;
  if (!repoName) return deps.jsonErrNoExit('Missing --repo');
  const repoRow = deps.sqlJson('SELECT id FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) return deps.jsonErrNoExit(`Repo not found`);
  
  const symbolName = args.symbol;
  if (!symbolName) return deps.jsonErrNoExit('Missing --symbol <name>');
  
  return blastModule.blastRadius(db, repoRow[0].id, symbolName);
};
```

Also add `blast` to the USAGE object:

```js
const USAGE = {
  // ... existing entries
  blast: '--repo X --symbol <function-name>',
};
```

- [ ] **Step 4: Run tests to verify**

Run: `npx jest test/agent-intel/blast.test.js --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-intel/blast.js test/agent-intel/blast.test.js src/cli/commands/agent-intel.js
git commit -m "feat(blast): add dedicated blast-radius command with runtime weighting"
```

---

### Task 4: Stale Flags Detection

Detect one-sided branches in source code (always-true/always-false conditions).

**Files:**
- Create: `src/agent-intel/stale-flags.js`
- Test: `test/agent-intel/stale-flags.test.js`

- [ ] **Step 1: Write the stale-flags module**

Create `src/agent-intel/stale-flags.js`:

```js
// Module boundary:
// Scans source code for stale feature flags (one-sided branches).
// A one-sided branch is an if/ternary where one side is always executed.

const fs = require('fs');
const path = require('path');

// Patterns that indicate stale flags:
// 1. if (true) / if (false)
// 2. if (process.env.NODE_ENV === 'development') inside non-dev code
// 3. Feature flags checked but never toggled
// 4. Constant conditions in if statements

const STALE_FLAG_PATTERNS = [
  /\bif\s*\(\s*true\s*\)/gi,
  /\bif\s*\(\s*false\s*\)/gi,
  /\bif\s*\(\s*![^()]+\s*\)\s*\{[^}]*\}\s*else\s*\{/g,  // if (!x) { } else { always runs }
  /FEATURE_[A-Z_]+\s*===\s*['"](?:enabled?|on|true)['"]/gi,
  /FEATURE_[A-Z_]+\s*!==\s*['"](?:disabled?|off|false)['"]/gi,
];

const ALWAYS_TRUE_CONTEXT = [
  'process.env.NODE_ENV',
  'process.env.DEBUG',
  'process.env.TESTING',
];

function scanFileForStaleFlags(filePath) {
  if (!fs.existsSync(filePath)) return [];
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings = [];

  // Pattern-based detection
  for (const pattern of STALE_FLAG_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';
      
      findings.push({
        filePath,
        lineNumber: lineNum,
        type: 'constant_condition',
        context: line.substring(0, 100),
      });
    }
  }

  // Check for one-sided ternaries: condition ? expr : expr (where expr is same)
  const ternaryRegex = /(\w+)\s*\?\s*(\w+)\s*:\s*\w+/g;
  let match;
  while ((match = ternaryRegex.exec(content)) !== null) {
    const [, condition, truthyResult] = match;
    // Check if the condition looks like a flag constant
    if (ALWAYS_TRUE_CONTEXT.some(c => condition.includes(c))) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';
      
      findings.push({
        filePath,
        lineNumber: lineNum,
        type: 'likely_stale_flag',
        context: line.substring(0, 100),
      });
    }
  }

  return findings;
}

function detectStaleFlagsInRepo(db, repoId, repoPath) {
  // Get all JS/TS files
  const files = db.prepare(`
    SELECT path FROM code_files
    WHERE repo_id = ? AND (path LIKE '%.js' OR path LIKE '%.ts')
  `).all(repoId);

  const allFindings = [];
  
  for (const { path: filePath } of files) {
    // Resolve relative to repo path
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
    const findings = scanFileForStaleFlags(fullPath);
    
    for (const f of findings) {
      allFindings.push({
        repo_id: repoId,
        file_path: f.filePath,
        line_number: f.lineNumber,
        flag_name: f.context.match(/FEATURE_\w+/)?.[0] || extractCondition(f.context),
        branch_type: f.type === 'constant_condition' && f.context.includes('false') ? 'always-false' : 'always-true',
        context: f.context,
      });
    }
  }

  return allFindings;
}

function extractCondition(context) {
  const match = context.match(/if\s*\(\s*([^)]+)\s*\)/);
  return match ? match[1].trim() : context.substring(0, 50);
}

function persistStaleFlags(db, findings) {
  if (findings.length === 0) return { inserted: 0 };

  const insert = db.prepare(`
    INSERT INTO stale_flags (repo_id, file_path, line_number, flag_name, branch_type, context)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((items) => {
    let count = 0;
    for (const f of items) {
      try {
        insert.run(f.repo_id, f.file_path, f.line_number, f.flag_name, f.branch_type, f.context);
        count++;
      } catch {
        // Skip duplicates
      }
    }
    return count;
  });

  return { inserted: tx(findings) };
}

function getStaleFlags(db, repoId) {
  return db.prepare(`
    SELECT * FROM stale_flags WHERE repo_id = ? ORDER BY file_path, line_number
  `).all(repoId);
}

module.exports = {
  scanFileForStaleFlags,
  detectStaleFlagsInRepo,
  persistStaleFlags,
  getStaleFlags,
  STALE_FLAG_PATTERNS,
};
```

- [ ] **Step 2: Write the test**

Create `test/agent-intel/stale-flags.test.js`:

```js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', '..', 'memory-store.js');

function run(cmd, timeout = 30000) {
  const out = execSync(`node "${STORE}" ${cmd}`, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

function writeTmpRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

describe('stale flags command', () => {
  const repoName = `test-stale-${Date.now()}`;
  const tmpRepo = path.join('/tmp', repoName);

  beforeAll(() => {
    writeTmpRepo(tmpRepo, {
      'src/feature.js': `
// Stale: always-true condition
if (true) {
  console.log('always runs');
}

// Stale: feature flag never toggled
if (process.env.FEATURE_NEW_DASHBOARD === 'enabled') {
  renderNewDashboard();
} else {
  renderOldDashboard();
}

// Normal code
function normalFunc() { return true; }
`,
    });
    run(`index-repo --path "${tmpRepo}" --name ${repoName}`);
  }, 60000);

  afterAll(() => {
    try { run(`remove-code-repo --repo ${repoName}`); } catch {}
    try { fs.rmSync(tmpRepo, { recursive: true }); } catch {}
  });

  it('detects stale flags in repository', () => {
    const result = run(`stale-flags --repo ${repoName}`);
    expect(result.error).toBeUndefined();
    expect(result.stale_flags.length).toBeGreaterThanOrEqual(1);
    expect(result.stale_flags.some(f => f.branch_type === 'always-true')).toBe(true);
  });

  it('returns empty for clean repo', () => {
    // Create a clean repo
    const cleanRepoName = `test-clean-${Date.now()}`;
    const cleanTmp = path.join('/tmp', cleanRepoName);
    writeTmpRepo(cleanTmp, { 'src/util.js': 'export function add(a, b) { return a + b; }' });
    run(`index-repo --path "${cleanTmp}" --name ${cleanRepoName}`);
    
    const result = run(`stale-flags --repo ${cleanRepoName}`);
    expect(result.stale_flags.length).toBe(0);
    
    try { run(`remove-code-repo --repo ${cleanRepoName}`); } catch {}
    try { fs.rmSync(cleanTmp, { recursive: true }); } catch {}
  });
});
```

- [ ] **Step 3: Register stale-flags command in CLI**

In `src/cli/commands/agent-intel.js`, add:

```js
const staleFlags = require('../../agent-intel/stale-flags');

commands['stale-flags'] = (args) => {
  const db = deps.getDb ? deps.getDb() : deps.db;
  const repoName = args.repo;
  if (!repoName) return deps.jsonErrNoExit('Missing --repo');
  const repoRow = deps.sqlJson('SELECT id, path FROM code_repos WHERE name = ?', [repoName]);
  if (!repoRow.length) return deps.jsonErrNoExit(`Repo not found`);
  
  // Detect and persist
  const findings = staleFlags.detectStaleFlagsInRepo(db, repoRow[0].id, repoRow[0].path);
  staleFlags.persistStaleFlags(db, findings);
  
  return { stale_flags: findings };
};
```

- [ ] **Step 4: Run tests to verify**

Run: `npx jest test/agent-intel/stale-flags.test.js --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-intel/stale-flags.js test/agent-intel/stale-flags.test.js src/cli/commands/agent-intel.js
git commit -m "feat(stale-flags): add detection for one-sided branches and constant conditions"
```

---

### Task 5: Integrate Runtime Data into Preflight

Enrich preflight output with runtime hotness data.

**Files:**
- Modify: `src/agent-intel/preflight.js`

- [ ] **Step 1: Add runtime enrichment to preflight**

In `src/agent-intel/preflight.js`, after the existing code search and enrichment (around line 300), add:

```js
// Enrich with runtime data if available
let runtimeHotness = null;
try {
  const runtimeIngest = require('./runtime-ingest');
  const hotSymbols = runtimeIngest.getHotSymbols(db, repo.id, 50);
  
  // Check if any of the top code items are hot paths
  const topFiles = codeItems.slice(0, 3).map(item => item.file);
  const hotMatches = hotSymbols.filter(s => topFiles.some(f => s.file_path && s.file_path.includes(f)));
  
  if (hotMatches.length > 0) {
    runtimeHotness = {
      is_hot_path: true,
      hot_matches: hotMatches.slice(0, 3).map(s => ({
        symbol: s.function_name,
        file: s.file_path,
        traffic: s.traffic,
        hit_count: s.hit_count,
      })),
    };
  }
} catch {
  // Runtime data not available — graceful degradation
}
```

Then in the return statement, add `runtime_hotness` to the output:

```js
return {
  task_summary: task,
  repo: repoName,
  likely_existing_code: enrichedCodeItems,
  similar_past_tasks: memories,
  related_files: relatedFiles,
  tests_likely_affected: likelyTests,
  relevant_docs: docs,
  duplicate_risk: duplicateRisk,
  duplicate_warnings: warnings,
  structural_duplicates: structuralDuplicates,
  runtime_hotness: runtimeHotness,  // NEW
  risk,
  recommended_action: recommendedAction(risk, warnings, codeItems),
  // ... existing evidence
};
```

- [ ] **Step 2: Update risk calculation to consider runtime**

Modify the `riskLevel` function to upgrade risk for hot paths:

```js
function riskLevel({ codeItems, memories, warnings, relatedFiles, runtimeHotness }) {
  let baseRisk = 'low';
  
  if (warnings.length >= 2 || codeItems.length >= 5) {
    baseRisk = 'high';
  } else if (warnings.length || codeItems.length >= 2 || memories.length || relatedFiles.length >= 4) {
    baseRisk = 'medium';
  }

  // Upgrade risk if touching hot paths
  if (runtimeHotness && runtimeHotness.is_hot_path && baseRisk === 'low') {
    baseRisk = 'medium';
  } else if (runtimeHotness && runtimeHotness.is_hot_path && baseRisk === 'medium') {
    baseRisk = 'high';
  }

  return baseRisk;
}
```

- [ ] **Step 3: Verify tests still pass**

Run: `npx jest test/agent-preflight.test.js --no-coverage 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/agent-intel/preflight.js
git commit -m "feat(preflight): enrich with runtime hotness data and upgrade risk for hot paths"
```

---

### Task 6: Integrate Runtime into Audit-Diff

Consider runtime hotness when scoring violations.

**Files:**
- Modify: `src/agent-intel/audit-diff.js`

- [ ] **Step 1: Upgrade violation scores for hot paths**

In `audit-diff.js`, modify the `_checkHotPath` function to return the actual hot path info:

```js
function _checkHotPath(db, repoId, sym) {
  const callers = db
    .prepare(`SELECT COUNT(DISTINCT caller_symbol_id) as cnt FROM code_calls WHERE repo_id = ? AND callee_name = ?`)
    .get(repoId, sym.name);
  
  // Check runtime hotness
  let traffic = null;
  try {
    const runtimeIngest = require('./runtime-ingest');
    const hotSymbols = runtimeIngest.getHotSymbols(db, repoId, 100);
    const match = hotSymbols.find(s => s.file_path === sym.file);
    if (match) {
      traffic = match.traffic;
    }
  } catch {
    // Runtime data not available
  }

  if (traffic === 'hot') {
    return {
      is_hot_path: true,
      traffic,
      message: `Editing hot runtime path (${match.hit_count} hits) — prefer minimal diffs and add tests.`,
      score: 30,
    };
  }

  if (callers && callers.cnt >= 5) {
    return {
      is_hot_path: false,
      traffic,
      message: `${callers.cnt} callers — check blast radius before editing.`,
      score: callers.cnt >= 10 ? 20 : 10,
    };
  }

  return null;
}
```

- [ ] **Step 2: Run existing tests**

Run: `npx jest test/agent-intel/audit-diff.test.js --no-coverage 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent-intel/audit-diff.js
git commit -m "feat(audit-diff): upgrade violation scores for hot runtime paths"
```

---

### Task 7: End-to-End Runtime Integration Test

Verify the full runtime loop: ingest → preflight sees hot → audit-diff warns.

**Files:**
- Create: `test/agent-intel/e2e-runtime.test.js`

- [ ] **Step 1: Write the integration test**

Create `test/agent-intel/e2e-runtime.test.js`:

```js
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE = path.resolve(__dirname, '..', '..', 'memory-store.js');

function run(cmd, timeout = 45000) {
  const out = execSync(`node "${STORE}" ${cmd}`, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

function writeTmpRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function writeCoverage(coveragePath, data) {
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.writeFileSync(coveragePath, JSON.stringify(data));
}

describe('runtime reality e2e', () => {
  const repoName = `test-e2e-runtime-${Date.now()}`;
  const tmpRepo = path.join('/tmp', repoName);
  const coveragePath = path.join(tmpRepo, 'coverage', 'coverage-final.json');

  beforeAll(() => {
    writeTmpRepo(tmpRepo, {
      'src/critical.js': `
export function processPayment(amount) {
  return db.query("INSERT INTO payments VALUES (?)", [amount]);
}`,
      'src/batch.js': `
import { processPayment } from './critical.js';
export function batchProcess(items) {
  return items.map(processPayment);
}`,
    });
    run(`index-repo --path "${tmpRepo}" --name ${repoName}`);
    
    // Write coverage: processPayment is hot
    writeCoverage(coveragePath, {
      [`${tmpRepo}/src/critical.js`]: {
        path: `${tmpRepo}/src/critical.js`,
        fnMap: { '0': { name: 'processPayment', line: 1 } },
        f: { '0': 15000 },  // hot
      },
    });
    
    // Ingest coverage
    run(`runtime-ingest --repo ${repoName} --coverage "${coveragePath}"`);
  }, 90000);

  afterAll(() => {
    try { run(`remove-code-repo --repo ${repoName}`); } catch {}
    try { fs.rmSync(tmpRepo, { recursive: true }); } catch {}
  });

  it('preflight shows runtime hotness for hot paths', () => {
    const result = run(`preflight --repo ${repoName} --task "process payment"`);
    expect(result.error).toBeUndefined();
    expect(result.runtime_hotness).not.toBeNull();
    expect(result.runtime_hotness.is_hot_path).toBe(true);
  });

  it('preflight upgrades risk for hot paths', () => {
    const result = run(`preflight --repo ${repoName} --task "process payment"`);
    // Hot path should upgrade risk
    expect(['medium', 'high']).toContain(result.risk);
  });

  it('blast command shows runtime data', () => {
    const result = run(`blast --repo ${repoName} --symbol processPayment`);
    expect(result.error).toBeUndefined();
    expect(result.runtime).not.toBeNull();
    expect(result.runtime.traffic).toBe('hot');
    expect(result.risk).toBe('high');  // Hot + callers
  });

  it('stale-flags command works', () => {
    // Add stale flag to repo
    const flagFile = path.join(tmpRepo, 'src', 'flags.js');
    fs.writeFileSync(flagFile, `if (process.env.FEATURE_OLD_CODE === 'enabled') { legacy(); }`);
    run(`index-repo --path "${tmpRepo}" --name ${repoName}`);
    
    const result = run(`stale-flags --repo ${repoName}`);
    expect(result.stale_flags.length).toBeGreaterThanOrEqual(1);
    
    fs.unlinkSync(flagFile);
  });
});
```

- [ ] **Step 2: Run all runtime tests**

Run: `npx jest test/agent-intel/ --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/agent-intel/e2e-runtime.test.js
git commit -m "test(e2e): integration test for runtime reality loop"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec requirement | Task |
|---|---|
| `lapis runtime ingest` | Task 2 |
| `lapis blast` | Task 3 |
| `lapis stale-flags` | Task 4 |
| Hot/cold path ranking | Task 2 + Task 5 |
| Runtime-weighted risk | Task 5 + Task 6 |
| Stale flag detection | Task 4 |
| Preflight with runtime | Task 5 |
| Audit-diff with runtime | Task 6 |

### 2. Placeholder Scan

No TBD, TODO, or placeholder patterns found. Every step has complete code.

### 3. Type Consistency

- `ingestCoverage` returns `{ functions_ingested, traffic_breakdown, source_file }`
- `blastRadius` returns `{ symbol, direct_callers, transitive_callers, runtime, risk, ... }`
- `getHotSymbols` / `getColdSymbols` return array of symbol objects
- All CLI commands use consistent parameter names (`--repo`, `--coverage`, `--symbol`)

---

## Execution Order

1. **Task 1** (Schema) — Foundation, must be first
2. **Task 2** (Runtime Ingest) — Core feature
3. **Task 3** (Blast Command) — Independent feature
4. **Task 4** (Stale Flags) — Independent feature
5. **Task 5** (Preflight Integration) — Depends on Task 2
6. **Task 6** (Audit-Diff Integration) — Depends on Task 2
7. **Task 7** (E2E Test) — Depends on all

---

## Summary

This plan completes Phase 5 (Runtime Reality) from the original spec:

- ✅ **Coverage ingest** — Istanbul JSON → SQLite runtime_symbols
- ✅ **Hot/cold ranking** — `hot-symbols`, `cold-symbols` commands
- ✅ **Blast radius** — `blast <symbol>` with runtime weighting
- ✅ **Stale flags** — One-sided branch detection
- ✅ **Preflight integration** — Runtime hotness in preflight output
- ✅ **Audit-diff integration** — Hot path risk upgrade

Combined with the existing June 4 plan (dupes, audit-diff, enrichment), this completes the LaPis coding consistency engine.
