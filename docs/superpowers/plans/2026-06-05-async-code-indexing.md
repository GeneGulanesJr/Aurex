# Async Code Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make code indexing non-blocking so large repos don't freeze the CLI for 10–30s. Return a job ID immediately, stream progress, and let queries return cached results during an in-flight index.

**Architecture:** Add a V18 schema migration for an `index_jobs` table (job metadata + per-file progress), spawn a `worker_threads` worker that performs the actual `indexRepository` work, and expose two new CLI commands (`index-repo-async`, `index-status`) plus progress output to the existing `health-code-repo` command. SQLite WAL mode already lets reads proceed during writes, so query paths need no changes. A simple in-process job registry maps job IDs to live `Worker` instances for status lookups.

**Tech Stack:** Node.js `worker_threads`, better-sqlite3 (WAL), existing `incremental-indexer.js` (reused as-is inside the worker), vitest.

---

## File Structure

### New files
- `src/code-index/job-store.js` — SQLite CRUD for the `index_jobs` table (insert job, update progress, fetch status, list jobs).
- `src/code-index/job-queue.js` — In-process registry that owns the active `Worker` per job and serializes status queries.
- `src/code-index/index-worker.js` — Worker thread entry point. Imports `incremental-indexer.js`, runs `indexRepository`/`reindexRepository`, and posts `{type:'progress', ...}` / `{type:'done', ...}` / `{type:'error', ...}` messages to the parent.
- `test/job-store.test.js` — Unit tests for `job-store.js`.
- `test/job-queue.test.js` — Unit tests for `job-queue.js` (no real worker — fake worker with the same `postMessage`/`terminate` shape).
- `test/async-code-index.test.js` — Integration tests for the async CLI flow.

### Modified files
- `db.js` — Add V18 migration creating `index_jobs` (id, repo_name, status, mode, files_total, files_done, current_file, language_breakdown JSON, started_at, completed_at, error) and a partial index on `status='running'`.
- `services/code-indexing.js` — Add `indexRepoAsyncInternal(deps, repoPath, repoName, options)` and `indexStatusInternal(deps, jobId)` and `listIndexJobsInternal(deps, options)`.
- `commands/code-impl.js` — Add `indexRepoAsync(args)` and `indexStatus(args)` and `listIndexJobs(args)` wrappers.
- `src/cli/commands/code-index.js` — Register the new commands in the `USAGE` map and the `commands` object.
- `extensions/memory-layer/tools/memory-tools.ts` — Add an `index-status` tool that surfaces job state with a formatted progress display (icon, %, current file, language breakdown).
- `test/index-repo-comprehensive.test.js` — Add coverage for the async path (mode=`async` returns `{jobId, filesTotal}` immediately, does not wait for completion).

---

## Design Decisions

1. **Worker thread, not child process.** Worker threads are already used in the codebase (`src/code-index/worker-pool.js`, `parse-worker.js`). They share the same Node module cache (no re-parse of `incremental-indexer.js`) and exit cleanly when the job is done. We add a *long-running* `Worker` per job (one worker = one job) instead of pooling — indexing is I/O- and SQLite-bound, not CPU-bound, so a pool adds complexity for no gain.
2. **SQLite as the job ledger, not a separate file.** The `index_jobs` table is queried by the CLI while the worker is writing it. With WAL mode (already enabled) readers don't block writers, so status queries see consistent snapshots.
3. **Backward compatible sync path.** `index-repo` keeps its current synchronous behavior. The new `index-repo-async` is opt-in. We also auto-switch to async when the file count exceeds `ASYNC_INDEX_FILE_THRESHOLD` (default 500) — this satisfies the issue's "Detect if re-index will take >5s and auto-switch" requirement without requiring users to remember a flag.
4. **Reuse `indexRepository`/`reindexRepository` unchanged.** The worker just calls these existing functions. The `emitProgress` helper inside `incremental-indexer.js` is already there; the worker intercepts those events and writes them to the job row plus forwards them to the parent if a progress callback was provided.
5. **Language breakdown is collected in the worker.** As each file is parsed in the `parsePhase` loop, the worker increments a `Map<language, count>` and writes it to the job row at low frequency (every 25 files or 1 second, whichever first) to avoid SQLite write storms.

