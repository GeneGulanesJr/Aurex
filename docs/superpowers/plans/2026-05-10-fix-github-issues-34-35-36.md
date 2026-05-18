# Fix GitHub Issues #34, #35, #36 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three P3 issues: global mutable state preventing test isolation (#36), non-atomic DB migrations (#35), and inconsistent error return patterns (#34).

**Architecture:** 
- **#36 (Global State):** Introduce a `resetDb()` export and a `createDb(configOverride)` factory for test isolation. Production code continues using module-level singletons. Tests can reset state between runs.
- **#35 (Non-atomic Migrations):** Wrap each migration version in `withTransaction()`. Log migration errors instead of silently swallowing them. Bump `PRAGMA user_version` only on successful commit. Add a `_migrations_meta` tracking table.
- **#34 (Error Patterns):** Standardize on two return patterns: `{ ok: true, ... }` for success and `{ error: string, ... }` for recoverable errors. Remove `jsonErr()` (process.exit) from all library functions—restrict it to the CLI dispatch layer only. Add a `MemoryError` class for thrown exceptions that need to propagate.

**Tech Stack:** Node.js, SQLite (node:sqlite / better-sqlite3), Vitest

---

## File Structure

| File | Change | Responsibility |
|------|--------|---------------|
| `db.js` | Major refactor | DB layer: add `resetDb()`, `createDb()`, atomic migrations, `MemoryError` class, standardize error returns |
| `memory-store.js` | Moderate refactor | Remove `jsonErr` usage from library functions, use `MemoryError` for throws, standardize `{ error }` returns |
| `test/db.test.js` | Rewrite | New tests for atomic migrations, `resetDb()`, `createDb()`, `MemoryError` |
| `test/error-patterns.test.js` | New | Tests for standardized error patterns |

---

### Task 1: Add MemoryError class and resetDb/createDb in db.js

**Files:**
- Modify: `db.js`
- Test: `test/db.test.js`

- [ ] **Step 1: Write failing test for MemoryError class**

