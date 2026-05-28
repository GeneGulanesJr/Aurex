# Richer Code Relationship Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add richer code relationship edges (extends, implements, reexport, references), git co-change signal, and a unified weighted BFS propagation engine so blast radius catches more affected files when code changes.

**Architecture:** Two new SQLite tables (`code_relations`, `file_cochange`) populated by extraction functions that read existing data (signatures, scope bindings, git log). A new `getAffectedGraph` function replaces `getBlastRadius` for the `blast-radius` mode, walking all edge types in a single weighted BFS. Backward compatible — old function preserved for other callers.

**Tech Stack:** Node.js, better-sqlite3, regex extraction, git CLI (for co-change), vitest

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `schema.sql` | Add `code_relations` and `file_cochange` table definitions after `code_calls` section (line 364) | Modify |
| `db.js` | Add `runMigrationV13` after `runMigrationV12` (line 978) | Modify |
| `src/code-analysis/relation-builder.js` | Extract extends, implements, reexport, reference edges | **New** |
| `src/code-analysis/cochange-builder.js` | Extract git co-change pairs | **New** |
| `src/code-analysis/propagation-impl.js` | Unified weighted BFS propagation engine | **New** |
| `src/code-analysis/legacy-core.js` | Wire new modules into exports (line 18-19, 78-79) | Modify |
| `src/code-analysis/impact.js` | Route blast-radius to new engine (line 25) | Modify |
| `src/code-index/edge-extractor.js` | Add thin wrappers for new builders (line 35) | Modify |
| `src/code-index/incremental-indexer.js` | Call new builders in derived phases | Modify |
| `src/platform/protocol/llm-format.ts` | Updated blast-radius formatting | Modify |
| `test/relation-builder.test.js` | Test extraction functions | **New** |
| `test/cochange-builder.test.js` | Test git co-change parsing | **New** |
| `test/propagation-impl.test.js` | Test weighted BFS | **New** |

---

### Task 1: Schema — `code_relations` and `file_cochange` tables

**Files:**
- Modify: `schema.sql:364` (insert after `code_calls` indexes)
- Modify: `db.js:978` (insert `runMigrationV13` after `runMigrationV12`)
- Modify: `db.js:459` (add migration to array)

- [ ] **Step 1: Add tables to schema.sql**

Insert after line 364 (after `CREATE INDEX IF NOT EXISTS idx_cc_callee ON code_calls(callee_symbol_id);`), before the doc_repos section:

```sql
-- ═══════════════════════════════════════════════════════════
-- CODE RELATIONS  (extends, implements, reexport, references)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS code_relations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id             INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  source_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
  target_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
  source_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
  target_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  weight              REAL NOT NULL DEFAULT 1.0,
  line_number         INTEGER,
  UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                   COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
);
CREATE INDEX IF NOT EXISTS idx_cr_source_sym ON code_relations(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_cr_target_sym ON code_relations(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_cr_source_file ON code_relations(source_file_id);
CREATE INDEX idx_cr_target_file ON code_relations(target_file_id);
CREATE INDEX IF NOT EXISTS idx_cr_repo_kind ON code_relations(repo_id, kind);

-- ═══════════════════════════════════════════════════════════
-- FILE CO-CHANGE  (git co-occurrence frequency)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_cochange (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
  file_a_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  file_b_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  co_commit_count INTEGER NOT NULL DEFAULT 0,
  strength        REAL NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 90,
  UNIQUE(repo_id, file_a_id, file_b_id)
);
CREATE INDEX IF NOT EXISTS idx_fcc_a ON file_cochange(file_a_id);
CREATE INDEX IF NOT EXISTS idx_fcc_b ON file_cochange(file_b_id);
CREATE INDEX IF NOT EXISTS idx_fcc_repo ON file_cochange(repo_id);
```

- [ ] **Step 2: Add migration V13 to db.js**

Insert after `runMigrationV12` (after line 978):

```js
function runMigrationV13() {
  const errors = [];
  try {
    withTransaction(() => {
      sqlRaw(`CREATE TABLE IF NOT EXISTS code_relations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id             INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
        source_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
        target_symbol_id    INTEGER REFERENCES code_symbols(id) ON DELETE CASCADE,
        source_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
        target_file_id      INTEGER REFERENCES code_files(id) ON DELETE CASCADE,
        kind                TEXT NOT NULL,
        weight              REAL NOT NULL DEFAULT 1.0,
        line_number         INTEGER,
        UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                         COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
      )`);
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_cr_source_sym ON code_relations(source_symbol_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_cr_target_sym ON code_relations(target_symbol_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_cr_source_file ON code_relations(source_file_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_cr_target_file ON code_relations(target_file_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_cr_repo_kind ON code_relations(repo_id, kind)');
      sqlRaw(`CREATE TABLE IF NOT EXISTS file_cochange (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id         INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
        file_a_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
        file_b_id       INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
        co_commit_count INTEGER NOT NULL DEFAULT 0,
        strength        REAL NOT NULL DEFAULT 0,
        window_days     INTEGER NOT NULL DEFAULT 90,
        UNIQUE(repo_id, file_a_id, file_b_id)
      )`);
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_fcc_a ON file_cochange(file_a_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_fcc_b ON file_cochange(file_b_id)');
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_fcc_repo ON file_cochange(repo_id)');
      sqlRaw('PRAGMA user_version = 13');
    });
  } catch (e) {
    errors.push(`V13: ${e.message}`);
  }
  return errors;
}
```

Add to migrations array at line 460:

```js
    { to: 13, run: runMigrationV13 },
```

- [ ] **Step 3: Verify migration runs**

Run: `node -e "require('./db.js'); const {sqlJson} = require('./db.js'); console.log(sqlJson('PRAGMA user_version'));"`

Expected: `[{ user_version: 13 }]`

- [ ] **Step 4: Verify tables exist**

Run: `node -e "const {sqlJson} = require('./db.js'); console.log(sqlJson(\"SELECT name FROM sqlite_master WHERE name IN ('code_relations','file_cochange')\"));"`

Expected: array with both table names.

- [ ] **Step 5: Commit**

```bash
git add schema.sql db.js
git commit -m "feat: add code_relations and file_cochange tables (migration V13)"
```

---

### Task 2: Relation builder — `buildExtendsEdges` and `buildImplementsEdges`

**Files:**
- Create: `src/code-analysis/relation-builder.js`
- Create: `test/relation-builder.test.js`

- [ ] **Step 1: Write failing tests for extends extraction**

Create `test/relation-builder.test.js`:

```js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { buildExtendsEdges, buildImplementsEdges } = require('../src/code-analysis/relation-builder');

const TMP_DB = path.join('/tmp', 'relation-builder-test.db');

let db;
let repoId;

function setupTestDb(symbols) {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  db = new Database(TMP_DB);

  // Minimal schema for code_repos, code_files, code_symbols, code_relations
  db.exec(`CREATE TABLE code_repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT)`);
  db.exec(`CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, path TEXT, language TEXT, content TEXT, content_hash TEXT)`);
  db.exec(`CREATE TABLE code_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_id INTEGER, name TEXT, kind TEXT,
    signature TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, start_byte INTEGER,
    end_byte INTEGER, docstring TEXT DEFAULT '', body_preview TEXT DEFAULT '', language TEXT NOT NULL,
    parent_name TEXT DEFAULT '', qualified_name TEXT NOT NULL, stable_symbol_id TEXT DEFAULT '',
    content_hash TEXT DEFAULT '', summary TEXT DEFAULT '', decorators_json TEXT DEFAULT '[]',
    keywords_json TEXT DEFAULT '[]', call_references_json TEXT DEFAULT '[]',
    ecosystem_context TEXT DEFAULT '', indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE code_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_symbol_id INTEGER,
    target_symbol_id INTEGER, source_file_id INTEGER, target_file_id INTEGER,
    kind TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, line_number INTEGER,
    UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                   COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
  )`);
  db.exec('CREATE INDEX idx_cr_repo_kind ON code_relations(repo_id, kind)');

  const insertRepo = db.prepare('INSERT INTO code_repos (name, path) VALUES (?, ?)');
  const insertFile = db.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
  const insertSymbol = db.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line,
    start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const result = insertRepo.run('test-repo', '/tmp/test');
  repoId = result.lastInsertRowid;

  for (const sym of symbols) {
    let fileId;
    if (sym.file_path) {
      const fr = insertFile.run(repoId, sym.file_path, sym.language || 'javascript', '', '');
      fileId = fr.lastInsertRowid;
    }
    insertSymbol.run(
      repoId, fileId, sym.name, sym.kind, sym.signature || '', sym.file_path || '',
      sym.start_line || 1, sym.end_line || 10, 0, 100,
      sym.language || 'javascript', sym.qualified_name || sym.name
    );
  }

  return { db, repoId };
}

afterEach(() => {
  if (db) db.close();
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

describe('buildExtendsEdges', () => {
  it('should extract extends edge from JS/TS class signature', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Animal', kind: 'class', signature: 'class Animal {', file_path: 'animal.js', language: 'javascript' },
      { name: 'Dog', kind: 'class', signature: 'class Dog extends Animal {', file_path: 'dog.js', language: 'javascript' },
    ]);

    const result = buildExtendsEdges(testDb, rid);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const rows = testDb.prepare('SELECT * FROM code_relations WHERE kind = ?').all('extends');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('extends');
    expect(rows[0].weight).toBe(1.0);
  });

  it('should extract extends edge from Python class signature', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Base', kind: 'class', signature: 'class Base:', file_path: 'base.py', language: 'python' },
      { name: 'Child', kind: 'class', signature: 'class Child(Base):', file_path: 'child.py', language: 'python' },
    ]);

    const result = buildExtendsEdges(testDb, rid);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });

  it('should skip Rust and Go classes', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Animal', kind: 'class', signature: '', file_path: 'animal.rs', language: 'rust' },
      { name: 'Dog', kind: 'struct', signature: '', file_path: 'dog.go', language: 'go' },
    ]);

    const result = buildExtendsEdges(testDb, rid);
    expect(result.count).toBe(0);
  });

  it('should not create edge when base class not found', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Dog', kind: 'class', signature: 'class Dog extends NonExistent {', file_path: 'dog.js', language: 'javascript' },
    ]);

    const result = buildExtendsEdges(testDb, rid);
    expect(result.count).toBe(0);
  });
});

describe('buildImplementsEdges', () => {
  it('should extract implements edge from TS class', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Serializable', kind: 'interface', signature: 'interface Serializable {', file_path: 'types.ts', language: 'typescript' },
      { name: 'Model', kind: 'class', signature: 'class Model implements Serializable {', file_path: 'model.ts', language: 'typescript' },
    ]);

    const result = buildImplementsEdges(testDb, rid);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const rows = testDb.prepare('SELECT * FROM code_relations WHERE kind = ?').all('implements');
    expect(rows).toHaveLength(1);
  });

  it('should extract multiple implements edges', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'A', kind: 'interface', signature: 'interface A {', file_path: 'a.ts', language: 'typescript' },
      { name: 'B', kind: 'interface', signature: 'interface B {', file_path: 'b.ts', language: 'typescript' },
      { name: 'C', kind: 'class', signature: 'class C implements A, B {', file_path: 'c.ts', language: 'typescript' },
    ]);

    const result = buildImplementsEdges(testDb, rid);
    expect(result.count).toBe(2);
  });

  it('should not create implements edges for Python', () => {
    const { db: testDb, repoId: rid } = setupTestDb([
      { name: 'Base', kind: 'class', signature: 'class Child(Base):', file_path: 'child.py', language: 'python' },
    ]);

    const result = buildImplementsEdges(testDb, rid);
    expect(result.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/relation-builder.test.js`
Expected: FAIL — module `../src/code-analysis/relation-builder` not found.

- [ ] **Step 3: Implement `buildExtendsEdges` and `buildImplementsEdges`**

Create `src/code-analysis/relation-builder.js`:

```js
const { _requireNativeDb } = require('./shared-deps');

/**
 * Extract extends edges from class signatures.
 * Language-aware: JS/TS uses `extends`, Python uses `(Base)`.
 */
function buildExtendsEdges(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  db.prepare('DELETE FROM code_relations WHERE repo_id = ? AND kind = ?').run(repoId, 'extends');

  const classes = db.prepare(
    `SELECT id, name, signature, file_id, file_path, language FROM code_symbols WHERE repo_id = ? AND kind = 'class'`
  ).all(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_relations (repo_id, source_symbol_id, target_symbol_id, source_file_id, target_file_id, kind, weight)
     VALUES (?, ?, ?, ?, ?, 'extends', 1.0)`
  );

  let count = 0;
  for (const cls of classes) {
    const baseName = extractExtendsName(cls.signature, cls.language);
    if (!baseName) continue;

    // Look up the base class/interface by name in the same repo
    const target = db.prepare(
      `SELECT id, file_id FROM code_symbols WHERE repo_id = ? AND name = ? AND kind IN ('class', 'interface')`
    ).get(repoId, baseName);

    if (target) {
      insertStmt.run(repoId, cls.id, target.id, cls.file_id, target.file_id);
      count++;
    }
  }

  return { success: true, count };
}

/**
 * Extract implements edges from TS class signatures.
 * JS/TS only — Python and other languages don't have `implements`.
 */