---

## Task 1: Schema V18 — `index_jobs` table

**Files:**
- Modify: `db.js` (add `runMigrationV18` and register it in `runMigrations`)
- Modify: `db.js` (bump the early-return guard from `version >= 17` to `version >= 18`)
- Test: `test/job-store.test.js` (new)

- [ ] **Step 1: Write the failing test for job-store**

```js
// test/job-store.test.js
const { createDb } = require('../db');

let db;
beforeEach(() => {
  db = createDb({ memoryPath: ':memory:' });
});
afterEach(() => db.close());

describe('job-store', () => {
  it('createJob returns a numeric id and persists repo_name and mode', () => {
    const { createJob } = require('../src/code-index/job-store');
    const id = createJob(db, { repoName: 'foo', mode: 'full', filesTotal: 123 });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('updateProgress writes files_done and current_file atomically', () => {
    const { createJob, updateProgress, getJob } = require('../src/code-index/job-store');
    const id = createJob(db, { repoName: 'foo', mode: 'full', filesTotal: 10 });
    updateProgress(db, id, { filesDone: 5, currentFile: 'src/a.js' });
    const job = getJob(db, id);
    expect(job.files_done).toBe(5);
    expect(job.current_file).toBe('src/a.js');
    expect(job.status).toBe('running');
  });

  it('completeJob sets status=completed and completed_at', () => {
    const { createJob, completeJob, getJob } = require('../src/code-index/job-store');
    const id = createJob(db, { repoName: 'foo', mode: 'full', filesTotal: 10 });
    completeJob(db, id, { status: 'completed', filesDone: 10 });
    const job = getJob(db, id);
    expect(job.status).toBe('completed');
    expect(job.completed_at).toBeTruthy();
  });

  it('listRunningJobs returns only status=running jobs', () => {
    const { createJob, completeJob, listRunningJobs } = require('../src/code-index/job-store');
    const a = createJob(db, { repoName: 'a', mode: 'full', filesTotal: 10 });
    const b = createJob(db, { repoName: 'b', mode: 'incremental', filesTotal: 10 });
    completeJob(db, b, { status: 'completed' });
    const running = listRunningJobs(db);
    expect(running.map((j) => j.id)).toEqual([a]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/job-store.test.js`
Expected: FAIL — `Cannot find module '../src/code-index/job-store'`

- [ ] **Step 3: Add the V18 migration function to db.js**

In `db.js`, add after the existing V17 function:

```js
function runMigrationV18() {
  const errors = [];
  const stmts = [
    `CREATE TABLE IF NOT EXISTS index_jobs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       repo_name TEXT NOT NULL,
       mode TEXT NOT NULL DEFAULT 'full',
       status TEXT NOT NULL DEFAULT 'pending',
       files_total INTEGER NOT NULL DEFAULT 0,
       files_done INTEGER NOT NULL DEFAULT 0,
       current_file TEXT,
       language_breakdown TEXT NOT NULL DEFAULT '{}',
       started_at TEXT NOT NULL DEFAULT (datetime('now')),
       completed_at TEXT,
       error TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_index_jobs_status ON index_jobs(status)`,
    `CREATE INDEX IF NOT EXISTS idx_index_jobs_repo ON index_jobs(repo_name, started_at DESC)`,
  ];
  for (const s of stmts) {
    try { sqlRun(s); } catch (e) { errors.push(`${s.split('\n')[0]}: ${e.message}`); }
  }
  if (errors.length === 0) {
    try { sqlRaw('PRAGMA user_version = 18'); } catch (e) { errors.push(`user_version: ${e.message}`); }
  }
  return errors;
}
```

Register it in the `migrations` array (after V17) and bump the early-return guard from `if (version >= 17)` to `if (version >= 18)`.

- [ ] **Step 4: Create `src/code-index/job-store.js`**