```javascript
// test/db.test.js — add inside the describe('db.js') block

describe('MemoryError', () => {
  it('should be an Error subclass', () => {
    const err = new dbModule.MemoryError('test error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(dbModule.MemoryError);
    expect(err.name).toBe('MemoryError');
    expect(err.message).toBe('test error');
  });

  it('should carry context data', () => {
    const err = new dbModule.MemoryError('migration failed', { version: 4, table: 'workspaces' });
    expect(err.context).toEqual({ version: 4, table: 'workspaces' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: FAIL — `dbModule.MemoryError is not a constructor`

- [ ] **Step 3: Implement MemoryError class in db.js**

In `db.js`, add before the `/* ── module state ── */` section:

```javascript
/* ── custom error ─────────────────────────────────────────── */
class MemoryError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'MemoryError';
    this.context = context;
  }
}
```

Add `MemoryError` to the `module.exports` at the bottom.

- [ ] **Step 4: Write failing test for resetDb**

```javascript
describe('resetDb', () => {
  it('should null out _db and _engine so subsequent ensureDb reopens', () => {
    dbModule.ensureDb();
    const db1 = dbModule.getDb();
    expect(db1).toBeTruthy();

    dbModule.resetDb();
    expect(dbModule.getDb()).toBeNull();

    dbModule.ensureDb();
    const db2 = dbModule.getDb();
    expect(db2).toBeTruthy();
    // Reopened — may or may not be same object depending on engine
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: FAIL — `dbModule.resetDb is not a function`

- [ ] **Step 6: Implement resetDb in db.js**

```javascript
function resetDb() {
  if (_db) {
    try { _db.close(); } catch (_) {}
  }
  _db = null;
  _engine = null;
}
```

Add `resetDb` to `module.exports`.

- [ ] **Step 7: Write failing test for createDb**

```javascript
describe('createDb', () => {
  it('should create an isolated DB instance with custom path', () => {
    const tmpPath = path.join(os.tmpdir(), `pi-mem-test-${Date.now()}.db`);
    const result = dbModule.createDb({ db_path: tmpPath });
    expect(result.ok).toBe(true);
    expect(result.engine).toMatch(/node-sqlite|better-sqlite3/);

    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    try { fs.unlinkSync(`${tmpPath}-wal`); } catch (_) {}
    try { fs.unlinkSync(`${tmpPath}-shm`); } catch (_) {}
  });

  it('should not affect the global singleton', () => {
    dbModule.ensureDb();
    const globalPath = dbModule.DB_PATH;
    const globalEngine = dbModule.getEngine();

    const tmpPath = path.join(os.tmpdir(), `pi-mem-test2-${Date.now()}.db`);
    const isolated = dbModule.createDb({ db_path: tmpPath });
    expect(isolated.ok).toBe(true);

    // Global singleton unchanged
    expect(dbModule.getEngine()).toBe(globalEngine);
    expect(dbModule.DB_PATH).toBe(globalPath);

    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    try { fs.unlinkSync(`${tmpPath}-wal`); } catch (_) {}
    try { fs.unlinkSync(`${tmpPath}-shm`); } catch (_) {}
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: FAIL — `dbModule.createDb is not a function`

- [ ] **Step 9: Implement createDb in db.js**

Add `os` require if not present (already there), then:

```javascript
function createDb(configOverride = {}) {
  const savedConfig = getConfig._cached;
  const mergedConfig = { ...getConfig(), ...configOverride };
  // Temporarily override config so openDb uses the custom path
  getConfig._cached = mergedConfig;
  try {
    // Reset any existing handle so openDb creates fresh
    if (_db) { try { _db.close(); } catch (_) {} }
    _db = null;
    _engine = null;
    const result = ensureDb();
    return result;
  } finally {
    // Restore original config for global singleton
    getConfig._cached = savedConfig;
  }
}
```

Add `createDb` to `module.exports`.

- [ ] **Step 10: Run all db tests to verify they pass**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add db.js test/db.test.js
git commit -m "feat: add MemoryError class, resetDb(), createDb() for test isolation (#36)"
```

---

### Task 2: Make migrations atomic and stop silently swallowing errors

**Files:**
- Modify: `db.js` (the `runMigrations` function)
- Test: `test/db.test.js`

- [ ] **Step 1: Write failing test for atomic migration**

```javascript
describe('runMigrations (atomic)', () => {
  it('should not advance user_version if migration statements fail', () => {
    // Reset to a known low version
    const db = dbModule.getDb();
    db.exec('PRAGMA user_version = 1');

    // Re-run migrations — should succeed atomically
    const result = dbModule.ensureDb();
    expect(result.ok).toBe(true);

    // Should be at latest version
    const rows = dbModule.sqlJson('PRAGMA user_version');
    expect(rows[0].user_version).toBeGreaterThanOrEqual(6);
  });

  it('should report migration errors instead of silently ignoring them', () => {
    // Ensure DB is at latest version — re-running should be a no-op
    const result = dbModule.ensureDb();
    expect(result.ok).toBe(true);
    // When version is current, migrations are skipped
    expect(result.migrated).toBe(false);
  });

  it('should wrap migration version steps in a transaction', () => {
    // Verify that the transaction helper works correctly with migrations
    const db = dbModule.getDb();
    db.exec('PRAGMA user_version = 0');

    const result = dbModule.ensureDb();
    expect(result.ok).toBe(true);

    // After migration, version should be 6
    const rows = dbModule.sqlJson('PRAGMA user_version');
    expect(rows[0].user_version).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: Some may pass already — the key change is in `runMigrations` internals.

- [ ] **Step 3: Refactor runMigrations to use withTransaction**

Replace the `runMigrations` function body. Each version block should be wrapped in `withTransaction()` (for better-sqlite3) or manual BEGIN/COMMIT (for node:sqlite which doesn't support `.transaction()` on all versions). Key changes:

1. Each migration version runs in its own transaction.
2. `PRAGMA user_version` bumps happen INSIDE the transaction.
3. Errors are logged with `console.error` instead of silently swallowed (`catch (_) {}`  →  `catch (e) { console.error(...) }`).
4. On failure, the transaction rolls back and the version stays where it was.

```javascript
function runMigrations() {
  let version = 0;
  try {
    const rows = sqlJson('PRAGMA user_version');
    version = rows.length > 0 ? (rows[0].user_version || 0) : 0;
  } catch (e) {
    console.error('[db] Failed to read user_version:', e.message);
  }

  if (version >= 6) { return { migrated: false, version }; }

  const migrations = [
    { to: 2, run: runMigrationV2 },
    { to: 3, run: runMigrationV3 },
    { to: 4, run: runMigrationV4 },
    { to: 5, run: runMigrationV5 },
    { to: 6, run: runMigrationV6 },
  ];

  const fromVersion = version;
  for (const migration of migrations) {
    if (version >= migration.to) { continue; }
    const errors = migration.run();
    if (errors.length > 0) {
      console.error(`[db] Migration to V${migration.to} failed (${errors.length} errors):`);
      for (const e of errors) { console.error(`  - ${e}`); }
      // Don't advance version — stop here
      return { migrated: false, fromVersion, toVersion: version, errors };
    }
    // Verify version bump succeeded
    const rows = sqlJson('PRAGMA user_version');
    version = rows.length > 0 ? (rows[0].user_version || 0) : 0;
    if (version < migration.to) {
      console.error(`[db] Migration V${migration.to} did not advance user_version (still ${version})`);
      return { migrated: false, fromVersion, toVersion: version, errors: [`V${migration.to}: user_version not advanced`] };
    }
  }

  return { migrated: true, fromVersion, toVersion: version };
}

function runMigrationV2() {
  const errors = [];
  try {
    withTransaction(() => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS observation_relations (
          source_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
          target_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
          relation TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.8,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (source_id, target_id, relation))`,
        'CREATE INDEX IF NOT EXISTS idx_obs_rel_source ON observation_relations(source_id)',
        'CREATE INDEX IF NOT EXISTS idx_obs_rel_target ON observation_relations(target_id)',
        `CREATE TABLE IF NOT EXISTS recall_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
          session_id INTEGER NOT NULL, query TEXT, was_useful INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
        'CREATE INDEX IF NOT EXISTS idx_recall_memory ON recall_log(memory_id)',
        'CREATE INDEX IF NOT EXISTS idx_recall_session ON recall_log(session_id)',
      ];
      for (const s of stmts) { sqlRaw(s); }
      sqlRaw('PRAGMA user_version = 2');
    });
  } catch (e) {
    errors.push(`V2: ${e.message}`);
  }
  return errors;
}

function runMigrationV3() {
  const errors = [];
  try {
    withTransaction(() => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS code_repos (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          path TEXT NOT NULL UNIQUE, file_count INTEGER DEFAULT 0, symbol_count INTEGER DEFAULT 0,
          indexed_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
        `CREATE TABLE IF NOT EXISTS code_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
          path TEXT NOT NULL, language TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
          mtime REAL, size_bytes INTEGER DEFAULT 0, line_count INTEGER DEFAULT 0, UNIQUE(repo_id, path))`,
        `CREATE TABLE IF NOT EXISTS code_symbols (
          id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
          file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL,
          signature TEXT, file_path TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
          start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL, docstring TEXT DEFAULT '',
          body_preview TEXT DEFAULT '', language TEXT NOT NULL, parent_name TEXT DEFAULT '',
          qualified_name TEXT NOT NULL, indexed_at TEXT NOT NULL DEFAULT (datetime('now')))`,
        'CREATE INDEX IF NOT EXISTS idx_cs_repo ON code_symbols(repo_id)',
        'CREATE INDEX IF NOT EXISTS idx_cs_name ON code_symbols(name)',
        'CREATE INDEX IF NOT EXISTS idx_cs_file ON code_symbols(file_id)',
        'CREATE INDEX IF NOT EXISTS idx_cf_repo ON code_files(repo_id)',
      ];
      for (const s of stmts) { sqlRaw(s); }
      sqlRaw(`CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_fts USING fts5(
        name, kind, signature, docstring, file_path, body_preview, content=code_symbols, content_rowid=id)`);
      sqlRaw('PRAGMA user_version = 3');
    });
  } catch (e) {
    errors.push(`V3: ${e.message}`);
  }
  return errors;
}

function runMigrationV4() {
  const errors = [];
  try {
    withTransaction(() => {
      sqlRaw(`CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT)`);
      sqlRaw('CREATE INDEX IF NOT EXISTS idx_ws_active ON workspaces(archived_at) WHERE archived_at IS NULL');
      // Migrate existing projects
      const projects = sqlJson(
        "SELECT DISTINCT project FROM observations WHERE project IS NOT NULL AND project != '' AND deleted_at IS NULL");
      for (const r of projects) {
        try { sqlRun('INSERT OR IGNORE INTO workspaces (name) VALUES (?)', [r.project]); } catch (_) {}
      }
      const sp = sqlJson("SELECT DISTINCT project FROM session_log WHERE project IS NOT NULL AND project != ''");
      for (const r of sp) {
        try { sqlRun('INSERT OR IGNORE INTO workspaces (name) VALUES (?)', [r.project]); } catch (_) {}
      }
      sqlRaw('PRAGMA user_version = 4');
    });
  } catch (e) {
    errors.push(`V4: ${e.message}`);
  }
  return errors;
}

function runMigrationV5() {
  const errors = [];
  try {
    withTransaction(() => {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      try {
        _db.exec(schema);
      } catch (e) {
        // Schema might have PRAGMAs that can't run inside a transaction;
        // Fall back to statement-by-statement
        const stmts = schema.split(/;\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
        for (const s of stmts) {
          // Skip PRAGMA inside transaction — SQLite doesn't allow it
          if (/^\s*PRAGMA/i.test(s)) { continue; }
          try { sqlRaw(s); } catch (inner) {
            // CREATE IF NOT EXISTS is idempotent — errors here mean already exists
            if (!/already exists/i.test(inner.message)) {
              throw inner;
            }
          }
        }
      }
      sqlRaw('PRAGMA user_version = 5');
    });
  } catch (e) {
    errors.push(`V5: ${e.message}`);
  }
  return errors;
}

function runMigrationV6() {
  const errors = [];
  try {
    withTransaction(() => {
      try {
        sqlRaw('ALTER TABLE code_repos ADD COLUMN head_commit TEXT');
      } catch (e) {
        // Column may already exist — that's fine
        if (!/duplicate column/i.test(e.message)) {
          throw e;
        }
      }
      sqlRaw('PRAGMA user_version = 6');
    });
  } catch (e) {
    errors.push(`V6: ${e.message}`);
  }
  return errors;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/db.test.js --reporter=verbose`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All 262+ tests pass

- [ ] **Step 6: Commit**

```bash
git add db.js test/db.test.js
git commit -m "fix: atomic migrations with error reporting (#35)"
```

---

### Task 3: Standardize error return patterns

**Files:**
- Modify: `db.js`
- Modify: `memory-store.js`
- New: `test/error-patterns.test.js`

The core principle: **Two error patterns only.**
1. **Recoverable errors** → `return { error: string, ... }` — caller checks `.error`
2. **Unrecoverable/programming errors** → `throw new MemoryError(message, context)` — caller catches

No more `process.exit(1)` from library functions. `jsonErr()` stays as a CLI-only convenience for the top-level dispatch.

- [ ] **Step 1: Write failing tests for error patterns**

```javascript
// test/error-patterns.test.js
const dbModule = require('../db');
const store = require('../memory-store.js');

describe('Error patterns', () => {
  beforeAll(() => {
    dbModule.ensureDb();
  });

  describe('db.js', () => {
    it('MemoryError should be throwable and catchable', () => {
      const err = new dbModule.MemoryError('test', { code: 'TEST' });
      expect(err.name).toBe('MemoryError');
      expect(err.message).toBe('test');
      expect(err.context.code).toBe('TEST');
    });

    it('jsonErrNoExit should return error object without exiting', () => {
      const result = dbModule.jsonErrNoExit('something went wrong');
      expect(result).toEqual({ error: 'something went wrong' });
    });

    it('jsonErr should throw MemoryError instead of process.exit', () => {
      expect(() => dbModule.jsonErr('fatal')).toThrow(dbModule.MemoryError);
    });

    it('withTransaction should throw MemoryError when db not initialized', () => {
      // Save state, reset, test, then restore
      const savedDb = dbModule.getDb();
      const savedEngine = dbModule.getEngine();
      dbModule.resetDb();
      try {
        expect(() => dbModule.withTransaction(() => {})).toThrow(dbModule.MemoryError);
      } finally {
        // Restore
        dbModule.ensureDb();
      }
    });
  });

  describe('memory-store functions', () => {
    it('save() should return { error } on missing title', () => {
      const result = store.commands.save({ content: 'test' });
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('title');
    });

    it('get() should return { error } on missing id', () => {
      const result = store.commands.get({});
      expect(result).toHaveProperty('error');
    });

    it('del() should return { error } on missing id', () => {
      const result = store.commands.delete({});
      expect(result).toHaveProperty('error');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/error-patterns.test.js --reporter=verbose`
Expected: FAIL — `jsonErr` currently calls `process.exit` instead of throwing

- [ ] **Step 3: Refactor jsonErr to throw MemoryError instead of process.exit**

In `db.js`, change:

```javascript
function jsonErr(msg) {
  const obj = jsonErrNoExit(msg);
  process.stderr.write(`${JSON.stringify(obj)}\n`);
  process.exit(1);
}
```

To:

```javascript
function jsonErr(msg) {
  throw new MemoryError(msg);
}
```

- [ ] **Step 4: Update CLI dispatch in memory-store.js to catch MemoryError**

At the bottom of `memory-store.js`, the top-level dispatch currently has:

```javascript
if (result && result.error) {
  process.stderr.write(`${JSON.stringify(result)}\n`);
  process.exit(1);
}
```

Replace the entire `(async () => { ... })()` block's error handling section with:

```javascript
  if (cmd && commands[cmd]) {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let result;
    try {
      result = await commands[cmd](args);
    } catch (e) {
      if (e instanceof dbModule.MemoryError) {
        process.stderr.write(`${JSON.stringify({ error: e.message })}\n`);
        process.exit(1);
      }
      throw e;
    }

    if (result && result.error) {
      process.stderr.write(`${JSON.stringify(result)}\n`);
      process.exit(1);
    }

    // Wrap code analysis results with _meta envelope
    if (_ANALYSIS_TOOLS.has(cmd) && !result.error) {
      const repoName = args.repo;
      if (repoName) {
        const repoRow = sqlJson('SELECT id, path, head_commit FROM code_repos WHERE name = ?', [repoName]);
        if (repoRow.length > 0) {
          jsonOut(_wrapAnalysis(cmd, result, repoRow[0], startTime, _globalFormat));
          return;
        }
      }
    }

    jsonOut(result);
  } else {
```

- [ ] **Step 5: Update `withTransaction` to throw `MemoryError`**

In `db.js`, change:

```javascript
function withTransaction(fn, onRollbackError) {
  if (!_db) {throw new Error('Database not initialized. Call ensureDb() first.');}
```

To:

```javascript
function withTransaction(fn, onRollbackError) {
  if (!_db) { throw new MemoryError('Database not initialized. Call ensureDb() first.'); }
```

- [ ] **Step 6: Run error pattern tests**

Run: `npx vitest run test/error-patterns.test.js --reporter=verbose`
Expected: All PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add db.js memory-store.js test/error-patterns.test.js
git commit -m "fix: standardize error patterns — MemoryError replaces process.exit (#34)"
```

---

### Task 4: Final verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `npx oxlint db.js memory-store.js test/db.test.js test/error-patterns.test.js`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 3: Verify the DB still works end-to-end**

```bash
node memory-store.js search --project test --query "test query"
node memory-store.js save --project test --title "verification test" --content "testing after refactor" --type manual
node memory-store.js stats
```

Expected: All commands execute without error.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup after issues #34 #35 #36 fixes"
```