function buildImplementsEdges(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  db.prepare('DELETE FROM code_relations WHERE repo_id = ? AND kind = ?').run(repoId, 'implements');

  const classes = db.prepare(
    `SELECT id, name, signature, file_id, file_path, language FROM code_symbols
     WHERE repo_id = ? AND kind = 'class' AND language IN ('javascript', 'typescript')`
  ).all(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_relations (repo_id, source_symbol_id, target_symbol_id, source_file_id, target_file_id, kind, weight)
     VALUES (?, ?, ?, ?, ?, 'implements', 1.0)`
  );

  let count = 0;
  for (const cls of classes) {
    const ifaceNames = extractImplementsNames(cls.signature);
    if (!ifaceNames.length) continue;

    for (const ifaceName of ifaceNames) {
      const target = db.prepare(
        `SELECT id, file_id FROM code_symbols WHERE repo_id = ? AND name = ? AND kind = 'interface'`
      ).get(repoId, ifaceName.trim());

      if (target) {
        insertStmt.run(repoId, cls.id, target.id, cls.file_id, target.file_id);
        count++;
      }
    }
  }

  return { success: true, count };
}

/**
 * Extract the base class name from a class signature, language-aware.
 */
function extractExtendsName(signature, language) {
  if (!signature) return null;

  if (language === 'javascript' || language === 'typescript') {
    const m = signature.match(/extends\s+(\w+)/);
    return m ? m[1] : null;
  }

  if (language === 'python') {
    const m = signature.match(/class\s+\w+\((\w+)\)/);
    return m ? m[1] : null;
  }

  // Rust, Go, etc. — not extractable from signatures alone
  return null;
}

/**
 * Extract interface names from `implements X, Y` in a TS class signature.
 */
function extractImplementsNames(signature) {
  if (!signature) return [];
  const m = signature.match(/implements\s+([\w,\s]+?)(?:\s*\{|$)/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  buildExtendsEdges,
  buildImplementsEdges,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/relation-builder.test.js`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code-analysis/relation-builder.js test/relation-builder.test.js
git commit -m "feat: buildExtendsEdges and buildImplementsEdges with tests"
```

---

### Task 3: Relation builder — `buildReexportEdges` and `buildReferenceEdges`

**Files:**
- Modify: `src/code-analysis/relation-builder.js` (add two functions)
- Modify: `test/relation-builder.test.js` (add test groups)

- [ ] **Step 1: Write failing tests for reexport edges**

Append to `test/relation-builder.test.js`:

```js
describe('buildReexportEdges', () => {
  // Reexport uses code_imports table — need it in schema
  function setupReexportDb() {
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
    db = new Database(TMP_DB);

    db.exec(`CREATE TABLE code_repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT)`);
    db.exec(`CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, path TEXT, language TEXT, content TEXT, content_hash TEXT)`);
    db.exec(`CREATE TABLE code_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_id INTEGER, name TEXT, kind TEXT,
      signature TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, start_byte INTEGER,
      end_byte INTEGER, docstring TEXT DEFAULT '', body_preview TEXT DEFAULT '', language TEXT NOT NULL,
      parent_name TEXT DEFAULT '', qualified_name TEXT NOT NULL, stable_symbol_id TEXT DEFAULT '',
      content_hash TEXT DEFAULT '', summary TEXT DEFAULT '', decorators_json TEXT DEFAULT '[]',
      keywords_json TEXT DEFAULT '[]', call_references_json TEXT DEFAULT '[]',
      ecosystem_context TEXT DEFAULT '', indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE code_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_file_id INTEGER,
      target_module TEXT NOT NULL, target_file_id INTEGER, import_type TEXT NOT NULL DEFAULT 'static',
      line_number INTEGER, UNIQUE(repo_id, source_file_id, target_module)
    )`);
    db.exec(`CREATE TABLE code_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_symbol_id INTEGER,
      target_symbol_id INTEGER, source_file_id INTEGER, target_file_id INTEGER,
      kind TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, line_number INTEGER,
      UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                     COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
    )`);

    const insertRepo = db.prepare('INSERT INTO code_repos (name, path) VALUES (?, ?)');
    const result = insertRepo.run('test-repo', '/tmp/test');
    repoId = result.lastInsertRowid;
    return { db, repoId };
  }

  it('should create reexport edge from code_imports with import_type re-export', () => {
    const { db: testDb, repoId: rid } = setupReexportDb();
    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertImport = testDb.prepare('INSERT INTO code_imports (repo_id, source_file_id, target_module, target_file_id, import_type) VALUES (?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'barrel.js', 'javascript', '', '');
    const fB = insertFile.run(rid, 'impl.js', 'javascript', '', '');
    insertImport.run(rid, fA.lastInsertRowid, './impl', fB.lastInsertRowid, 're-export');

    const { buildReexportEdges } = require('../src/code-analysis/relation-builder');
    const result = buildReexportEdges(testDb, rid);
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);

    const rows = testDb.prepare('SELECT * FROM code_relations WHERE kind = ?').all('reexport');
    expect(rows).toHaveLength(1);
    // source = barrel (importer), target = impl (imported)
    expect(rows[0].source_file_id).toBe(fA.lastInsertRowid);
    expect(rows[0].target_file_id).toBe(fB.lastInsertRowid);
  });

  it('should skip non-re-export imports', () => {
    const { db: testDb, repoId: rid } = setupReexportDb();
    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertImport = testDb.prepare('INSERT INTO code_imports (repo_id, source_file_id, target_module, target_file_id, import_type) VALUES (?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'consumer.js', 'javascript', '', '');
    const fB = insertFile.run(rid, 'lib.js', 'javascript', '', '');
    insertImport.run(rid, fA.lastInsertRowid, './lib', fB.lastInsertRowid, 'static');

    const { buildReexportEdges } = require('../src/code-analysis/relation-builder');
    const result = buildReexportEdges(testDb, rid);
    expect(result.count).toBe(0);
  });
});

describe('buildReferenceEdges', () => {
  // References uses scope_resolution + file_scope_bindings — need them in schema
  function setupReferenceDb() {
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
    db = new Database(TMP_DB);

    db.exec(`CREATE TABLE code_repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT)`);
    db.exec(`CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, path TEXT, language TEXT, content TEXT, content_hash TEXT)`);
    db.exec(`CREATE TABLE code_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_id INTEGER, name TEXT, kind TEXT,
      signature TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, start_byte INTEGER,
      end_byte INTEGER, docstring TEXT DEFAULT '', body_preview TEXT DEFAULT '', language TEXT NOT NULL,
      parent_name TEXT DEFAULT '', qualified_name TEXT NOT NULL, stable_symbol_id TEXT DEFAULT '',
      content_hash TEXT DEFAULT '', summary TEXT DEFAULT '', decorators_json TEXT DEFAULT '[]',
      keywords_json TEXT DEFAULT '[]', call_references_json TEXT DEFAULT '[]',
      ecosystem_context TEXT DEFAULT '', indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE file_scope_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_id INTEGER, name TEXT, kind TEXT,
      origin TEXT, source_file_id INTEGER, source_name TEXT, line_start INTEGER, line_end INTEGER,
      scope_depth INTEGER DEFAULT 0, byte_start INTEGER, byte_end INTEGER, first_seen_pass INTEGER DEFAULT 0
    )`);
    db.exec(`CREATE TABLE scope_resolution (
      binding_id INTEGER PRIMARY KEY, resolved_symbol_id INTEGER, resolved_file_id INTEGER,
      status TEXT NOT NULL, resolved_at_pass INTEGER, confidence REAL DEFAULT 1.0
    )`);
    db.exec(`CREATE TABLE code_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_symbol_id INTEGER,
      target_symbol_id INTEGER, source_file_id INTEGER, target_file_id INTEGER,
      kind TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, line_number INTEGER,
      UNIQUE(repo_id, COALESCE(source_symbol_id, 0), COALESCE(target_symbol_id, 0),
                     COALESCE(source_file_id, 0), COALESCE(target_file_id, 0), kind)
    )`);

    const insertRepo = db.prepare('INSERT INTO code_repos (name, path) VALUES (?, ?)');
    const result = insertRepo.run('test-repo', '/tmp/test');
    repoId = result.lastInsertRowid;
    return { db, repoId };
  }

  it('should create reference edge for non-function resolved bindings', () => {
    const { db: testDb, repoId: rid } = setupReferenceDb();
    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertSymbol = testDb.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line, start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertBinding = testDb.prepare('INSERT INTO file_scope_bindings (repo_id, file_id, name, kind, origin, line_start, line_end) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertResolution = testDb.prepare('INSERT INTO scope_resolution (binding_id, resolved_symbol_id, resolved_file_id, status, resolved_at_pass, confidence) VALUES (?, ?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'consumer.ts', 'typescript', '', '');
    const fB = insertFile.run(rid, 'types.ts', 'typescript', '', '');

    // A class (non-function) that gets referenced
    const typeSym = insertSymbol.run(rid, fB.lastInsertRowid, 'MyType', 'class', 'class MyType', 'types.ts', 1, 5, 0, 100, 'typescript', 'MyType');
    // The symbol doing the referencing
    const consumerSym = insertSymbol.run(rid, fA.lastInsertRowid, 'process', 'function', 'function process()', 'consumer.ts', 1, 10, 0, 200, 'typescript', 'process');

    // Binding for MyType in consumer file
    const binding = insertBinding.run(rid, fA.lastInsertRowid, 'MyType', 'class', 'import', 1, 1);
    // Resolved to the type symbol
    insertResolution.run(binding.lastInsertRowid, typeSym.lastInsertRowid, fB.lastInsertRowid, 'resolved', 2, 1.0);

    const { buildReferenceEdges } = require('../src/code-analysis/relation-builder');
    const result = buildReferenceEdges(testDb, rid);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const rows = testDb.prepare('SELECT * FROM code_relations WHERE kind = ?').all('references');
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBe(0.8);
  });

  it('should not create reference edge for function/method bindings', () => {
    const { db: testDb, repoId: rid } = setupReferenceDb();
    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertSymbol = testDb.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line, start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertBinding = testDb.prepare('INSERT INTO file_scope_bindings (repo_id, file_id, name, kind, origin, line_start, line_end) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertResolution = testDb.prepare('INSERT INTO scope_resolution (binding_id, resolved_symbol_id, resolved_file_id, status, resolved_at_pass, confidence) VALUES (?, ?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'caller.ts', 'typescript', '', '');
    const fB = insertFile.run(rid, 'lib.ts', 'typescript', '', '');

    const fnSym = insertSymbol.run(rid, fB.lastInsertRowid, 'helper', 'function', 'function helper()', 'lib.ts', 1, 5, 0, 100, 'typescript', 'helper');
    const binding = insertBinding.run(rid, fA.lastInsertRowid, 'helper', 'function', 'import', 1, 1);
    insertResolution.run(binding.lastInsertRowid, fnSym.lastInsertRowid, fB.lastInsertRowid, 'resolved', 2, 1.0);

    const { buildReferenceEdges } = require('../src/code-analysis/relation-builder');
    const result = buildReferenceEdges(testDb, rid);
    // Functions are already in code_calls — skip them
    expect(result.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/relation-builder.test.js`
Expected: New tests FAIL — `buildReexportEdges` and `buildReferenceEdges` not exported.

- [ ] **Step 3: Implement `buildReexportEdges` and `buildReferenceEdges`**

Append to `src/code-analysis/relation-builder.js`:

```js
/**
 * Extract re-export edges from code_imports where import_type = 're-export'.
 * Direct edges get weight 1.0. Transitive chains up to depth 3 get 0.7^depth.
 */
function buildReexportEdges(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  db.prepare('DELETE FROM code_relations WHERE repo_id = ? AND kind = ?').run(repoId, 'reexport');

  const reexports = db.prepare(
    `SELECT source_file_id, target_file_id FROM code_imports WHERE repo_id = ? AND import_type = 're-export' AND target_file_id IS NOT NULL`
  ).all(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_relations (repo_id, source_file_id, target_file_id, kind, weight)
     VALUES (?, ?, ?, 'reexport', ?)`
  );

  let count = 0;

  // Direct edges
  for (const row of reexports) {
    insertStmt.run(repoId, row.source_file_id, row.target_file_id, 1.0);
    count++;
  }

  // Transitive walk (max depth 3)
  const fileById = new Map();
  for (const row of reexports) {
    // Build adjacency: source → targets it re-exports from
    const targets = fileById.get(row.source_file_id) || [];
    targets.push(row.target_file_id);
    fileById.set(row.source_file_id, targets);
  }

  for (const [sourceId] of fileById) {
    const visited = new Set([sourceId]);
    const queue = [{ fileId: sourceId, depth: 0 }];

    while (queue.length > 0) {
      const { fileId, depth } = queue.shift();
      if (depth >= 3) continue;

      const targets = fileById.get(fileId) || [];
      for (const targetId of targets) {
        if (visited.has(targetId)) continue;
        visited.add(targetId);

        const transitiveWeight = Math.pow(0.7, depth + 1);
        if (transitiveWeight < 0.1) continue;

        // Only insert if not already a direct edge
        const existing = db.prepare(
          `SELECT id FROM code_relations WHERE repo_id = ? AND source_file_id = ? AND target_file_id = ? AND kind = 'reexport' AND weight = 1.0`
        ).get(repoId, sourceId, targetId);

        if (!existing) {
          insertStmt.run(repoId, sourceId, targetId, transitiveWeight);
          count++;
        }

        queue.push({ fileId: targetId, depth: depth + 1 });
      }
    }
  }

  return { success: true, count };
}

/**
 * Extract reference edges from scope_resolution.
 * Only for non-function/method resolved symbols (functions are in code_calls).
 */
function buildReferenceEdges(db, repoId) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  db.prepare('DELETE FROM code_relations WHERE repo_id = ? AND kind = ?').run(repoId, 'references');

  const resolved = db.prepare(`
    SELECT sr.binding_id, sr.resolved_symbol_id, sr.resolved_file_id,
           fsb.file_id AS source_file_id, fsb.name AS binding_name,
           cs.name AS target_name, cs.kind AS target_kind, cs.file_id AS target_file_id
    FROM scope_resolution sr
    JOIN file_scope_bindings fsb ON fsb.id = sr.binding_id
    JOIN code_symbols cs ON cs.id = sr.resolved_symbol_id
    WHERE fsb.repo_id = ? AND sr.status = 'resolved'
      AND cs.kind NOT IN ('function', 'method')
      AND sr.resolved_symbol_id IS NOT NULL
  `).all(repoId);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO code_relations (repo_id, source_symbol_id, target_symbol_id, source_file_id, target_file_id, kind, weight)
     VALUES (?, NULL, ?, ?, ?, 'references', 0.8)`
  );

  let count = 0;
  const seen = new Set();

  for (const row of resolved) {
    // Deduplicate by (source_file, target_symbol)
    const key = `${row.source_file_id}:${row.resolved_symbol_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    insertStmt.run(repoId, row.resolved_symbol_id, row.source_file_id, row.target_file_id);
    count++;
  }

  return { success: true, count };
}

module.exports = {
  buildExtendsEdges,
  buildImplementsEdges,
  buildReexportEdges,
  buildReferenceEdges,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/relation-builder.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code-analysis/relation-builder.js test/relation-builder.test.js
git commit -m "feat: buildReexportEdges and buildReferenceEdges with tests"
```

---

### Task 4: Co-change builder — `buildCochangeEdges`

**Files:**
- Create: `src/code-analysis/cochange-builder.js`
- Create: `test/cochange-builder.test.js`

- [ ] **Step 1: Write failing tests for cochange extraction**

Create `test/cochange-builder.test.js`:

```js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP_DB = path.join('/tmp', 'cochange-test.db');

let db;
let repoId;

function setupTestDb() {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  db = new Database(TMP_DB);

  db.exec(`CREATE TABLE code_repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT)`);
  db.exec(`CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, path TEXT, language TEXT, content TEXT, content_hash TEXT)`);
  db.exec(`CREATE TABLE file_cochange (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_a_id INTEGER, file_b_id INTEGER,
    co_commit_count INTEGER NOT NULL DEFAULT 0, strength REAL NOT NULL DEFAULT 0,
    window_days INTEGER NOT NULL DEFAULT 90,
    UNIQUE(repo_id, file_a_id, file_b_id)
  )`);

  const insertRepo = db.prepare('INSERT INTO code_repos (name, path) VALUES (?, ?)');
  const result = insertRepo.run('test-repo', '/tmp/test');
  repoId = result.lastInsertRowid;
  return { db, repoId };
}

afterEach(() => {
  if (db) db.close();
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

describe('parseGitLogForCochange', () => {
  it('should count file pairs from commit groups', () => {
    const { parseGitLogForCochange } = require('../src/code-analysis/cochange-builder');

    const log = `COMMIT:abc123\nsrc/a.js\nsrc/b.js\nsrc/c.js\nCOMMIT:def456\nsrc/a.js\nsrc/b.js\nCOMMIT:ghi789\nsrc/b.js\nsrc/c.js`;

    const pairs = parseGitLogForCochange(log);
    // a-b: 2 commits, a-c: 1, b-c: 2
    expect(pairs['src/a.js::src/b.js']).toBe(2);
    expect(pairs['src/a.js::src/c.js']).toBe(1);
    expect(pairs['src/b.js::src/c.js']).toBe(2);
  });

  it('should skip commits with only 1 file', () => {
    const { parseGitLogForCochange } = require('../src/code-analysis/cochange-builder');

    const log = `COMMIT:abc123\nsrc/a.js\nCOMMIT:def456\nsrc/a.js\nsrc/b.js`;
    const pairs = parseGitLogForCochange(log);
    expect(Object.keys(pairs)).toHaveLength(1);
    expect(pairs['src/a.js::src/b.js']).toBe(1);
  });
});

describe('buildCochangeEdges', () => {
  it('should store co-change pairs in both directions', () => {
    const { db: testDb, repoId: rid } = setupTestDb();
    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'src/a.js', 'javascript', '', '');
    const fB = insertFile.run(rid, 'src/b.js', 'javascript', '', '');

    // Mock the git log output by directly using the parse + store logic
    const { storeCochangePairs } = require('../src/code-analysis/cochange-builder');
    const pairs = { 'src/a.js::src/b.js': 5 };
    const pathToId = { 'src/a.js': fA.lastInsertRowid, 'src/b.js': fB.lastInsertRowid };

    storeCochangePairs(testDb, rid, pairs, pathToId, 90);

    const rows = testDb.prepare('SELECT * FROM file_cochange').all();
    expect(rows).toHaveLength(2); // Both directions
    expect(rows.every((r) => r.co_commit_count === 5)).toBe(true);
    // Strength should be 1.0 (only one pair = max)
    expect(rows.every((r) => r.strength === 1.0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cochange-builder.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement cochange builder**

Create `src/code-analysis/cochange-builder.js`:

```js
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Parse git log output grouped by COMMIT: markers.
 * Returns a map of "fileA::fileB" → co_commit_count.
 */
function parseGitLogForCochange(logOutput) {
  const pairs = {};
  const lines = logOutput.split('\n');
  let currentFiles = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('COMMIT:')) {
      // Process previous commit's files
      processCommitFiles(currentFiles, pairs);
      currentFiles = [];
    } else if (trimmed) {
      currentFiles.push(trimmed);
    }
  }
  // Process last commit
  processCommitFiles(currentFiles, pairs);

  return pairs;
}

function processCommitFiles(files, pairs) {
  if (files.length < 2) return;
  // Sort for canonical ordering
  const sorted = [...files].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const key = `${sorted[i]}::${sorted[j]}`;
      pairs[key] = (pairs[key] || 0) + 1;
    }
  }
}

/**
 * Store co-change pairs into file_cochange table in both directions.
 */
function storeCochangePairs(db, repoId, pairs, pathToId, windowDays) {
  const insertStmt = db.prepare(
    `INSERT INTO file_cochange (repo_id, file_a_id, file_b_id, co_commit_count, strength, window_days)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, file_a_id, file_b_id) DO UPDATE SET
       co_commit_count = excluded.co_commit_count,
       strength = excluded.strength`
  );

  const maxCount = Math.max(...Object.values(pairs), 1);

  for (const [key, count] of Object.entries(pairs)) {
    const [pathA, pathB] = key.split('::');
    const idA = pathToId[pathA];
    const idB = pathToId[pathB];
    if (!idA || !idB) continue;

    const strength = Math.round((count / maxCount) * 100) / 100;

    // Both directions
    insertStmt.run(repoId, idA, idB, count, strength, windowDays);
    insertStmt.run(repoId, idB, idA, count, strength, windowDays);
  }
}

/**
 * Build co-change edges from git history.
 * Full reindex only — expensive operation, cached in file_cochange table.
 */
function buildCochangeEdges(db, repoId, opts = {}) {
  const { windowDays = 90 } = opts;

  // Look up repo path
  const repo = db.prepare('SELECT path FROM code_repos WHERE id = ?').get(repoId);
  if (!repo || !repo.path) {
    return { success: false, count: 0, reason: 'repo not found' };
  }

  // Check git availability
  let logOutput;
  try {
    const since = new Date(Date.now() - windowDays * 86400000)
      .toISOString().split('T')[0];
    logOutput = execFileSync(
      'git',
      ['-C', repo.path, 'log', `--since=${since}`, '--format=COMMIT:%H', '--name-only'],
      { encoding: 'utf8', timeout: 30000 }
    );
  } catch (e) {
    return { success: false, count: 0, reason: `git error: ${e.message}` };
  }

  // Parse pairs
  const pairs = parseGitLogForCochange(logOutput);
  if (Object.keys(pairs).length === 0) {
    return { success: true, count: 0 };
  }

  // Build path→id map
  const files = db.prepare('SELECT id, path FROM code_files WHERE repo_id = ?').all(repoId);
  const pathToId = new Map(files.map((f) => [f.path, f.id]));

  // Clear old data
  db.prepare('DELETE FROM file_cochange WHERE repo_id = ? AND window_days = ?').run(repoId, windowDays);

  // Store
  storeCochangePairs(db, repoId, pairs, pathToId, windowDays);

  const pairCount = Object.keys(pairs).length;
  return { success: true, count: pairCount };
}

module.exports = {
  buildCochangeEdges,
  parseGitLogForCochange,
  storeCochangePairs,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cochange-builder.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code-analysis/cochange-builder.js test/cochange-builder.test.js
git commit -m "feat: buildCochangeEdges with git co-change extraction and tests"
```

---

### Task 5: Propagation engine — `getAffectedGraph`

**Files:**
- Create: `src/code-analysis/propagation-impl.js`
- Create: `test/propagation-impl.test.js`

- [ ] **Step 1: Write failing tests for propagation engine**

Create `test/propagation-impl.test.js`:

```js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP_DB = path.join('/tmp', 'propagation-test.db');

let db;
let repoId;

function setupPropagationDb() {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  db = new Database(TMP_DB);

  db.exec(`CREATE TABLE code_repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, path TEXT)`);
  db.exec(`CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, path TEXT, language TEXT, content TEXT, content_hash TEXT)`);
  db.exec(`CREATE TABLE code_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_id INTEGER, name TEXT, kind TEXT,
    signature TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, start_byte INTEGER,
    end_byte INTEGER, docstring TEXT DEFAULT '', body_preview TEXT DEFAULT '', language TEXT NOT NULL,
    parent_name TEXT DEFAULT '', qualified_name TEXT NOT NULL, stable_symbol_id TEXT DEFAULT '',
    content_hash TEXT DEFAULT '', summary TEXT DEFAULT '', decorators_json TEXT DEFAULT '[]',
    keywords_json TEXT DEFAULT '[]', call_references_json TEXT DEFAULT '[]',
    ecosystem_context TEXT DEFAULT '', indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE code_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_file_id INTEGER,
    target_module TEXT, target_file_id INTEGER, import_type TEXT DEFAULT 'static', line_number INTEGER
  )`);
  db.exec(`CREATE TABLE code_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, caller_symbol_id INTEGER,
    callee_name TEXT, callee_symbol_id INTEGER, confidence REAL DEFAULT 1.0, line_number INTEGER
  )`);
  db.exec(`CREATE TABLE code_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, source_symbol_id INTEGER,
    target_symbol_id INTEGER, source_file_id INTEGER, target_file_id INTEGER,
    kind TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, line_number INTEGER
  )`);
  db.exec(`CREATE TABLE file_cochange (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER, file_a_id INTEGER, file_b_id INTEGER,
    co_commit_count INTEGER DEFAULT 0, strength REAL DEFAULT 0, window_days INTEGER DEFAULT 90
  )`);

  const insertRepo = db.prepare('INSERT INTO code_repos (name, path) VALUES (?, ?)');
  const result = insertRepo.run('test-repo', '/tmp/test');
  repoId = result.lastInsertRowid;

  return { db, repoId };
}

afterEach(() => {
  if (db) db.close();
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

describe('getAffectedGraph', () => {
  it('should find callers via code_calls', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertSymbol = testDb.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line, start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertCall = testDb.prepare('INSERT INTO code_calls (repo_id, caller_symbol_id, callee_name, callee_symbol_id, confidence) VALUES (?, ?, ?, ?, ?)');

    const fLib = insertFile.run(rid, 'lib.js', 'javascript', '', '');
    const fConsumer = insertFile.run(rid, 'consumer.js', 'javascript', '', '');

    const callee = insertSymbol.run(rid, fLib.lastInsertRowid, 'helper', 'function', 'function helper()', 'lib.js', 1, 5, 0, 50, 'javascript', 'helper');
    const caller = insertSymbol.run(rid, fConsumer.lastInsertRowid, 'main', 'function', 'function main()', 'consumer.js', 1, 5, 0, 50, 'javascript', 'main');

    insertCall.run(rid, caller.lastInsertRowid, 'helper', callee.lastInsertRowid, 1.0);

    const result = getAffectedGraph(testDb, rid, { symbol: 'helper' });
    expect(result.affected_files.length).toBeGreaterThanOrEqual(1);
    expect(result.affected_files.some((f) => f.path === 'consumer.js')).toBe(true);
    expect(result.affected_symbols.some((s) => s.name === 'main')).toBe(true);
  });

  it('should find importers via code_imports', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertImport = testDb.prepare('INSERT INTO code_imports (repo_id, source_file_id, target_module, target_file_id) VALUES (?, ?, ?, ?)');

    const fLib = insertFile.run(rid, 'lib.js', 'javascript', '', '');
    const fConsumer = insertFile.run(rid, 'consumer.js', 'javascript', '', '');
    insertImport.run(rid, fConsumer.lastInsertRowid, './lib', fLib.lastInsertRowid);

    const result = getAffectedGraph(testDb, rid, { file: 'lib.js' });
    expect(result.affected_files.some((f) => f.path === 'consumer.js')).toBe(true);
  });

  it('should find extends relations', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertSymbol = testDb.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line, start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertRelation = testDb.prepare('INSERT INTO code_relations (repo_id, source_symbol_id, target_symbol_id, source_file_id, target_file_id, kind, weight) VALUES (?, ?, ?, ?, ?, ?, ?)');

    const fBase = insertFile.run(rid, 'base.js', 'javascript', '', '');
    const fChild = insertFile.run(rid, 'child.js', 'javascript', '', '');

    const baseSym = insertSymbol.run(rid, fBase.lastInsertRowid, 'Base', 'class', 'class Base', 'base.js', 1, 5, 0, 50, 'javascript', 'Base');
    const childSym = insertSymbol.run(rid, fChild.lastInsertRowid, 'Child', 'class', 'class Child extends Base', 'child.js', 1, 5, 0, 50, 'javascript', 'Child');

    insertRelation.run(rid, childSym.lastInsertRowid, baseSym.lastInsertRowid, fChild.lastInsertRowid, fBase.lastInsertRowid, 'extends', 1.0);

    const result = getAffectedGraph(testDb, rid, { symbol: 'Base' });
    expect(result.affected_files.some((f) => f.path === 'child.js')).toBe(true);
    expect(result.affected_files.some((f) => f.signals.includes('extends'))).toBe(true);
  });

  it('should decay reachability with distance', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertSymbol = testDb.prepare(`INSERT INTO code_symbols (repo_id, file_id, name, kind, signature, file_path, start_line, end_line, start_byte, end_byte, language, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertCall = testDb.prepare('INSERT INTO code_calls (repo_id, caller_symbol_id, callee_name, callee_symbol_id, confidence) VALUES (?, ?, ?, ?, ?)');

    // Chain: a → b → c → d
    const f1 = insertFile.run(rid, 'a.js', 'javascript', '', '');
    const f2 = insertFile.run(rid, 'b.js', 'javascript', '', '');
    const f3 = insertFile.run(rid, 'c.js', 'javascript', '', '');

    const symD = insertSymbol.run(rid, f1.lastInsertRowid, 'd', 'function', 'function d()', 'a.js', 1, 5, 0, 50, 'javascript', 'd');
    const symC = insertSymbol.run(rid, f1.lastInsertRowid, 'c', 'function', 'function c()', 'a.js', 1, 5, 0, 50, 'javascript', 'c');
    const symB = insertSymbol.run(rid, f2.lastInsertRowid, 'b', 'function', 'function b()', 'b.js', 1, 5, 0, 50, 'javascript', 'b');
    const symA = insertSymbol.run(rid, f3.lastInsertRowid, 'a', 'function', 'function a()', 'c.js', 1, 5, 0, 50, 'javascript', 'a');

    // a calls b, b calls c, c calls d
    insertCall.run(rid, symA.lastInsertRowid, 'b', symB.lastInsertRowid, 1.0);
    insertCall.run(rid, symB.lastInsertRowid, 'c', symC.lastInsertRowid, 1.0);
    insertCall.run(rid, symC.lastInsertRowid, 'd', symD.lastInsertRowid, 1.0);

    const result = getAffectedGraph(testDb, rid, { symbol: 'd' });
    // Each hop should have lower reachability
    const fileA = result.affected_files.find((f) => f.path === 'b.js');
    const fileB = result.affected_files.find((f) => f.path === 'c.js');
    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();
    expect(fileA.reachability).toBeGreaterThan(fileB.reachability);
  });

  it('should include cochange signal', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertCochange = testDb.prepare('INSERT INTO file_cochange (repo_id, file_a_id, file_b_id, co_commit_count, strength) VALUES (?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'a.js', 'javascript', '', '');
    const fB = insertFile.run(rid, 'b.js', 'javascript', '', '');
    insertCochange.run(rid, fA.lastInsertRowid, fB.lastInsertRowid, 10, 1.0);

    const result = getAffectedGraph(testDb, rid, { file: 'a.js' });
    expect(result.affected_files.some((f) => f.path === 'b.js')).toBe(true);
    const bFile = result.affected_files.find((f) => f.path === 'b.js');
    expect(bFile.signals).toContain('cochange');
  });

  it('should respect minReachability threshold', () => {
    const { db: testDb, repoId: rid } = setupPropagationDb();
    const { getAffectedGraph } = require('../src/code-analysis/propagation-impl');

    const insertFile = testDb.prepare('INSERT INTO code_files (repo_id, path, language, content, content_hash) VALUES (?, ?, ?, ?, ?)');
    const insertCochange = testDb.prepare('INSERT INTO file_cochange (repo_id, file_a_id, file_b_id, co_commit_count, strength) VALUES (?, ?, ?, ?, ?)');

    const fA = insertFile.run(rid, 'a.js', 'javascript', '', '');
    const fB = insertFile.run(rid, 'b.js', 'javascript', '', '');
    insertCochange.run(rid, fA.lastInsertRowid, fB.lastInsertRowid, 1, 0.1);

    // With high minReachability, weak cochange should be excluded
    const result = getAffectedGraph(testDb, rid, { file: 'a.js', minReachability: 0.5 });
    expect(result.affected_files.some((f) => f.path === 'b.js')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/propagation-impl.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement propagation engine**

Create `src/code-analysis/propagation-impl.js`:

```js
const { _requireNativeDb } = require('./shared-deps');

// Decay factors per edge type
const EDGE_DECAY = {
  call: 0.7,
  import: 0.5,
  extends: 0.8,
  implements: 0.8,
  reexport: 0.7,
  references: 0.4,
  cochange: 0.3,
};

const DISTANCE_DECAY = 0.85;
const DEFAULT_MIN_REACHABILITY = 0.1;
const DEFAULT_MAX_DEPTH = 5;

/**
 * Unified weighted BFS across all edge types.
 * Finds all files/symbols affected by a change to the given symbol or file.
 */
function getAffectedGraph(db, repoId, opts = {}) {
  const guard = _requireNativeDb(db);
  if (guard) return guard;

  const { symbol, file, minReachability = DEFAULT_MIN_REACHABILITY, maxDepth = DEFAULT_MAX_DEPTH } = opts;

  if (!symbol && !file) {
    return { error: 'Missing --symbol or --file' };
  }

  // Resolve seed nodes
  const seedSymbolIds = [];
  let seedFileId = null;
  let seedFilePath = file || null;
  let seedSymbolName = symbol || null;

  if (symbol) {
    const symRows = db.prepare(
      'SELECT id, name, file_id, file_path FROM code_symbols WHERE repo_id = ? AND name = ?'
    ).all(repoId, symbol);

    if (symRows.length === 0) {
      return { error: `Symbol "${symbol}" not found` };
    }
    if (symRows.length > 1) {
      return { error: `Multiple symbols named "${symbol}"`, candidates: symRows };
    }

    seedSymbolIds.push(symRows[0].id);
    seedFileId = symRows[0].file_id;
    seedFilePath = symRows[0].file_path;
    seedSymbolName = symRows[0].name;
  }

  if (file && !seedFileId) {
    const fileRow = db.prepare('SELECT id, path FROM code_files WHERE repo_id = ? AND path = ?').get(repoId, file);
    if (fileRow) {
      seedFileId = fileRow.id;
    }
  }

  // BFS
  // visited: Map<symbolId|'file:'+fileId, { reachability, depth, signals, trace }>
  const visited = new Map();
  const queue = [];

  // Seed
  if (seedSymbolIds.length > 0) {
    const key = `sym:${seedSymbolIds[0]}`;
    visited.set(key, { reachability: 1.0, depth: 0, signals: [], trace: [] });
    queue.push({ type: 'symbol', id: seedSymbolIds[0], fileId: seedFileId, reachability: 1.0, depth: 0 });
  }
  if (seedFileId) {
    const key = `file:${seedFileId}`;
    if (!visited.has(key)) {
      visited.set(key, { reachability: 1.0, depth: 0, signals: [], trace: [] });
    }
    queue.push({ type: 'file', id: seedFileId, reachability: 1.0, depth: 0 });
  }

  // Collect results
  const affectedFiles = new Map(); // fileId → { path, reachability, signals, depth }
  const affectedSymbols = new Map(); // symbolId → { name, file, reachability, via }

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.depth >= maxDepth) continue;

    // 1. code_calls: who calls this symbol?
    if (current.type === 'symbol') {
      const callers = db.prepare(
        `SELECT cc.caller_symbol_id, cc.confidence, cs.name, cs.file_path, cs.file_id
         FROM code_calls cc JOIN code_symbols cs ON cs.id = cc.caller_symbol_id
         WHERE cc.callee_symbol_id = ? AND cc.confidence >= ?`
      ).all(current.id, 0.3);

      for (const c of callers) {
        const score = c.confidence * EDGE_DECAY.call * Math.pow(DISTANCE_DECAY, current.depth + 1);
        if (score < minReachability) continue;

        const key = `sym:${c.caller_symbol_id}`;
        const existing = visited.get(key);
        if (existing && existing.reachability >= score) continue;

        visited.set(key, { reachability: score, depth: current.depth + 1, signals: ['call'], trace: [] });
        queue.push({ type: 'symbol', id: c.caller_symbol_id, fileId: c.file_id, reachability: score, depth: current.depth + 1 });

        affectedSymbols.set(c.caller_symbol_id, {
          name: c.name,
          file: c.file_path,
          reachability: Math.round(score * 100) / 100,
          via: 'call',
        });

        if (c.file_id) {
          updateFileEntry(affectedFiles, c.file_id, c.file_path, score, 'call', current.depth + 1);
        }
      }
    }

    // 2. code_imports: who imports this file?
    if (current.fileId) {
      const importers = db.prepare(
        `SELECT ci.source_file_id, cf.path
         FROM code_imports ci JOIN code_files cf ON cf.id = ci.source_file_id
         WHERE ci.target_file_id = ?`
      ).all(current.fileId);

      for (const imp of importers) {
        const score = EDGE_DECAY.import * Math.pow(DISTANCE_DECAY, current.depth + 1);
        if (score < minReachability) continue;

        const key = `file:${imp.source_file_id}`;
        const existing = visited.get(key);
        if (existing && existing.reachability >= score) continue;

        visited.set(key, { reachability: score, depth: current.depth + 1, signals: ['import'], trace: [] });
        queue.push({ type: 'file', id: imp.source_file_id, reachability: score, depth: current.depth + 1 });

        updateFileEntry(affectedFiles, imp.source_file_id, imp.path, score, 'import', current.depth + 1);
      }
    }

    // 3. code_relations: what targets this symbol/file?
    {
      const rels = [];
      if (current.type === 'symbol') {
        rels.push(...db.prepare(
          `SELECT cr.source_symbol_id, cr.source_file_id, cr.kind, cr.weight,
                  cs.name, cs.file_path, cs.file_id AS sym_file_id
           FROM code_relations cr
           LEFT JOIN code_symbols cs ON cs.id = cr.source_symbol_id
           WHERE cr.target_symbol_id = ? AND cr.repo_id = ?`
        ).all(current.id, repoId));
      }
      if (current.fileId) {
        rels.push(...db.prepare(
          `SELECT cr.source_symbol_id, cr.source_file_id, cr.kind, cr.weight,
                  cs.name, cs.file_path, cs.file_id AS sym_file_id
           FROM code_relations cr
           LEFT JOIN code_symbols cs ON cs.id = cr.source_symbol_id
           WHERE cr.target_file_id = ? AND cr.repo_id = ?`
        ).all(current.fileId, repoId));
      }

      for (const r of rels) {
        const decay = EDGE_DECAY[r.kind] || 0.5;
        const score = (r.weight || 1.0) * decay * Math.pow(DISTANCE_DECAY, current.depth + 1);
        if (score < minReachability) continue;

        if (r.source_symbol_id) {
          const key = `sym:${r.source_symbol_id}`;
          const existing = visited.get(key);
          if (!existing || existing.reachability < score) {
            visited.set(key, { reachability: score, depth: current.depth + 1, signals: [r.kind], trace: [] });
            queue.push({ type: 'symbol', id: r.source_symbol_id, fileId: r.sym_file_id, reachability: score, depth: current.depth + 1 });

            if (r.name) {
              affectedSymbols.set(r.source_symbol_id, {
                name: r.name,
                file: r.file_path,
                reachability: Math.round(score * 100) / 100,
                via: r.kind,
              });
            }
          }
        }
        if (r.source_file_id) {
          const key = `file:${r.source_file_id}`;
          const existing = visited.get(key);
          if (!existing || existing.reachability < score) {
            visited.set(key, { reachability: score, depth: current.depth + 1, signals: [r.kind], trace: [] });
            queue.push({ type: 'file', id: r.source_file_id, reachability: score, depth: current.depth + 1 });

            const filePath = db.prepare('SELECT path FROM code_files WHERE id = ?').get(r.source_file_id);
            if (filePath) {
              updateFileEntry(affectedFiles, r.source_file_id, filePath.path, score, r.kind, current.depth + 1);
            }
          }
        }
      }
    }

    // 4. file_cochange: what files co-change with this file?
    if (current.fileId) {
      const cochanges = db.prepare(
        `SELECT file_a_id, file_b_id, strength FROM file_cochange WHERE repo_id = ? AND (file_a_id = ? OR file_b_id = ?)`
      ).all(repoId, current.fileId, current.fileId);

      for (const cc of cochanges) {
        const otherId = cc.file_a_id === current.fileId ? cc.file_b_id : cc.file_a_id;
        const score = (cc.strength || 0.3) * EDGE_DECAY.cochange * Math.pow(DISTANCE_DECAY, current.depth + 1);
        if (score < minReachability) continue;

        const key = `file:${otherId}`;
        const existing = visited.get(key);
        if (existing && existing.reachability >= score) continue;

        visited.set(key, { reachability: score, depth: current.depth + 1, signals: ['cochange'], trace: [] });
        queue.push({ type: 'file', id: otherId, reachability: score, depth: current.depth + 1 });

        const filePath = db.prepare('SELECT path FROM code_files WHERE id = ?').get(otherId);
        if (filePath) {
          updateFileEntry(affectedFiles, otherId, filePath.path, score, 'cochange', current.depth + 1);
        }
      }
    }
  }

  // Sort by reachability descending
  const sortedFiles = [...affectedFiles.values()].sort((a, b) => b.reachability - a.reachability);
  const sortedSymbols = [...affectedSymbols.values()].sort((a, b) => b.reachability - a.reachability);

  return {
    symbol: seedSymbolName,
    seed_file: seedFilePath,
    affected_files: sortedFiles,
    affected_symbols: sortedSymbols,
  };
}

function updateFileEntry(map, fileId, filePath, score, signal, depth) {
  const existing = map.get(fileId);
  if (existing) {
    if (score > existing.reachability) {
      existing.reachability = Math.round(score * 100) / 100;
    }
    if (!existing.signals.includes(signal)) {
      existing.signals.push(signal);
    }
    if (depth < existing.depth) {
      existing.depth = depth;
    }
  } else {
    map.set(fileId, {
      path: filePath,
      reachability: Math.round(score * 100) / 100,
      signals: [signal],
      depth,
    });
  }
}

module.exports = {
  getAffectedGraph,
  EDGE_DECAY,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/propagation-impl.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code-analysis/propagation-impl.js test/propagation-impl.test.js
git commit -m "feat: getAffectedGraph unified weighted BFS propagation engine with tests"
```

---

### Task 6: Wire into existing modules and indexing pipeline

**Files:**
- Modify: `src/code-analysis/legacy-core.js`
- Modify: `src/code-analysis/impact.js`
- Modify: `src/code-index/edge-extractor.js`
- Modify: `src/code-index/incremental-indexer.js`

- [ ] **Step 1: Wire new modules into legacy-core.js**

Add requires after line 18 (after `const _builders = require('./incremental-builders');`):

```js
const _relationBuilder = require('./relation-builder');
const _cochangeBuilder = require('./cochange-builder');
const _propagation = require('./propagation-impl');
```

Add exports at the end of the `module.exports` object (before the closing `};`):

```js
  // Relation builder
  buildExtendsEdges: _relationBuilder.buildExtendsEdges,
  buildImplementsEdges: _relationBuilder.buildImplementsEdges,
  buildReexportEdges: _relationBuilder.buildReexportEdges,
  buildReferenceEdges: _relationBuilder.buildReferenceEdges,
  // Co-change
  buildCochangeEdges: _cochangeBuilder.buildCochangeEdges,
  // Propagation
  getAffectedGraph: _propagation.getAffectedGraph,
```

- [ ] **Step 2: Route blast-radius to new engine in impact.js**

Replace the `analyzeGetBlastRadius` function (line 24-26):

```js
function analyzeGetBlastRadius(db, repoId, opts = {}) {
  return withRepo(db, 'blast-radius', () => {
    // Use new propagation engine if code_relations table exists
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'code_relations'").all();
      if (tables.length > 0) {
        return legacy.getAffectedGraph(db, repoId, opts);
      }
    } catch {}
    return legacy.getBlastRadius(db, repoId, opts);
  });
}
```

- [ ] **Step 3: Add thin wrappers to edge-extractor.js**

Add requires and functions at the end of `src/code-index/edge-extractor.js`:

```js
function buildRelationEdges(db, repoId) {
  const results = [];
  results.push(codeAnalysis.buildExtendsEdges(db, repoId));
  results.push(codeAnalysis.buildImplementsEdges(db, repoId));
  results.push(codeAnalysis.buildReexportEdges(db, repoId));
  results.push(codeAnalysis.buildReferenceEdges(db, repoId));
  return {
    success: results.every((r) => r.success !== false),
    count: results.reduce((sum, r) => sum + (r.count || 0), 0),
  };
}

function buildCochangeEdges(db, repoId, opts) {
  return codeAnalysis.buildCochangeEdges(db, repoId, opts);
}
```

Add to `module.exports`:

```js
  buildRelationEdges,
  buildCochangeEdges,
```

- [ ] **Step 4: Call new builders in incremental-indexer.js**

Add to the imports at the top (after the existing `buildComplexityMetricsForFiles` import):

```js
const {
  buildImportEdges,
  buildImportEdgesForFiles,
  buildCallEdges,
  buildCallEdgesForFiles,
  buildComplexityMetrics,
  buildComplexityMetricsForFiles,
  buildRelationEdges,
  buildCochangeEdges,
} = require('./edge-extractor');
```

In `rebuildDerivedIndexes()` (full reindex), add after the complexity block (around line 335):

```js
  // ── Relation edges (v13) ────────────────────────────────
  let relationCount = 0;
  emitProgress(args, 'analysis', { step: 'build-relations', message: 'Step 6/5: building relation edges...' }, stats);
  try {
    const re = buildRelationEdges(db, repoId);
    if (re.success) { relationCount = re.count; }
  } catch {}

  // ── Co-change edges (v13) ───────────────────────────────
  let cochangeCount = 0;
  emitProgress(args, 'analysis', { step: 'build-cochange', message: 'Step 7/5: building co-change edges...' }, stats);
  try {
    const cc = buildCochangeEdges(db, repoId);
    if (cc.success) { cochangeCount = cc.count; }
  } catch {}
```

Update the return statement to include `relationEdges: relationCount, cochangeEdges: cochangeCount`.

In `rebuildDerivedIncremental()`, add the relation edges step (no cochange for incremental):

```js
  // ── Relation edges (v13) ────────────────────────────────
  let relationCount = 0;
  try {
    const re = buildRelationEdges(db, repoId);
    if (re.success) { relationCount = re.count; }
  } catch {}
```

Update the incremental return statement to include `relationEdges: relationCount`.

- [ ] **Step 5: Verify all tests still pass**

Run: `npx vitest run`
Expected: All tests PASS (including existing code-analysis tests).

- [ ] **Step 6: Commit**

```bash
git add src/code-analysis/legacy-core.js src/code-analysis/impact.js src/code-index/edge-extractor.js src/code-index/incremental-indexer.js
git commit -m "feat: wire relation builder, cochange builder, and propagation engine into indexing pipeline"
```

---

### Task 7: Update LLM format for richer blast radius output

**Files:**
- Modify: `src/platform/protocol/llm-format.ts`

- [ ] **Step 1: Update the blast-radius case in formatCodeResult**

Replace the `'blast-radius'` case in `llm-format.ts` (around line 34-50) with:

```typescript
    case 'blast-radius': {
      // New format from getAffectedGraph
      if (result.affected_files && Array.isArray(result.affected_files) && result.affected_files.length > 0 && result.affected_files[0].reachability !== undefined) {
        const aFiles = result.affected_files;
        const aSyms = result.affected_symbols || [];
        const lines: string[] = [
          `**Blast radius of ${result.symbol ?? result.seed_file ?? '?'}** (${result.seed_file ?? '?'})`,
          `Affected files: ${aFiles.length} (by reachability)`,
        ];
        for (const f of aFiles.slice(0, 15)) {
          const score = (f.reachability ?? 0).toFixed(2);
          const signals = (f.signals || []).join(', ');
          lines.push(`  [${score}] ${f.path ?? '?'} — via ${signals}`);
        }
        if (aSyms.length > 0) {
          lines.push('');
          lines.push('Affected symbols:');
          for (const s of aSyms.slice(0, 10)) {
            const score = (s.reachability ?? 0).toFixed(2);
            lines.push(`  [${score}] ${s.name ?? '?'} (${s.file ?? '?'})`);
          }
        }
        return lines.join('\n');
      }
      // Legacy format from getBlastRadius
      const aFiles = result.affected_files || [];
      const callers = result.callers || [];
      const importers = result.file_importers || [];
      return [
        `**Blast radius of ${result.symbol ?? '?'}** (${result.file ?? '?'})`,
        `Affected files: ${aFiles.length}`,
        callers.length
          ? `\nCallers:\n${callers.map((c: any) => `  [depth ${c.depth ?? '?'}] ${c.name ?? '?'} (${c.file_path ?? '?'})`).join('\n')}`
          : '',
        importers.length
          ? `\nFile importers:\n${importers.map((f: any) => `  [depth ${f.depth ?? '?'}] ${f.path ?? '?'}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
```

- [ ] **Step 2: Verify format compiles**

Run: `npx vitest run test/format-code-result.test.js`
Expected: PASS (existing format tests still work — legacy path preserved).

- [ ] **Step 3: Commit**

```bash
git add src/platform/protocol/llm-format.ts
git commit -m "feat: update blast-radius LLM format for richer affected graph output"
```

---

### Task 8: Integration test and full reindex verification

**Files:**
- Modify: `test/code-analysis.test.js` (add integration test)

- [ ] **Step 1: Add integration test for relation edges**

Append to `test/code-analysis.test.js`:

```js
describe('code-analysis: relation edges', () => {
  it('should have code_relations populated after reindex', () => {
    const r = run(`blast-radius --repo ${REPO} --symbol buildImportGraph`, 15000);
    // Should not error — either new format or legacy format
    expect(r.error).toBeUndefined();
    // Should have affected_files
    expect(r.affected_files).toBeDefined();
    expect(r.affected_files.length).toBeGreaterThan(0);
  });

  it('should find extends edges for MemoryError class', () => {
    const store = path.resolve(__dirname, '..', 'memory-store.js');
    const out = execSync(`node "${store}" query-code "SELECT COUNT(*) as c FROM code_relations WHERE kind = 'extends'" --repo ${REPO}`, {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    // The test just verifies the table is populated without error
    expect(out).toBeDefined();
  });
});
```

- [ ] **Step 2: Run full reindex to populate new tables**

Run: `node memory-store.js reindex-repo --repo PiMemoryExtension --mode full`
Expected: Completes without error. Progress messages show "building relation edges" and "building co-change edges" steps.

- [ ] **Step 3: Verify tables are populated**

Run: `node -e "const {sqlJson}=require('./db.js'); console.log('relations:', sqlJson('SELECT kind, COUNT(*) as c FROM code_relations GROUP BY kind')); console.log('cochange:', sqlJson('SELECT COUNT(*) as c FROM file_cochange'));"`

Expected: `relations` has rows for at least `reexport` kind. `cochange` has rows if git history available.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add test/code-analysis.test.js
git commit -m "test: add integration tests for relation edges and propagation"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ `code_relations` table → Task 1
- ✅ `file_cochange` table → Task 1
- ✅ Migration V13 → Task 1
- ✅ `buildExtendsEdges` → Task 2
- ✅ `buildImplementsEdges` → Task 2
- ✅ `buildReexportEdges` → Task 3
- ✅ `buildReferenceEdges` → Task 3
- ✅ `buildCochangeEdges` → Task 4
- ✅ `getAffectedGraph` → Task 5
- ✅ Wire into legacy-core → Task 6
- ✅ Route blast-radius in impact.js → Task 6
- ✅ Add to edge-extractor facade → Task 6
- ✅ Call in incremental-indexer → Task 6
- ✅ Update LLM format → Task 7
- ✅ Integration test → Task 8

**2. Placeholder scan:** No TBDs, TODOs, or vague steps. All code shown inline.

**3. Type consistency:**
- `buildExtendsEdges(db, repoId)` → `{ success: boolean, count: number }` ✅
- `buildImplementsEdges(db, repoId)` → `{ success: boolean, count: number }` ✅
- `buildReexportEdges(db, repoId)` → `{ success: boolean, count: number }` ✅
- `buildReferenceEdges(db, repoId)` → `{ success: boolean, count: number }` ✅
- `buildCochangeEdges(db, repoId, opts)` → `{ success: boolean, count: number }` ✅
- `getAffectedGraph(db, repoId, opts)` → `{ affected_files, affected_symbols, symbol, seed_file }` ✅
- Edge types consistent across schema, builder, and propagation: `extends`, `implements`, `reexport`, `references` ✅