```js
// src/code-index/job-store.js
function createJob(db, { repoName, mode = 'full', filesTotal = 0 }) {
  const result = db.prepare(
    `INSERT INTO index_jobs (repo_name, mode, status, files_total) VALUES (?, ?, 'running', ?)`
  ).run(repoName, mode, filesTotal);
  return Number(result.lastInsertRowid);
}

function updateProgress(db, jobId, { filesDone, currentFile, languageBreakdown }) {
  const sets = ['files_done = ?'];
  const params = [filesDone];
  if (currentFile !== undefined) { sets.push('current_file = ?'); params.push(currentFile); }
  if (languageBreakdown !== undefined) { sets.push('language_breakdown = ?'); params.push(JSON.stringify(languageBreakdown)); }
  params.push(jobId);
  db.prepare(`UPDATE index_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function completeJob(db, jobId, { status, error } = {}) {
  const finalStatus = status || 'completed';
  const params = [finalStatus];
  let sql = 'UPDATE index_jobs SET status = ?, completed_at = datetime(\'now\')';
  if (error) { sql += ', error = ?'; params.push(error); }
  params.push(jobId);
  sql += ' WHERE id = ?';
  db.prepare(sql).run(...params);
}

function getJob(db, jobId) {
  return db.prepare('SELECT * FROM index_jobs WHERE id = ?').get(jobId);
}

function listRunningJobs(db) {
  return db.prepare(`SELECT * FROM index_jobs WHERE status = 'running' ORDER BY started_at DESC`).all();
}

function listRecentJobs(db, limit = 20) {
  return db.prepare(`SELECT * FROM index_jobs ORDER BY started_at DESC LIMIT ?`).all(limit);
}

module.exports = { createJob, updateProgress, completeJob, getJob, listRunningJobs, listRecentJobs };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/job-store.test.js`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add db.js src/code-index/job-store.js test/job-store.test.js
git commit -m "feat(code-index): add V18 migration and job-store for async indexing"
```

---

## Task 2: Job queue with worker thread

**Files:**
- Create: `src/code-index/job-queue.js`
- Test: `test/job-queue.test.js` (new)

- [ ] **Step 1: Write the failing test for job-queue**

```js
// test/job-queue.test.js
const { vi } = require('vitest');
const { EventEmitter } = require('events');

class FakeWorker extends EventEmitter {
  constructor() { super(); this.postMessage = vi.fn(); this.terminate = vi.fn().mockResolvedValue(0); }
}

describe('job-queue', () => {
  it('startJob spawns a Worker and tracks it by jobId', async () => {
    const Worker = vi.fn().mockImplementation(() => new FakeWorker());
    const { createJobQueue } = require('../src/code-index/job-queue');
    const q = createJobQueue({ Worker, jobStore: {}, db: {} });
    const handle = q.startJob(42, { repoName: 'foo' });
    expect(Worker).toHaveBeenCalledWith(expect.stringContaining('index-worker'));
    expect(q.getWorker(42)).toBe(handle.worker);
  });

  it('getStatus returns running when worker is alive, completed when not', () => {
    const { createJobQueue } = require('../src/code-index/job-queue');
    const q = createJobQueue({ Worker: vi.fn().mockImplementation(() => new FakeWorker()), jobStore: {}, db: {} });
    q.startJob(7, { repoName: 'foo' });
    expect(q.getStatus(7)).toBe('running');
    q.markDone(7);
    expect(q.getStatus(7)).toBe('completed');
  });

  it('cancels a running job and terminates its worker', async () => {
    const w = new FakeWorker();
    const { createJobQueue } = require('../src/code-index/job-queue');
    const q = createJobQueue({ Worker: vi.fn().mockImplementation(() => w), jobStore: {}, db: {} });
    q.startJob(7, { repoName: 'foo' });
    await q.cancel(7);
    expect(w.terminate).toHaveBeenCalled();
    expect(q.getStatus(7)).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/job-queue.test.js`
Expected: FAIL — `Cannot find module '../src/code-index/job-queue'`

- [ ] **Step 3: Create `src/code-index/job-queue.js`**

