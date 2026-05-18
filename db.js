/**
 * Db.js — Database layer for Pi Memory Layer
 *
 * Thin async adapter around @libsql/client. Feature code depends on this file's
 * small database shape rather than the driver directly so the backend can be
 * swapped later.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@libsql/client');
const { getConfig } = require('./config');

class MemoryError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'MemoryError';
    this.context = context;
  }
}

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

let _db = null;
let _engine = null;

function getDb() {
  return _db;
}
function getEngine() {
  return _engine;
}
function getDbPath() {
  return getConfig().db_path;
}

function normalizeArgs(params = []) {
  return params == null ? [] : Array.isArray(params) ? params : [params];
}
function normalizeRunResult(result) {
  return {
    changes: result.rowsAffected ?? 0,
    rowsAffected: result.rowsAffected ?? 0,
    lastInsertRowid: result.lastInsertRowid,
  };
}
function createStatementAdapter(adapter, sql) {
  return {
    all: (...params) => adapter.all(sql, params),
    get: (...params) => adapter.get(sql, params),
    run: (...params) => adapter.run(sql, params),
  };
}
function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}
function createDbAdapter(client) {
  const adapter = {
    client,
    async execute(sql, params = []) {
      if (typeof sql === 'object') return client.execute(sql);
      return client.execute({ sql, args: normalizeArgs(params) });
    },
    async all(sql, params = []) {
      return (await this.execute(sql, params)).rows;
    },
    async get(sql, params = []) {
      return (await this.all(sql, params))[0];
    },
    async run(sql, params = []) {
      return normalizeRunResult(await this.execute(sql, params));
    },
    async exec(sql) {
      if (typeof client.executeMultiple === 'function') return client.executeMultiple(sql);
      for (const stmt of splitSqlStatements(sql)) await this.execute(stmt);
    },
    prepare(sql) {
      return createStatementAdapter(this, sql);
    },
    async transaction(fn, mode = 'write') {
      const tx = await client.transaction(mode);
      const txAdapter = createDbAdapter(tx);
      try {
        const result = await fn(txAdapter);
        await tx.commit();
        return result;
      } catch (e) {
        try {
          await tx.rollback();
        } catch (rollbackErr) {
          console.error('[db] ROLLBACK failed:', rollbackErr.message);
        }
        throw e;
      }
    },
    close() {
      client.close();
    },
  };
  return adapter;
}

async function resetDb() {
  if (_db) {
    try {
      _db.close();
    } catch (_) {}
  }
  _db = null;
  _engine = null;
}

async function createDb(configOverride = {}) {
  const mergedConfig = { ...getConfig(), ...configOverride };
  const savedConfig = getConfig._cached;
  const savedDb = _db;
  const savedEngine = _engine;
  getConfig._cached = mergedConfig;
  try {
    _db = null;
    _engine = null;
    return await ensureDb();
  } catch (e) {
    _db = savedDb;
    _engine = savedEngine;
    getConfig._cached = savedConfig;
    throw e;
  }
}

async function openDb() {
  const cfg = getConfig();
  const client = createClient({ url: `file:${path.resolve(cfg.db_path)}` });
  const db = createDbAdapter(client);
  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec(
    `PRAGMA busy_timeout=${Number.isInteger(Number(cfg.busy_timeout_ms)) ? Number(cfg.busy_timeout_ms) : 5000};`,
  );
  await db.exec(
    `PRAGMA wal_autocheckpoint=${Number.isInteger(Number(cfg.wal_autocheckpoint)) ? Number(cfg.wal_autocheckpoint) : 1000};`,
  );
  await db.exec('PRAGMA foreign_keys=ON;');
  _db = db;
  _engine = 'libsql';
  return db;
}

async function sqlJson(query, params = []) {
  try {
    return await _db.all(query, params);
  } catch (e) {
    throw new Error(`SQL error: ${e.message}\nQuery: ${query}`, { cause: e });
  }
}
async function sqlRun(query, params = []) {
  try {
    return await _db.run(query, params);
  } catch (e) {
    throw new Error(`SQL error: ${e.message}\nQuery: ${query}`, { cause: e });
  }
}
async function sqlRaw(sql) {
  try {
    return await _db.exec(sql);
  } catch (e) {
    throw new Error(`SQL exec error: ${e.message}`, { cause: e });
  }
}
async function withTransaction(fn, onRollbackError) {
  if (!_db) throw new MemoryError('Database not initialized. Call ensureDb() first.');
  try {
    return await _db.transaction(fn);
  } catch (e) {
    if (typeof onRollbackError === 'function') {
      try {
        onRollbackError(e);
      } catch (_) {}
    }
    throw e;
  }
}

async function ensureDb() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!_db) await openDb();
  {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    try {
      await _db.exec(schema);
    } catch (_) {
      for (const stmt of splitSqlStatements(schema).filter((s) => !/^\s*PRAGMA/i.test(s))) {
        try {
          await sqlRaw(stmt);
        } catch (e) {
          if (!/already exists|duplicate column/i.test(e.message))
            console.error(`[db] Schema statement error: ${e.message}`);
        }
      }
    }
  }
  return { ok: true, db: dbPath, engine: _engine };
}

function jsonOut(obj) {
  console.log(JSON.stringify(obj, null, 2));
}
function jsonErrNoExit(msg) {
  return { error: msg };
}
function jsonErr(msg) {
  throw new MemoryError(msg);
}
function parseArgs(argv) {
  const args = {};
  let key = null;
  for (const arg of argv.slice(3)) {
    if (arg.startsWith('--')) {
      key = arg.slice(2);
      args[key] = true;
    } else if (key) {
      args[key] = arg;
      key = null;
    }
  }
  return args;
}

module.exports = {
  get DB_PATH() {
    return getConfig().db_path;
  },
  SCHEMA_PATH,
  HOME,
  getDb,
  getEngine,
  getDbPath,
  resetDb,
  createDb,
  sqlJson,
  sqlRun,
  sqlRaw,
  ensureDb,
  withTransaction,
  jsonOut,
  jsonErr,
  jsonErrNoExit,
  parseArgs,
  MemoryError,
};
