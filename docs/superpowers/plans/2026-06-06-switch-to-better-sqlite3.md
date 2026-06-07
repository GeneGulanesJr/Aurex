# Switch SQLite Backend to better-sqlite3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `@libsql/client` dependency with `better-sqlite3`, fixing the runtime `MODULE_NOT_FOUND` crash and removing all stale libsql references.

**Architecture:** `db.js` already uses the `better-sqlite3` sync API (`new Database(path)`, `.exec()`, `.prepare()`, `.transaction()`). The code was never updated after the package.json was switched to `@libsql/client`. This plan reverts the dependency, cleans up all libsql references in code/tests/docs, and fixes a secondary bug where `findLapisRoot()` checks for the wrong package name.

**Tech Stack:** Node.js, better-sqlite3, Vitest

---

## File Impact Map

| File | Action | What changes |
|---|---|---|
| `package.json` | Modify | Replace `@libsql/client` with `better-sqlite3` in dependencies |
| `db.js` | Modify | Rewrite `tryLibsql()` → `openBetterSqlite3()`, update header, fix `findLapisRoot()` package name check, update error messages, update `_engine` value |
| `utils.js` | Modify | Update error messages in `requireNativeDb()` and `withDb()` |
| `test/db.test.js` | Modify | Update engine assertions from `'libsql'` to `'better-sqlite3'` |
| `README.md` | Modify | Update Requirements section |

---

### Task 1: Swap the dependency in package.json

**Files:**
- Modify: `package.json` (dependencies section)

- [ ] **Step 1: Remove `@libsql/client` and add `better-sqlite3`**

In `package.json`, in the `"dependencies"` object, replace:

```json
"@libsql/client": "^0.17.3",
```

with:

```json
"better-sqlite3": "^12.9.0",
```

- [ ] **Step 2: Install the new dependency**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && npm install`

Expected: `better-sqlite3` installs successfully with prebuilt native binary. No errors.

- [ ] **Step 3: Verify the binary is present**

Run: `node -e "const Database = require('better-sqlite3'); const d = new Database(':memory:'); console.log('OK:', typeof d.prepare);"`

Expected: `OK: function`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix: replace @libsql/client with better-sqlite3 in dependencies"
```

---

### Task 2: Rewrite the DB backend in db.js

**Files:**
- Modify: `db.js:1-7` (file header comment)
- Modify: `db.js:102-136` (backend detection + openDb)
- Modify: `db.js:87-90` (findLapisRoot package name check)

- [ ] **Step 1: Update the file header comment**

Replace lines 1-7:

```javascript
/**
 * Db.js — Database layer for Pi Memory Layer
 *
 * SQLite backend via libSQL, installed through @libsql/client.
 * Zero external Python deps. Zero MCP servers.
 */
```

with:

```javascript
/**
 * Db.js — Database layer for Pi Memory Layer
 *
 * SQLite backend via better-sqlite3.
 * Zero external Python deps. Zero MCP servers.
 */
```

- [ ] **Step 2: Fix `findLapisRoot()` package name check**

In `findLapisRoot()`, the check `pkg.name === 'lapis'` will never match because the actual package name is `@genegulanesjr/lapis`. Fix it:

Replace:

```javascript
      if (pkg.name === 'lapis') {
```

with:

```javascript
      if (pkg.name === '@genegulanesjr/lapis' || pkg.name === 'lapis') {
```

- [ ] **Step 3: Replace `tryLibsql()` with `openBetterSqlite3()`**

Replace the entire `tryLibsql` function (lines ~102-117):

```javascript
function tryLibsql() {
  try {
    const cfg = getConfig();
    const Database = require('libsql');
    const d = new Database(cfg.db_path);
    d.exec('PRAGMA journal_mode=WAL;');
    d.exec('PRAGMA synchronous=NORMAL;');
    d.exec('PRAGMA temp_store=MEMORY;');
    d.exec(`PRAGMA busy_timeout=${safeInt(cfg.busy_timeout_ms, 30000)};`);
    d.exec(`PRAGMA wal_autocheckpoint=${safeInt(cfg.wal_autocheckpoint, 1000)};`);
    d.exec('PRAGMA foreign_keys=ON;');
    return d;
  } catch (e) {
    console.error(`[db] libsql failed: ${e.message}`);
    return null;
  }
}
```

with:

```javascript
function openBetterSqlite3() {
  try {
    const cfg = getConfig();
    const Database = require('better-sqlite3');
    const d = new Database(cfg.db_path);
    d.pragma('journal_mode = WAL');
    d.pragma('synchronous = NORMAL');
    d.pragma('temp_store = MEMORY');
    d.pragma(`busy_timeout = ${safeInt(cfg.busy_timeout_ms, 30000)}`);
    d.pragma(`wal_autocheckpoint = ${safeInt(cfg.wal_autocheckpoint, 1000)}`);
    d.pragma('foreign_keys = ON');
    return d;
  } catch (e) {
    console.error(`[db] better-sqlite3 failed: ${e.message}`);
    return null;
  }
}
```