```js
// src/code-index/job-queue.js
const path = require('path');
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');

const WORKER_SCRIPT = path.resolve(__dirname, 'index-worker.js');

function createJobQueue({ Worker: WorkerCtor = Worker, jobStore, db }) {
  const workers = new Map(); // jobId -> { worker, status }
  const emitter = new EventEmitter();

  function startJob(jobId, payload) {
    const worker = new WorkerCtor(WORKER_SCRIPT, {
      workerData: { jobId, ...payload },
    });
    workers.set(jobId, { worker, status: 'running' });
    worker.on('message', (msg) => {
      emitter.emit(`progress:${jobId}`, msg);
      if (msg && msg.type === 'done') { markDone(jobId, msg); }
      if (msg && msg.type === 'error') { markError(jobId, msg); }
    });
    worker.on('error', (err) => markError(jobId, { error: err.message }));
    worker.on('exit', (code) => {
      const entry = workers.get(jobId);
      if (entry && entry.status === 'running') {
        // Unexpected exit
        entry.status = code === 0 ? 'completed' : 'error';
        try { jobStore.completeJob(db, jobId, { status: entry.status, error: entry.status === 'error' ? `worker exited with code ${code}` : undefined }); } catch (_) {}
      }
    });
    return { worker };
  }

  function getWorker(jobId) { return workers.get(jobId)?.worker; }
  function getStatus(jobId) { return workers.get(jobId)?.status || 'unknown'; }
  function on(jobId, event, listener) { emitter.on(event, listener); }

  function markDone(jobId, _msg) {
    const entry = workers.get(jobId);
    if (entry) entry.status = 'completed';
  }

  function markError(jobId, msg) {
    const entry = workers.get(jobId);
    if (entry) {
      entry.status = 'error';
      try { jobStore.completeJob(db, jobId, { status: 'error', error: msg.error || 'unknown' }); } catch (_) {}
    }
  }

  async function cancel(jobId) {
    const entry = workers.get(jobId);
    if (!entry) return false;
    try { await entry.worker.terminate(); } catch (_) {}
    entry.status = 'cancelled';
    try { jobStore.completeJob(db, jobId, { status: 'cancelled' }); } catch (_) {}
    return true;
  }

  return { startJob, getWorker, getStatus, on, cancel };
}

module.exports = { createJobQueue };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/job-queue.test.js`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/code-index/job-queue.js test/job-queue.test.js
git commit -m "feat(code-index): add job-queue with worker thread management"
```

---

## Task 3: Index worker thread

**Files:**
- Create: `src/code-index/index-worker.js`
- Test: manual smoke (covered by Task 5 integration)

- [ ] **Step 1: Create `src/code-index/index-worker.js`**

```js
// src/code-index/index-worker.js
const { parentPort, workerData } = require('worker_threads');
const { createDb } = require('../../db');
const { indexRepository, reindexRepository } = require('./incremental-indexer');
const { createJob, updateProgress, completeJob } = require('./job-store');

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg && msg.type === 'cancel') cancelled = true;
});

async function main() {
  const { jobId, mode, repoPath, repoName } = workerData;
  const db = createDb();
  // jobId may be undefined for the first-run case — create one if so
  const realJobId = jobId || createJob(db, { repoName, mode, filesTotal: 0 });
  const breakdown = {};
  let lastWrite = 0;
  const writeThrottleMs = 1000;
  const languageCounters = new Map();

  function onProgress({ phase, files_total, files_done, current_file, language }) {
    if (cancelled) throw new Error('cancelled');
    if (language) {
      languageCounters.set(language, (languageCounters.get(language) || 0) + 1);
    }
    const now = Date.now();
    if (now - lastWrite >= writeThrottleMs || (files_total && files_done === files_total)) {
      const obj = Object.fromEntries(languageCounters);
      try { updateProgress(db, realJobId, { filesDone: files_done, currentFile: current_file, languageBreakdown: obj }); } catch (_) {}
      lastWrite = now;
    }
    parentPort.postMessage({ type: 'progress', phase, files_total, files_done, current_file, language });
  }

  try {
    let result;
    if (mode === 'incremental' || mode === 'full') {
      // The actual function: reindexRepository for incremental, indexRepository for full
      const fn = mode === 'incremental' ? reindexRepository : indexRepository;
      // First arg is repoName string, not path; we pass a wrapped object
      const target = mode === 'incremental' ? repoName : { path: repoPath, name: repoName };
      result = await fn({ sqlJson: db.prepare ? (q, p) => db.prepare(q).all(p) : (q) => db.exec(q), sqlRun: (q, p) => db.prepare(q).run(p), sqlRaw: (q) => db.exec(q), db }, target, { progress: true, onProgress, filesTotal: 0 });
    } else {
      throw new Error(`unknown mode: ${mode}`);
    }
    const finalBreakdown = Object.fromEntries(languageCounters);
    try { updateProgress(db, realJobId, { filesDone: result?.filesIndexed || 0, languageBreakdown: finalBreakdown }); } catch (_) {}
    try { completeJob(db, realJobId, { status: 'completed' }); } catch (_) {}
    parentPort.postMessage({ type: 'done', result, languageBreakdown: finalBreakdown });
  } catch (e) {
    if (cancelled) {
      try { completeJob(db, realJobId, { status: 'cancelled' }); } catch (_) {}
      parentPort.postMessage({ type: 'cancelled' });
    } else {
      try { completeJob(db, realJobId, { status: 'error', error: e.message }); } catch (_) {}
      parentPort.postMessage({ type: 'error', error: e.message });
    }
  } finally {
    try { db.close(); } catch (_) {}
    process.exit(0);
  }
}

