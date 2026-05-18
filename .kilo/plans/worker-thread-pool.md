# Plan: Worker Thread Pool for Parallel AST Parsing

## Problem

The code indexing pipeline's main bottleneck is sequential AST parsing. File I/O is already parallelized, but `web-tree-sitter`'s `parser.parse()` is synchronous and blocks the Node.js event loop. For a repo with 500+ files, parsing alone can take 30-60 seconds on a single thread.

## Architecture

```
Main Thread                              Worker Pool (N workers)
┌──────────────────────────┐             ┌──────────────────────┐
│ 1. scanPhase()           │             │ Worker 0:            │
│    - scan files          │             │  - own parse-code.js │
│    - respect .gitignore  │             │  - own WASM instances│
│                          │             │  - init() once       │
│ 2. Read files in batches │             │                      │
│    (Promise.all reads)   │             │ Worker 1: ...        │
│                          │             │ Worker 2: ...        │
│ 3. Distribute content    │──send()─────▶│                      │
│    to workers round-robin│             │  parseContent()      │
│    (batches of 10-20)    │◀──result()──│  → symbols[]         │
│                          │             │                      │
│ 4. Write to DB           │             └──────────────────────┘
│    - insertFileBatch()   │
│    - insertSymbolBatch() │
│    (transactions)        │
│                          │
│ 5. derivedPhase()        │
│    (import/call/complex) │
└──────────────────────────┘
```

**Key principle**: Workers are pure CPU — they receive `{filePath, content}`, return `symbols[]`. No DB access, no file I/O, no shared state.

## New Files

### `src/code-index/parse-worker.js` — Worker Thread Script

```javascript
const { parentPort } = require('worker_threads');
const codeParser = require('../../parse-code');

let ready = false;

async function init() {
  await codeParser.init();
  ready = true;
  parentPort.postMessage({ type: 'ready' });
}

parentPort.on('message', (msg) => {
  if (msg.type === 'parse') {
    const results = msg.files.map(({ filePath, content }) => ({
      filePath,
      symbols: codeParser.parseContent(filePath, content),
    }));
    parentPort.postMessage({ type: 'results', id: msg.id, results });
  }
});

init();
```

### `src/code-index/worker-pool.js` — Pool Manager

```javascript
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

const WORKER_SCRIPT = path.resolve(__dirname, 'parse-worker.js');

class ParsePool {
  constructor(numWorkers) {
    this.workers = [];
    this.nextWorker = 0;
    this.numWorkers = numWorkers || Math.min(os.cpus().length - 1, 4);
    // Ensure at least 1 worker
    if (this.numWorkers < 1) this.numWorkers = 1;
  }

  async init() {
    const initPromises = [];
    for (let i = 0; i < this.numWorkers; i++) {
      initPromises.push(this._spawnWorker());
    }
    await Promise.all(initPromises);
  }

  _spawnWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SCRIPT);
      worker.on('error', reject);
      worker.once('message', (msg) => {
        if (msg.type === 'ready') resolve(worker);
      });
      this.workers.push(worker);
    });
  }

  // Distribute files round-robin across workers, collect all results
  async parseAll(fileRecords) {
    // fileRecords: [{filePath, content}]
    const batches = this._distribute(fileRecords);
    const promises = batches.map((batch, i) => this._sendBatch(i % this.numWorkers, batch));
    const allResults = await Promise.all(promises);
    return allResults.flat();
  }

  _distribute(fileRecords) {
    const perWorker = Math.ceil(fileRecords.length / this.numWorkers);
    const batches = [];
    for (let i = 0; i < fileRecords.length; i += perWorker) {
      batches.push(fileRecords.slice(i, i + perWorker));
    }
    return batches;
  }

  _sendBatch(workerIndex, files) {
    return new Promise((resolve, reject) => {
      const worker = this.workers[workerIndex % this.workers.length];
      const id = Date.now() + Math.random();
      const handler = (msg) => {
        if (msg.type === 'results' && msg.id === id) {
          worker.off('message', handler);
          resolve(msg.results);
        }
      };
      worker.on('message', handler);
      worker.postMessage({ type: 'parse', id, files });
    });
  }

  async terminate() {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
  }
}
```

## Modified Files

### `src/code-index/incremental-indexer.js` — Use Worker Pool

In `parsePhase()`, after reading files in parallel:

```javascript
// Before (sequential):
for (const record of reads) {
  const symbols = extractSymbolsFromFile(record.filePath, registry, record.content);
  // ...
}

// After (parallel via workers):
if (pool && reads.length > 0) {
  const workerInputs = reads.map(r => ({ filePath: r.filePath, content: r.content }));
  const workerResults = await pool.parseAll(workerInputs);
  // Write results to DB
  const batchSymbols = [];
  for (let i = 0; i < reads.length; i++) {
    const record = reads[i];
    const fileId = repository.insertFile(fileRecordToParams(repoId, record));
    const symbols = workerResults[i]?.symbols || [];
    for (const sym of symbols) {
      batchSymbols.push({ repoId, fileId, filePath: record.filePath, ...normalizeSymbol(sym, record.filePath) });
    }
  }
  repository.insertSymbolBatch(batchSymbols);
}
```

Add fallback: if worker pool fails to init (WASM issues, etc.), fall back to sequential parsing.

### `constants.js` — Pool Configuration

```javascript
const WORKER_POOL = {
  MIN_FILES_FOR_PARALLEL: 50,  // Don't bother with workers for small repos
  MAX_WORKERS: 4,
  WORKER_BATCH_SIZE: 20,
};
```

## Execution Flow

1. `indexRepository()` calls `parsePhase()`
2. `parsePhase()` checks file count:
   - If < 50 files: sequential parsing (no worker overhead)
   - If >= 50 files: spawn worker pool
3. Worker pool:
   - Spawns N workers (N = min(cpus - 1, 4))
   - Each worker initializes its own WASM parsers (~200ms each, parallel)
   - All workers report `ready`
4. File batches distributed round-robin:
   - Main thread reads files in batches of 50 (already parallel I/O)
   - Each batch of 50 is split into N sub-batches
   - Each sub-batch sent to a worker
   - Workers parse synchronously on their own thread
   - Results collected via `Promise.all`
5. Main thread writes results to DB in transactions
6. After all batches: terminate workers, run derived phase

## Performance Expectations

| Files | Sequential | 4 Workers | Speedup |
|-------|-----------|-----------|---------|
| 50    | ~5s       | ~5s*      | ~1x     |
| 200   | ~20s      | ~7s       | ~3x     |
| 500   | ~50s      | ~15s      | ~3.3x   |
| 2000  | ~200s     | ~55s      | ~3.6x   |

\* Worker startup overhead (~200ms × 4 workers in parallel) not worth it for small repos.

## Risks & Mitigations

1. **WASM init failure in workers**: Catch and fall back to sequential parsing
2. **Memory**: Each worker loads its own WASM (~10-15MB). With 4 workers = ~40-60MB. Acceptable.
3. **Worker crash**: Catch `error` events, terminate pool, fall back to sequential
4. **Node.js compat**: `worker_threads` available since Node 12. Minimum required version is fine.
5. **SharedArrayBuffer not needed**: Each worker is independent, no shared memory

## Testing Strategy

- Unit test: `ParsePool` distributes files correctly
- Unit test: Worker returns same symbols as sequential `parseContent()`
- Integration test: Index repo with workers, verify same symbol count as sequential
- Benchmark: Time indexing with/without workers on a 200+ file repo
- Edge cases: Empty files, syntax errors, very large single files