Note: `better-sqlite3` uses `.pragma()` instead of `.exec('PRAGMA ...')`. Both work, but `.pragma()` is the idiomatic API.

- [ ] **Step 4: Update `openDb()` to use the new function**

Replace the `openDb` function (lines ~121-136):

```javascript
function openDb() {
  const libsqlDb = tryLibsql();
  if (libsqlDb) {
    _engine = 'libsql';
    _db = libsqlDb;
    return libsqlDb;
  }
  const lapisRoot = findLapisRoot();
  const msg =
    `No libSQL backend found. LaPis does not install dependencies at runtime.\n` +
    `  Run: cd ${lapisRoot} && npm install\n`;
  throw new Error(msg);
}
```

with:

```javascript
function openDb() {
  const db = openBetterSqlite3();
  if (db) {
    _engine = 'better-sqlite3';
    _db = db;
    return db;
  }
  const lapisRoot = findLapisRoot();
  const msg =
    `No SQLite backend found. LaPis does not install dependencies at runtime.\n` +
    `  Run: cd ${lapisRoot} && npm install\n`;
  throw new Error(msg);
}
```

- [ ] **Step 5: Verify the file loads without errors**

Run: `node -e "require('./db.js');"` from the project root.

Expected: No errors (it will try to open/create the DB, which should succeed now).

- [ ] **Step 6: Commit**

```bash
git add db.js
git commit -m "fix: switch db.js to better-sqlite3 backend, fix findLapisRoot package name"
```

---

### Task 3: Update error messages in utils.js

**Files:**
- Modify: `utils.js:19` (`requireNativeDb` error message)
- Modify: `utils.js:29` (`withDb` error message)

- [ ] **Step 1: Update `requireNativeDb` error message**

Replace:

```javascript
      error: `This operation requires a native SQLite backend via libSQL (@libsql/client). The CLI fallback does not support ${featureName}.`,
```

with:

```javascript
      error: `This operation requires a native SQLite backend (better-sqlite3). The CLI fallback does not support ${featureName}.`,
```

- [ ] **Step 2: Update `withDb` error message**

Replace:

```javascript
        error: `This operation requires a native SQLite backend via libSQL (@libsql/client). The CLI fallback does not support ${featureName}.`,
```

with:

```javascript
        error: `This operation requires a native SQLite backend (better-sqlite3). The CLI fallback does not support ${featureName}.`,
```

- [ ] **Step 3: Commit**

```bash
git add utils.js
git commit -m "fix: update SQLite backend error messages from libsql to better-sqlite3"
```

---

### Task 4: Update test assertions in db.test.js

**Files:**
- Modify: `test/db.test.js:41` (engine assertion)
- Modify: `test/db.test.js:59` (getEngine assertion)

- [ ] **Step 1: Update first engine assertion (~line 41)**

Replace:

```javascript
      expect(['libsql']).toContain(result.engine);
```

with:

```javascript
      expect(['better-sqlite3']).toContain(result.engine);
```

- [ ] **Step 2: Update second engine assertion (~line 59)**

Replace:

```javascript
      expect(['libsql']).toContain(engine);
```

with:

```javascript
      expect(['better-sqlite3']).toContain(engine);
```

- [ ] **Step 3: Commit**

```bash
git add test/db.test.js
git commit -m "fix: update db test engine assertions from libsql to better-sqlite3"
```

---

### Task 5: Update README.md

**Files:**
- Modify: `README.md:135` (Requirements section)

- [ ] **Step 1: Update the Requirements section**

Replace:

```markdown
- `@libsql/client` for async local SQLite/libSQL access
```

with:

```markdown
- `better-sqlite3` for local SQLite access
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README to reflect better-sqlite3 dependency"
```

---

### Task 6: Run the full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && npm test`

Expected: All tests pass. Zero failures.

- [ ] **Step 2: Run lint check**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && npm run check`

Expected: No errors.

- [ ] **Step 3: Smoke test the CLI**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node memory-store.js search --limit 5 test`

Expected: Returns search results or "no results" without crashing.

- [ ] **Step 4: Final verification commit (if any formatting fixes needed)**

```bash
git add -A
git commit -m "chore: formatting fixes after better-sqlite3 migration"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ Replace `@libsql/client` with `better-sqlite3` in package.json → Task 1
- ✅ Fix `require('libsql')` in db.js → Task 2
- ✅ Fix `findLapisRoot` package name check → Task 2
- ✅ Update `_engine` value → Task 2
- ✅ Update error messages in utils.js → Task 3
- ✅ Update test assertions → Task 4
- ✅ Update README → Task 5
- ✅ Full verification → Task 6

**2. Placeholder scan:** No TBD, TODO, or "implement later" found. All steps contain exact code.

**3. Type consistency:**
- Engine value `'better-sqlite3'` is used consistently across db.js, utils.js error messages, and test assertions.
- `better-sqlite3` API: `new Database(path)`, `.pragma()`, `.prepare()`, `.transaction()` — all match the existing usage patterns in db.js.
- `findLapisRoot` now checks both `@genegulanesjr/lapis` (actual name) and `lapis` (fallback for monorepo setups).