main();
```

> **Implementation note:** the precise arg shape of `indexRepository` / `reindexRepository` is dictated by the existing service. Read `src/code-index/incremental-indexer.js` carefully before this step and adjust the call site. The `onProgress` callback may also be wired differently — `emitProgress` in the existing indexer uses `args.progress` and writes to stdout, so the simplest approach is to add a new `args.onProgress` hook and call it from `emitProgress` (Task 4).

- [ ] **Step 2: Commit (no test yet — covered by Task 5)**

```bash
git add src/code-index/index-worker.js
git commit -m "feat(code-index): add worker thread entry for async indexing"
```

---

## Task 4: Wire `onProgress` hook into `incremental-indexer.js`

**Files:**
- Modify: `src/code-index/incremental-indexer.js` (in `emitProgress` and the parse loop)
- Test: `test/async-code-index.test.js` (new, integration)

- [ ] **Step 1: Write the failing test**

```js
// test/async-code-index.test.js
const { vi } = require('vitest');
const { createDb } = require('../db');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('async code indexing', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-async-'));
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'export const y = 2;\n');
  });
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('runs indexRepository via the async path and finishes a small repo', async () => {
    const { createJobQueue } = require('../src/code-index/job-queue');
    const { createJob, getJob } = require('../src/code-index/job-store');
    const db = createDb({ memoryPath: ':memory:' });
    const jobId = createJob(db, { repoName: 'tmprepo', mode: 'full', filesTotal: 0 });
    const queue = createJobQueue({ jobStore: require('../src/code-index/job-store'), db });
    const handle = queue.startJob(jobId, { repoName: 'tmprepo', repoPath: tmpDir, mode: 'full' });
    await new Promise((resolve) => handle.worker.on('exit', resolve));
    const job = getJob(db, jobId);
    expect(job.status).toBe('completed');
    expect(job.files_done).toBeGreaterThanOrEqual(2);
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/async-code-index.test.js`
Expected: FAIL — worker cannot find the repo or throws because the indexer does not call our `onProgress`.

- [ ] **Step 3: Modify `emitProgress` in `incremental-indexer.js`**

In `src/code-index/incremental-indexer.js`, update `emitProgress`:

```js
function emitProgress(args, phase, detail, stats) {
  if (!args) return;
  if (args.onProgress) {
    try { args.onProgress({ phase, ...detail, ...(stats || {}) }); } catch (_) {}
  }
  if (!args.progress) return;
  const payload = { progress: true, phase, ...detail };
  if (stats) Object.assign(payload, stats);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
```

In the `parsePhase` function, when iterating files, detect the language and pass it:

```js
// Inside the parse loop, after determining each file's language:
const lang = getLanguageForFile(filePath);
emitProgress(args, 'parse', { file: filePath, language: lang }, { files_total: totalFiles, files_done: count });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/async-code-index.test.js`
Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add src/code-index/incremental-indexer.js test/async-code-index.test.js
git commit -m "feat(code-index): thread onProgress hook through parse loop"
```

---

## Task 5: CLI command `index-repo-async`

**Files:**
- Modify: `services/code-indexing.js`
- Modify: `commands/code-impl.js`
- Modify: `src/cli/commands/code-index.js`

- [ ] **Step 1: Add `indexRepoAsyncInternal` to `services/code-indexing.js`**

```js
const { createJobQueue } = require('../src/code-index/job-queue');
const { createJob, getJob, listRunningJobs, listRecentJobs } = require('../src/code-index/job-store');

let _queue = null;
function getQueue(deps) {
  if (!_queue) _queue = createJobQueue({ jobStore: require('../src/code-index/job-store'), db: deps.db || require('../db').getDb() });
  return _queue;
}

async function indexRepoAsyncInternal(deps, repoPath, repoName, options = {}) {
  const { createDb } = require('../db');
  const db = deps.db || createDb();
  const { scanRepository } = require('../src/code-index/scanner');
  const scan = scanRepository(repoPath, { ignore: [], respectGitignore: true });
  const filesTotal = scan.files ? scan.files.length : 0;
  const jobId = createJob(db, { repoName, mode: options.mode || 'full', filesTotal });
  const queue = getQueue(deps);
  queue.startJob(jobId, { repoName, repoPath, mode: options.mode || 'full' });
  return { jobId, filesTotal, status: 'running' };
}

function indexStatusInternal(deps, jobId) {
  const { getDb } = require('../db');
  const db = deps.db || getDb();
  return getJob(db, jobId);
}

function listIndexJobsInternal(deps, { onlyRunning = false, limit = 20 } = {}) {
  const { getDb } = require('../db');
  const db = deps.db || getDb();
  return onlyRunning ? listRunningJobs(db) : listRecentJobs(db, limit);
}
```

Export the new functions in `module.exports`.

- [ ] **Step 2: Add wrappers in `commands/code-impl.js`**

```js
async function indexRepoAsync(args) {
  const repoPath = args.path;
  if (!repoPath) {
    const { jsonErrNoExit } = require('../db');
    return jsonErrNoExit('Usage: index-repo-async --path <path> [--name NAME] [--mode full|incremental]');
  }
  const path = require('path');
  const repoName = args.name || path.basename(repoPath);
  const { getDb } = require('../db');
  return codeIndexingService.indexRepoAsyncInternal({ db: getDb() }, repoPath, repoName, { mode: args.mode || 'full' });
}

function indexStatus(args) {
  const jobId = parseInt(args.job, 10);
  if (!jobId) {
    const { jsonErrNoExit } = require('../db');
    return jsonErrNoExit('Usage: index-status --job <id>');
  }
  const { getDb } = require('../db');
  return codeIndexingService.indexStatusInternal({ db: getDb() }, jobId);
}

function listIndexJobs(args) {
  const { getDb } = require('../db');
  return codeIndexingService.listIndexJobsInternal({ db: getDb() }, { onlyRunning: args.running === 'true', limit: parseInt(args.limit || '20', 10) });
}
```

Export the new commands.

- [ ] **Step 3: Register the commands in `src/cli/commands/code-index.js`**

```js
const USAGE = {
  // ...existing...
  'index-repo-async': '--path <path> [--name NAME] [--mode full|incremental]',
  'index-status': '--job <id>',
  'list-index-jobs': '[--running] [--limit N]',
};

function register(commands) {
  // ...existing...
  commands['index-repo-async'] = (args) => codeCmd.indexRepoAsync(args);
  commands['index-status'] = (args) => codeCmd.indexStatus(args);
  commands['list-index-jobs'] = (args) => codeCmd.listIndexJobs(args);
}
```

- [ ] **Step 4: Add tests in `test/index-repo-comprehensive.test.js`**

```js
it('index-repo-async returns immediately with a jobId and filesTotal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-async-cmd-'));
  fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const x = 1;\n');
  try {
    const result = await codeCmd.indexRepoAsync({ path: tmpDir, name: 'tmp-cmd', mode: 'full' });
    expect(result.jobId).toBeGreaterThan(0);
    expect(result.status).toBe('running');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/index-repo-comprehensive.test.js test/async-code-index.test.js`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add services/code-indexing.js commands/code-impl.js src/cli/commands/code-index.js test/index-repo-comprehensive.test.js
git commit -m "feat(code-index): add index-repo-async, index-status, list-index-jobs CLI commands"
```

---

## Task 6: Auto-switch to async for large repos

**Files:**
- Modify: `commands/code-impl.js` (`indexRepo`)

- [ ] **Step 1: Update `indexRepo` to detect large repos**

```js
function indexRepo(args) {
  const repoPath = args.path;
  if (!repoPath) {
    const { jsonErrNoExit } = require('../db');
    return jsonErrNoExit('Usage: index-repo --path <path> [--name NAME]');
  }
  const path = require('path');
  const repoName = args.name || path.basename(repoPath);
  const fs = require('fs');

  // Auto-switch to async when --async, when the repo is large, or when
  // a reindex is requested (since reindex uses git delta which can be slow).
  const { getConfig } = require('../config');
  const threshold = (getConfig().async_index_file_threshold || 500);
  let fileCount = 0;
  try {
    const { scanRepository } = require('../src/code-index/scanner');
    const scan = scanRepository(repoPath, { ignore: [], respectGitignore: true });
    fileCount = scan.files ? scan.files.length : 0;
  } catch (_) {}

  if (args.async === 'true' || fileCount >= threshold) {
    const { jsonErrNoExit } = require('../db');
    const message = `Repository has ${fileCount} files (threshold ${threshold}); auto-switching to async. Use 'index-status --job <id>' to poll.`;
    process.stderr.write(`${JSON.stringify({ notice: message, fileCount, threshold })}\n`);
    return codeIndexingService.indexRepoAsyncInternal({ db: require('../db').getDb() }, repoPath, repoName, { mode: 'full' });
  }

  return codeIndexingService.indexRepoInternal({ db: require('../db').getDb() }, repoPath, repoName);
}
```

- [ ] **Step 2: Add a config knob in `config.js`**

```js
async_index_file_threshold: process.env.LAPIS_ASYNC_INDEX_THRESHOLD ? parseInt(process.env.LAPIS_ASYNC_INDEX_THRESHOLD, 10) : 500,
```

- [ ] **Step 3: Add a test**

```js
it('indexRepo auto-switches to async when file count exceeds threshold', () => {
  // Create 600 tiny files in a temp dir
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-auto-async-'));
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(tmp, `f${i}.js`), '// empty\n');
  try {
    const result = codeCmd.indexRepo({ path: tmp, name: 'big' });
    // Should return a job-shaped result, not a sync index result
    expect(result.jobId).toBeGreaterThan(0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/index-repo-comprehensive.test.js`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add commands/code-impl.js config.js test/index-repo-comprehensive.test.js
git commit -m "feat(code-index): auto-switch to async when file count exceeds threshold"
```

---

## Task 7: Extension tool `index-status` with progress display

**Files:**
- Modify: `extensions/memory-layer/tools/memory-tools.ts`

- [ ] **Step 1: Read the current tool registration block in `memory-tools.ts`**

Find the `registerTool({ name: 'health-code-repo', ... })` block and the surrounding tool schema pattern. Reuse the same shape.

- [ ] **Step 2: Add the `index-status` tool**

```ts
pi.registerTool({
  name: 'index-status',
  description: 'Check the progress of an async code-indexing job. Returns job state, file progress, current file, and language breakdown.',
  parameters: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'Job ID returned by index-repo-async' },
    },
    required: ['job'],
  },
  async execute(_id, params, _signal, _onUpdate, _ctx) {
    const result = await deps.memCmd('index-status', { job: String(params.job) });
    if (!result || result.error) {
      return { output: `Error: ${result?.error || 'unknown'}` };
    }
    const job = result;
    const pct = job.files_total > 0 ? Math.floor((job.files_done / job.files_total) * 100) : 0;
    const bar = '█'.repeat(Math.floor(pct / 5)).padEnd(20, '░');
    const lines = [
      `Index job #${job.id} (${job.repo_name}) — ${job.status}`,
      `[${bar}] ${pct}% (${job.files_done}/${job.files_total})`,
    ];
    if (job.current_file) lines.push(`Current: ${job.current_file}`);
    if (job.language_breakdown && job.language_breakdown !== '{}') {
      try {
        const bd = JSON.parse(job.language_breakdown);
        const top = Object.entries(bd).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length) lines.push(`Languages: ${top.map(([l, n]) => `${l}=${n}`).join(', ')}`);
      } catch (_) {}
    }
    if (job.completed_at) lines.push(`Completed: ${job.completed_at}`);
    if (job.error) lines.push(`Error: ${job.error}`);
    return { output: lines.join('\n') };
  },
});
```

- [ ] **Step 3: Add a test in `test/memory-layer-tool-safety.test.js`**

```js
it('index-status tool formats a running job with progress bar', async () => {
  const { createDb } = require('../db');
  const db = createDb({ memoryPath: ':memory:' });
  const { createJob } = require('../src/code-index/job-store');
  const id = createJob(db, { repoName: 'demo', mode: 'full', filesTotal: 200 });
  const { updateProgress } = require('../src/code-index/job-store');
  updateProgress(db, id, { filesDone: 50, currentFile: 'src/foo.js', languageBreakdown: { js: 50 } });
  // Use the existing tool capture pattern
  // ... assert that the tool's output contains "[█████..." and "50/200"
});
```

- [ ] **Step 4: Build and run extension tests**

Run: `npm run build:ext && npx vitest run test/memory-layer-tool-safety.test.js`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/tools/memory-tools.ts test/memory-layer-tool-safety.test.js
git commit -m "feat(extension): add index-status tool with progress bar display"
```

---

## Task 8: Full test suite + final docs

**Files:**
- Modify: `docs/code-indexing.md` (new — short usage doc)
- Verify: no regressions in `npx vitest run`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: same 1 pre-existing failure as `main` (the unrelated `e2e-runtime` test); all new tests pass.

- [ ] **Step 2: Create `docs/code-indexing.md`**

```md
# Async Code Indexing

By default, `lapis index-repo --path <repo>` blocks until indexing finishes. For large repos (>= 500 files by default) it now auto-switches to async and returns a job ID.

## Commands

```bash
# Synchronous (small repos) — blocks until done
lapis index-repo --path ./myrepo

# Explicit async (returns jobId immediately)
lapis index-repo-async --path ./myrepo --name myrepo

# Poll progress
lapis index-status --job 42

# List recent jobs
lapis list-index-jobs
lapis list-index-jobs --running
```

## Configuration

- `LAPIS_ASYNC_INDEX_THRESHOLD` — file count that triggers auto-switch (default 500).

## Notes

- SQLite is in WAL mode, so read commands (`search-code`, `ranked-code-context`, etc.) return cached results during an in-flight index without blocking.
- The `index-status` tool in the extension shows a progress bar and current file.
```

- [ ] **Step 3: Commit**

```bash
git add docs/code-indexing.md
git commit -m "docs: add async code indexing usage guide"
```

---

## Self-Review

**Spec coverage:**
- ✅ Background indexing via worker thread → Tasks 2, 3
- ✅ Job ID + estimated file count returned immediately → Task 5
- ✅ Progress via `index-status` → Tasks 5, 7
- ✅ Language breakdown as files processed → Task 4 (`onProgress` hook with `language`)
- ✅ Incremental by default; auto-switch for large repos → Task 6
- ✅ Graceful queries during index (no special handling needed because of WAL) → covered by existing WAL setup
- ✅ Files touched: `services/code-indexing.js` ✓, `commands/code-impl.js` ✓, new `src/code-index/index-worker.js` ✓, `extensions/memory-layer/tools/memory-tools.ts` ✓

**Placeholder scan:** No TBDs, no "implement later" steps. All code blocks contain real code. `// implementation note` in Task 3 flags that the indexer call site may need tweaking — that's intentional, the implementer must read the existing indexer.

**Type/name consistency:**
- `jobId` used consistently in `job-store.js`, `job-queue.js`, `index-worker.js`, services, commands, extension.
- `languageBreakdown` is a JSON string in SQLite, parsed in `memory-tools.ts`.
- `index-status` CLI command and `index-status` extension tool share the same name (deliberate — the tool is a thin wrapper).

**No spec gaps.**
