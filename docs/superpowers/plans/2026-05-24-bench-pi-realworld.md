# Realworld Pi Memory Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `bench/realworld/bench-pi-realworld.js` — a benchmark that runs Pi against real code-editing tasks (bugfixes, features, refactors) and measures whether memory-on improves completion rate, reduces wrong turns, and preserves project decisions better than memory-off.

**Architecture:** A task-driven runner that creates fresh git checkouts, optionally applies patches to introduce bugs and seeds memory, invokes Pi with the task prompt, then grades results using three axes: (1) did the tests pass, (2) did the diff touch the right files, (3) does the answer contain expected facts. Each task runs N times per side (memory-off, memory-on) to gather statistical signal. The runner reuses `parsePiOutput()`, `gradeAnswer()`, and `runCommand()` from the existing `bench-pi-paired.js`.

**Tech Stack:** Node.js (no TypeScript for bench), git CLI, Pi CLI (`pi --print --mode json --no-session`), existing `bench-helper.js` utilities.

---

## What Already Exists

The existing `bench/bench-pi-paired.js` is a **knowledge-retrieval** benchmark — it asks Pi questions and grades whether expected facts appear in the answer. It does NOT give Pi a codebase to edit or tests to fix.

The new `bench/realworld/bench-pi-realworld.js` is a **code-editing** benchmark — it gives Pi a broken checkout, a prompt to fix/implement something, lets Pi edit files, then grades:
1. Do tests pass after Pi's edits?
2. Did Pi edit the right files (and avoid the wrong ones)?
3. Does Pi's answer show understanding of the issue?

These are complementary benchmarks, not a replacement.

## Key Design Decisions

1. **Reuse from paired bench:** `parsePiOutput()`, `gradeAnswer()`, `runCommand()`, `prepareNoMemoryHome()`, `shellQuote()` — import from `bench-pi-paired.js` rather than duplicating.
2. **Fresh checkout per run:** Each run gets a `git worktree add` from a known commit. This is isolated and fast. The runner cleans up worktrees after grading.
3. **Patch-based bug injection:** A git patch file (`.patch`) introduces the bug. The patch is applied to the clean checkout before Pi runs. The reverse patch serves as the "correct answer" for diff comparison.
4. **Memory seeds are JSON:** A memory-seed file is an array of `{type, title, content}` objects loaded into the temp DB via `memory-store.js save` CLI before the memory-on run.
5. **Three-axis grading:** Tests (exit code 0), diff (must_touch / must_not_touch), answer (expected_facts). Each axis is scored independently.
6. **Repeated runs:** `--runs N` flag (default 3). Each task×side combination runs N times. Report shows median across runs with min/max.
7. **Sequential execution:** Tasks run one at a time, sides alternate (off first, then on). No parallelism — Pi is a single interactive process.

## File Structure

```
bench/
  realworld/
    bench-pi-realworld.js          # Runner + reporter (entry point)
    tasks/
      bugfix-createdb-config.json  # Task definitions (6-8 files)
      feature-context-hook.json
      refactor-fts5-rank.json
      staleness-code-index.json
      review-pr-trust-sync.json
      negative-control-readme.json
      bugfix-compact-guidance.json
      feature-session-summary.json
    fixtures/
      patches/                     # Git patches that introduce bugs
        break-createdb-config.patch
        break-compact-guidance.patch
        remove-context-hook.patch
        # etc.
      memory-seeds/                # JSON arrays of memories to seed
        createdb-history.json
        fts5-decision.json
        context-hook-navigation.json
        # etc.
    graders/
      run-tests.js                 # Runs `npm test` (or a subset) in a worktree
      check-diff.js                # Checks must_touch / must_not_touch constraints
      check-answer.js              # Reuses gradeAnswer() from paired bench
    results/                       # Output directory (gitignored)
```

---

### Task 1: Create directory structure and npm script

**Files:**
- Create: `bench/realworld/bench-pi-realworld.js` (skeleton)
- Create: `bench/realworld/tasks/` (directory)
- Create: `bench/realworld/fixtures/patches/` (directory)
- Create: `bench/realworld/fixtures/memory-seeds/` (directory)
- Create: `bench/realworld/graders/run-tests.js` (skeleton)
- Create: `bench/realworld/graders/check-diff.js` (skeleton)
- Create: `bench/realworld/graders/check-answer.js` (skeleton)
- Modify: `package.json` (add `bench:pi-realworld` script)
- Modify: `.gitignore` (add `bench/realworld/results/`)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p bench/realworld/{tasks,fixtures/{patches,memory-seeds},graders,results}
```

- [ ] **Step 2: Add npm script to package.json**

Find the `"bench:pi-paired"` line in the `"scripts"` section and add a new script after it:

```json
"bench:pi-realworld": "node bench/realworld/bench-pi-realworld.js",
```

- [ ] **Step 3: Add results to .gitignore**

Append to `.gitignore`:

```
bench/realworld/results/
```

- [ ] **Step 4: Verify structure**

```bash
ls -R bench/realworld/
```

Expected: directories `tasks/`, `fixtures/patches/`, `fixtures/memory-seeds/`, `graders/`, `results/` all exist.

- [ ] **Step 5: Commit**

```bash
git add bench/realworld/ package.json .gitignore
git commit -m "chore: scaffold bench/realworld/ structure"
```

---

### Task 2: Implement graders

**Files:**
- Create: `bench/realworld/graders/run-tests.js`
- Create: `bench/realworld/graders/check-diff.js`
- Create: `bench/realworld/graders/check-answer.js`

Each grader is a small module exporting a single function. They receive the worktree path and task definition, and return a structured result.

- [ ] **Step 1: Implement `run-tests.js`**

This grader runs a test command in the worktree and reports pass/fail.

```js
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

/**
 * Run test commands from a task definition inside a worktree.
 * @param {object} task - Task definition with success.tests array
 * @param {string} worktreePath - Absolute path to the git worktree
 * @returns {{ passed: number, failed: number, total: number, results: Array }}
 */
function runTests(task, worktreePath) {
  const testCommands = task.success?.tests;
  if (!testCommands || testCommands.length === 0) {
    return { passed: 0, failed: 0, total: 0, results: [], skipped: true };
  }

  const results = testCommands.map((cmd) => {
    try {
      execSync(cmd, {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { command: cmd, passed: true, stderr: '' };
    } catch (err) {
      return {
        command: cmd,
        passed: false,
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || '',
        exitCode: err.status,
      };
    }
  });

  const passed = results.filter((r) => r.passed).length;
  return { passed, failed: results.length - passed, total: results.length, results, skipped: false };
}

// CLI entry point for standalone invocation
if (require.main === module) {
  const taskPath = process.argv[2];
  const worktreePath = process.argv[3];
  if (!taskPath || !worktreePath) {
    console.error('Usage: node run-tests.js <task.json> <worktree-path>');
    process.exit(1);
  }
  const task = JSON.parse(require('fs').readFileSync(taskPath, 'utf-8'));
  const result = runTests(task, worktreePath);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { runTests };
```

- [ ] **Step 2: Run the skeleton to verify it loads**

```bash
node -e "const { runTests } = require('./bench/realworld/graders/run-tests'); console.log(typeof runTests);"
```

Expected: `function`

- [ ] **Step 3: Implement `check-diff.js`**

This grader checks that Pi touched (or avoided) specific files.

```js
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

/**
 * Check that the diff in a worktree respects must_touch / must_not_touch constraints.
 * @param {object} task - Task definition with success.must_touch and success.must_not_touch
 * @param {string} worktreePath - Absolute path to the git worktree
 * @returns {{ passed: boolean, touched: string[], violations: string[], missed: string[] }}
 */
function checkDiff(task, worktreePath) {
  const mustTouch = task.success?.must_touch || [];
  const mustNotTouch = task.success?.must_not_touch || [];

  let rawDiff;
  try {
    rawDiff = execSync('git diff --name-only', {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
  } catch {
    rawDiff = '';
  }

  const touched = rawDiff ? rawDiff.split(/\r?\n/).filter(Boolean) : [];

  // Normalize paths for comparison (both forward-slash)
  const normalize = (p) => p.replace(/\\/g, '/');
  const touchedNorm = new Set(touched.map(normalize));

  const violations = mustNotTouch.filter((f) => touchedNorm.has(normalize(f)));
  const missed = mustTouch.filter((f) => !touchedNorm.has(normalize(f)));

  return {
    passed: violations.length === 0 && missed.length === 0,
    touched,
    violations,
    missed,
  };
}

if (require.main === module) {
  const taskPath = process.argv[2];
  const worktreePath = process.argv[3];
  if (!taskPath || !worktreePath) {
    console.error('Usage: node check-diff.js <task.json> <worktree-path>');
    process.exit(1);
  }
  const task = JSON.parse(require('fs').readFileSync(taskPath, 'utf-8'));
  const result = checkDiff(task, worktreePath);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { checkDiff };
```

- [ ] **Step 4: Run the skeleton to verify it loads**

```bash
node -e "const { checkDiff } = require('./bench/realworld/graders/check-diff'); console.log(typeof checkDiff);"
```

Expected: `function`

- [ ] **Step 5: Implement `check-answer.js`**

This grader reuses `gradeAnswer()` from the paired bench for the answer-axis scoring.

```js
#!/usr/bin/env node
'use strict';

const { gradeAnswer } = require('../bench-pi-paired');

/**
 * Grade the Pi answer against expected facts.
 * @param {string} answer - Pi's assembled answer text
 * @param {Array} expectedFacts - Array of {id, description, aliases} from task.success.expected_facts
 * @returns {{ matched: number, total: number, score: number, facts: Array }}
 */
function checkAnswer(answer, expectedFacts) {
  if (!expectedFacts || expectedFacts.length === 0) {
    return { matched: 0, total: 0, score: 1, facts: [], skipped: true };
  }
  return gradeAnswer(answer, expectedFacts);
}

if (require.main === module) {
  const answer = process.argv[2];
  const factsPath = process.argv[3];
  if (!answer || !factsPath) {
    console.error('Usage: node check-answer.js "<answer>" <facts.json>');
    process.exit(1);
  }
  const facts = JSON.parse(require('fs').readFileSync(factsPath, 'utf-8'));
  const result = checkAnswer(answer, facts);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { checkAnswer };
```

- [ ] **Step 6: Run the skeleton to verify it loads**

```bash
node -e "const { checkAnswer } = require('./bench/realworld/graders/check-answer'); console.log(typeof checkAnswer);"
```

Expected: `function`

- [ ] **Step 7: Commit**

```bash
git add bench/realworld/graders/
git commit -m "feat(bench): implement realworld graders — run-tests, check-diff, check-answer"
```

---

### Task 3: Implement the runner — worktree management and setup

**Files:**
- Create: `bench/realworld/bench-pi-realworld.js` (core logic — setup, teardown, main loop)

This is the largest task. The runner orchestrates: git worktree creation, patch application, memory seeding, Pi invocation, grading, and reporting.

- [ ] **Step 1: Write the runner skeleton with arg parsing and worktree helpers**

Create `bench/realworld/bench-pi-realworld.js` with the following complete content:

```js
#!/usr/bin/env node
// Realworld Pi memory benchmark.
//
// Runs Pi against real code-editing tasks (bugfixes, features, refactors)
// with and without memory, then grades: tests pass, diff correct, answer
// includes expected facts.
//
// Usage:
//   npm run bench:pi-realworld
//   node bench/realworld/bench-pi-realworld.js --runs 3
//   node bench/realworld/bench-pi-realworld.js --only bugfix-createdb-config

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { parsePiOutput, gradeAnswer } = require('../bench-pi-paired');
const { runTests } = require('./graders/run-tests');
const { checkDiff } = require('./graders/check-diff');
const { checkAnswer } = require('./graders/check-answer');

const TASKS_DIR = path.join(__dirname, 'tasks');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const PI_CONFIG_FILES = ['models.json', 'settings.json', 'auth.json'];

// ══════════════════════════════════════════════════════════
// ARG PARSING
// ══════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = {
    runs: DEFAULT_RUNS,
    only: null,
    outDir: path.join(__dirname, 'results', `realworld-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    noCleanup: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') {
      args.runs = parseInt(argv[++i], 10);
    } else if (arg === '--only') {
      args.only = argv[++i];
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i];
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = parseInt(argv[++i], 10);
    } else if (arg === '--no-cleanup') {
      args.noCleanup = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node bench/realworld/bench-pi-realworld.js

Runs Pi against real code-editing tasks with and without memory.
Each task runs N times per side (default ${DEFAULT_RUNS}).

Options:
  --runs N            Number of repetitions per task per side (default ${DEFAULT_RUNS})
  --only TASK_ID      Run a single task
  --out-dir DIR       Output directory
  --timeout-ms N      Per-side timeout in ms (default ${DEFAULT_TIMEOUT_MS})
  --no-cleanup        Keep worktrees after run (for debugging)
`);
}

// ══════════════════════════════════════════════════════════
// GIT WORKTREE MANAGEMENT
// ══════════════════════════════════════════════════════════

function getRepoRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}

function createWorktree(repoRoot, commitish, worktreePath) {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  execSync(`git worktree add --detach "${worktreePath}" ${commitish}`, {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

function removeWorktree(worktreePath) {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: getRepoRoot(),
      encoding: 'utf-8',
      timeout: 15_000,
    });
  } catch {
    // Best-effort cleanup
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

// ══════════════════════════════════════════════════════════
// SETUP: PATCH APPLICATION
// ══════════════════════════════════════════════════════════

function applyPatch(worktreePath, patchPath) {
  const absolutePatch = path.resolve(patchPath);
  execSync(`git apply --stat "${absolutePatch}" && git apply "${absolutePatch}"`, {
    cwd: worktreePath,
    encoding: 'utf-8',
    timeout: 15_000,
  });
}

// ══════════════════════════════════════════════════════════
// SETUP: MEMORY SEEDING
// ══════════════════════════════════════════════════════════

function seedMemory(memorySeedPath) {
  if (!memorySeedPath || !fs.existsSync(memorySeedPath)) {
    return;
  }
  const seeds = JSON.parse(fs.readFileSync(memorySeedPath, 'utf-8'));
  if (!Array.isArray(seeds) || seeds.length === 0) {
    return;
  }

  const lapisRoot = findLapisRoot();
  const msPath = path.join(lapisRoot, 'memory-store.js');

  for (const seed of seeds) {
    const args = [
      'save',
      '--type', seed.type || 'architecture',
      '--title', seed.title,
      '--content', seed.content,
    ];
    if (seed.project) {
      args.push('--project', seed.project);
    }
    if (seed.scope) {
      args.push('--scope', seed.scope);
    }

    execSync(`node "${msPath}" ${args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}`, {
      cwd: lapisRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    });
  }
}

function findLapisRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..'),
    process.env.LAPIS_PATH,
    path.join(os.homedir(), '.pi', 'agent', 'git', 'github.com', 'GeneGulanesJr', 'LaPis'),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'memory-store.js'))) {
      return dir;
    }
  }
  // Fallback: use the current repo if it has memory-store.js
  const repoRoot = getRepoRoot();
  if (fs.existsSync(path.join(repoRoot, 'memory-store.js'))) {
    return repoRoot;
  }
  console.error('ERROR: Cannot find LaPis root. Set LAPIS_PATH.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════
// SETUP: NO-MEMORY HOME
// ══════════════════════════════════════════════════════════

function prepareNoMemoryHome(outDir) {
  const sourceAgentDir = path.join(os.homedir(), '.pi', 'agent');
  const homeDir = path.join(outDir, '.pi-memory-off-home');
  const targetAgentDir = path.join(homeDir, '.pi', 'agent');
  fs.mkdirSync(targetAgentDir, { recursive: true });

  for (const file of PI_CONFIG_FILES) {
    const source = path.join(sourceAgentDir, file);
    if (fs.existsSync(source)) {
      const target = path.join(targetAgentDir, file);
      if (file === 'settings.json') {
        const settings = JSON.parse(fs.readFileSync(source, 'utf-8'));
        if (Array.isArray(settings.packages)) {
          settings.packages = [];
        }
        fs.writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
      } else {
        fs.copyFileSync(source, target);
      }
    }
  }

  return homeDir;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ══════════════════════════════════════════════════════════
// PI INVOCATION
// ══════════════════════════════════════════════════════════

function buildPiCommand(homeDir, prompt, outFile) {
  const homePrefix = homeDir ? `HOME=${shellQuote(homeDir)} ` : '';
  return `${homePrefix}pi --print --mode json --no-session ${shellQuote(prompt)} > ${shellQuote(outFile)} 2>&1`;
}

function runCommand(command, cwd, timeoutMs, outFile) {
  // Reuse the spawn-based approach from bench-pi-paired.js
  const { spawn } = require('child_process');
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ status: null, signal: null, elapsed_ms: Date.now() - started, stdout, stderr, error: error.message });
      }
    });

    child.on('close', (status, signal) => {
      if (!settled) { settled = true; }
      clearTimeout(timeout);
      resolve({
        status,
        signal,
        elapsed_ms: Date.now() - started,
        stdout,
        stderr,
        error: signal === 'SIGTERM' ? `Timed out after ${timeoutMs}ms` : null,
      });
    });
  });
}

// ══════════════════════════════════════════════════════════
// GRADING
// ══════════════════════════════════════════════════════════

function gradeRun(task, worktreePath, parsedOutput) {
  const testResult = runTests(task, worktreePath);
  const diffResult = checkDiff(task, worktreePath);
  const answerResult = checkAnswer(parsedOutput.answer, task.success?.expected_facts || []);

  return {
    tests: testResult,
    diff: diffResult,
    answer: answerResult,
    overall: testResult.passed === testResult.total && testResult.total > 0 && diffResult.passed,
  };
}

// ══════════════════════════════════════════════════════════
// TASK DISCOVERY
// ══════════════════════════════════════════════════════════

function loadTasks(tasksDir, only) {
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
  const tasks = files.map((f) => JSON.parse(fs.readFileSync(path.join(tasksDir, f), 'utf-8')));
  return only ? tasks.filter((t) => t.id === only) : tasks;
}

// ══════════════════════════════════════════════════════════
// MAIN LOOP
// ══════════════════════════════════════════════════════════

async function runTaskSide(task, side, runIndex, args, repoRoot, noMemoryHome) {
  const runId = `${task.id}.${side}.run${runIndex}`;
  const worktreePath = path.join(args.outDir, 'worktrees', runId);
  const outFile = path.join(args.outDir, 'transcripts', `${runId}.jsonl`);

  benchLog(`[${runId}] Creating worktree at ${task.setup.checkout}`);
  createWorktree(repoRoot, task.setup.checkout, worktreePath);

  try {
    // Apply patch if specified
    if (task.setup.apply_patch) {
      const patchPath = path.resolve(FIXTURES_DIR, task.setup.apply_patch);
      benchLog(`[${runId}] Applying patch ${task.setup.apply_patch}`);
      applyPatch(worktreePath, patchPath);
    }

    // Install deps in worktree (needed for test running)
    try {
      benchLog(`[${runId}] Installing dependencies`);
      execSync('npm install --ignore-scripts', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch {
      benchLog(`[${runId}] WARN: npm install failed, tests may fail`);
    }

    // Seed memory for memory-on side
    const homeDir = side === 'memory-off' ? noMemoryHome : null;
    if (side === 'memory-on' && task.setup.seed_memory) {
      const seedPath = path.resolve(FIXTURES_DIR, task.setup.seed_memory);
      benchLog(`[${runId}] Seeding memory from ${task.setup.seed_memory}`);
      seedMemory(seedPath);
    }

    // Run Pi
    benchLog(`[${runId}] Starting Pi (${side})`);
    const command = buildPiCommand(homeDir, task.prompt, outFile);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const run = await runCommand(command, worktreePath, args.timeoutMs, outFile);
    benchLog(`[${runId}] Pi finished in ${run.elapsed_ms}ms`);

    // Parse output
    let raw = '';
    if (fs.existsSync(outFile)) {
      raw = fs.readFileSync(outFile, 'utf-8');
    }
    if (!raw && (run.stdout || run.stderr)) {
      raw = `${run.stdout}\n${run.stderr}`;
    }
    const parsed = parsePiOutput(raw);

    // Grade
    const grade = gradeRun(task, worktreePath, parsed);
    benchLog(`[${runId}] Grade: overall=${grade.overall}, tests=${grade.tests.passed}/${grade.tests.total}, diff=${grade.diff.passed}`);

    return {
      side,
      run_index: runIndex,
      elapsed_ms: run.elapsed_ms,
      error: run.error,
      usage: parsed.usage,
      tool_counts: parsed.tool_counts,
      behavior: parsed.behavior,
      grade,
    };
  } finally {
    if (!args.noCleanup) {
      removeWorktree(worktreePath);
    }
  }
}

// ══════════════════════════════════════════════════════════
// REPORTING
// ══════════════════════════════════════════════════════════

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtMs(ms) {
  if (!ms) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtNum(n) {
  if (n === undefined || n === null) return 'n/a';
  return n.toLocaleString();
}

function printReport(results, runs) {
  const sides = ['memory-off', 'memory-on'];
  const taskIds = [...new Set(results.map((r) => r.task_id))];

  // Per-side aggregates
  const bySide = {};
  for (const side of sides) {
    const sideResults = results.filter((r) => r.side === side);
    const solved = sideResults.filter((r) => r.grade.overall).length;
    const testPassed = sideResults.filter((r) => r.grade.tests.passed === r.grade.tests.total && r.grade.tests.total > 0).length;
    const activeTokens = sideResults.map((r) => r.usage.active_tokens || 0);
    const wallTimes = sideResults.map((r) => r.elapsed_ms || 0);
    const toolCalls = sideResults.map((r) => r.behavior?.tool_calls || 0);
    const wrongFile = sideResults.filter((r) => !r.grade.diff.passed).length;

    bySide[side] = {
      solved: `${solved}/${sideResults.length}`,
      testPassed: `${testPassed}/${sideResults.length}`,
      medianTokens: median(activeTokens),
      medianWallTime: median(wallTimes),
      medianToolCalls: median(toolCalls),
      wrongFileEdits: wrongFile,
    };
  }

  // Print table
  const col1 = 24;
  const colN = 12;
  benchLog('');
  benchLog('╔' + '═'.repeat(col1 + 2) + '╤' + '═'.repeat(colN + 2) + '╤' + '═'.repeat(colN + 2) + '╗');
  benchLog('║' + 'Metric'.padEnd(col1 + 2) + '│' + 'Memory Off'.padStart(colN + 1) + ' ' + '│' + 'Memory On'.padStart(colN + 1) + ' ' + '║');
  benchLog('╟' + '─'.repeat(col1 + 2) + '┼' + '─'.repeat(colN + 2) + '┼' + '─'.repeat(colN + 2) + '╢');

  const rows = [
    ['Tasks solved', bySide['memory-off'].solved, bySide['memory-on'].solved],
    ['Tests passed', bySide['memory-off'].testPassed, bySide['memory-on'].testPassed],
    ['Median active tokens', fmtNum(bySide['memory-off'].medianTokens), fmtNum(bySide['memory-on'].medianTokens)],
    ['Median wall time', fmtMs(bySide['memory-off'].medianWallTime), fmtMs(bySide['memory-on'].medianWallTime)],
    ['Median tool calls', fmtNum(bySide['memory-off'].medianToolCalls), fmtNum(bySide['memory-on'].medianToolCalls)],
    ['Wrong-file edits', String(bySide['memory-off'].wrongFileEdits), String(bySide['memory-on'].wrongFileEdits)],
  ];

  for (const [label, offVal, onVal] of rows) {
    benchLog('║ ' + label.padEnd(col1) + ' ' + '│' + String(offVal).padStart(colN + 1) + ' ' + '│' + String(onVal).padStart(colN + 1) + ' ' + '║');
  }

  benchLog('╚' + '═'.repeat(col1 + 2) + '╧' + '═'.repeat(colN + 2) + '╧' + '═'.repeat(colN + 2) + '╝');
  benchLog('');

  // Per-task detail
  benchLog('Per-task results:');
  for (const taskId of taskIds) {
    for (const side of sides) {
      const taskResults = results.filter((r) => r.task_id === taskId && r.side === side);
      const overall = taskResults.filter((r) => r.grade.overall).length;
      const tokens = taskResults.map((r) => r.usage.active_tokens || 0);
      const tools = taskResults.map((r) => r.behavior?.tool_calls || 0);
      benchLog(
        `  ${taskId} (${side}): ${overall}/${taskResults.length} solved, ` +
        `median ${fmtNum(median(tokens))} tokens, ${fmtNum(median(tools))} tools`,
      );
    }
  }
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

let progressActive = false;

function benchLog(message = '') {
  finishProgress();
  console.log(message);
}

function finishProgress() {
  if (progressActive && process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    progressActive = false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = loadTasks(TASKS_DIR, args.only);

  if (tasks.length === 0) {
    console.error('No tasks found. Add task JSON files to bench/realworld/tasks/');
    process.exit(2);
  }

  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const repoRoot = getRepoRoot();
  const noMemoryHome = prepareNoMemoryHome(outDir);

  benchLog(`[bench] Realworld Pi Memory Benchmark`);
  benchLog(`[bench] Tasks: ${tasks.length}, Runs per side: ${args.runs}`);
  benchLog(`[bench] Output: ${outDir}`);
  benchLog(`[bench] memory-off HOME: ${noMemoryHome}`);
  benchLog('');

  const allResults = [];

  for (const task of tasks) {
    for (let runIndex = 0; runIndex < args.runs; runIndex++) {
      // Memory-off first, then memory-on
      // eslint-disable-next-line no-await-in-loop
      const off = await runTaskSide(task, 'memory-off', runIndex, args, repoRoot, noMemoryHome);
      // eslint-disable-next-line no-await-in-loop
      const on = await runTaskSide(task, 'memory-on', runIndex, args, repoRoot, noMemoryHome);

      allResults.push({ task_id: task.id, category: task.category, ...off });
      allResults.push({ task_id: task.id, category: task.category, ...on });
    }
  }

  // Save full results
  const report = {
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    runs: args.runs,
    tasks: tasks.map((t) => t.id),
    results: allResults,
  };
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  // Print report
  printReport(allResults, args.runs);
  benchLog(`Report saved to: ${reportPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = { createWorktree, removeWorktree, applyPatch, seedMemory, gradeRun, printReport };
```

- [ ] **Step 2: Verify the runner loads without syntax errors**

```bash
node -c bench/realworld/bench-pi-realworld.js
```

Expected: `Syntax OK` (or no output = success for `node -c`)

- [ ] **Step 3: Verify help flag works**

```bash
node bench/realworld/bench-pi-realworld.js --help
```

Expected: Usage text printed, exit 0.

- [ ] **Step 4: Verify task loading works (will fail gracefully — no tasks yet)**

```bash
node bench/realworld/bench-pi-realworld.js 2>&1 | head -5
```

Expected: "No tasks found. Add task JSON files to bench/realworld/tasks/"

- [ ] **Step 5: Commit**

```bash
git add bench/realworld/bench-pi-realworld.js
git commit -m "feat(bench): implement realworld runner with worktree management and grading"
```

---

### Task 4: Create task definitions (8 tasks)

**Files:**
- Create: `bench/realworld/tasks/bugfix-createdb-config.json`
- Create: `bench/realworld/tasks/bugfix-compact-guidance.json`
- Create: `bench/realworld/tasks/feature-context-hook.json`
- Create: `bench/realworld/tasks/feature-session-summary.json`
- Create: `bench/realworld/tasks/refactor-fts5-rank.json`
- Create: `bench/realworld/tasks/staleness-code-index.json`
- Create: `bench/realworld/tasks/review-pr-trust-sync.json`
- Create: `bench/realworld/tasks/negative-control-readme.json`

Each task needs a `setup.checkout` pointing to a known good commit. The patches and memory seeds will be created in Tasks 5-6. For now, the task definitions serve as the specification.

- [ ] **Step 1: Get a recent known-good commit hash**

```bash
git log --oneline -1
```

This commit hash will be used as the `checkout` value. We'll reference it as `$BASE_COMMIT` in the task definitions below. Replace it with the actual hash when writing the files.

- [ ] **Step 2: Create `bugfix-createdb-config.json`**

A bugfix task. The patch will break `createDb` config isolation. Pi must fix it.

```json
{
  "id": "bugfix-createdb-config",
  "category": "bugfix",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "apply_patch": "patches/break-createdb-config.patch",
    "seed_memory": "memory-seeds/createdb-history.json"
  },
  "prompt": "A test is failing in test/db-config.test.js around createDb config isolation. The test expects that creating a second database doesn't overwrite the first database's config. Fix the bug causing the test to fail. Run the test to verify your fix works.",
  "success": {
    "tests": ["npm test -- test/db-config.test.js --reporter=verbose 2>&1"],
    "must_touch": ["src/memory-domain/db.js"],
    "must_not_touch": ["test/db-config.test.js"],
    "expected_facts": [
      {
        "id": "config-mutation-bug",
        "description": "createDb was mutating or not isolating config between instances",
        "aliases": ["mutating", "overwriting", "not isolating", "config isolation", "shared config", "getConfig._cached"]
      }
    ]
  }
}
```

- [ ] **Step 3: Create `bugfix-compact-guidance.json`**

A bugfix task. The patch breaks compact's deterministic guidance.

```json
{
  "id": "bugfix-compact-guidance",
  "category": "bugfix",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "apply_patch": "patches/break-compact-guidance.patch",
    "seed_memory": "memory-seeds/compact-guidance-history.json"
  },
  "prompt": "The compact command's guidance output is broken. Tests in test/compact-guidance.test.js are failing. The compact command should produce deterministic, concise guidance about stale indexes. Fix the bug.",
  "success": {
    "tests": ["npm test -- test/compact-guidance.test.js --reporter=verbose 2>&1"],
    "must_touch": ["src/memory-domain/compact.js"],
    "must_not_touch": ["test/compact-guidance.test.js"],
    "expected_facts": [
      {
        "id": "compact-deterministic",
        "description": "Compact guidance should be deterministic and concise",
        "aliases": ["deterministic", "concise"]
      }
    ]
  }
}
```

- [ ] **Step 4: Create `feature-context-hook.json`**

A feature/navigation task. Pi must find and explain the context injection hook wiring.

```json
{
  "id": "feature-context-hook",
  "category": "feature",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "seed_memory": "memory-seeds/context-hook-navigation.json"
  },
  "prompt": "Add a new optional flag 'contextLimit' to the context-injection hook that lets the user override the default limit of 10 observations. The hook should read contextLimit from the extension settings. Add a test that verifies the flag works. Run the test to confirm.",
  "success": {
    "tests": ["npm test -- test/context-injection.test.js --reporter=verbose 2>&1"],
    "must_touch": ["extensions/memory-layer/hooks/context-injection.ts", "test/context-injection.test.js"],
    "must_not_touch": ["src/memory-domain/db.js"],
    "expected_facts": [
      {
        "id": "context-limit-flag",
        "description": "The context-injection hook supports a configurable limit via contextLimit",
        "aliases": ["contextLimit", "configurable limit", "override the default limit"]
      }
    ]
  }
}
```

- [ ] **Step 5: Create `feature-session-summary.json`**

A feature/navigation task. Pi must understand session lifecycle to add a new event.

```json
{
  "id": "feature-session-summary",
  "category": "feature",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "seed_memory": "memory-seeds/session-lifecycle.json"
  },
  "prompt": "Add a new hook 'onCompact' to the session-lifecycle module that gets called when Pi's context is compacted. It should save a lightweight session summary with the topics discussed and the turn count. Add a test for the new hook.",
  "success": {
    "tests": ["npm test -- test/session-lifecycle.test.js --reporter=verbose 2>&1"],
    "must_touch": ["extensions/memory-layer/hooks/session-lifecycle.ts"],
    "must_not_touch": ["src/memory-domain/db.js"],
    "expected_facts": [
      {
        "id": "on-compact-hook",
        "description": "A new onCompact hook saves session summaries after compaction",
        "aliases": ["onCompact", "compact", "session summary", "topics discussed"]
      }
    ]
  }
}
```

- [ ] **Step 6: Create `refactor-fts5-rank.json`**

A refactor task respecting a prior architectural decision. Pi must check memory before changing the search approach.

```json
{
  "id": "refactor-fts5-rank",
  "category": "refactor",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "seed_memory": "memory-seeds/fts5-decision.json"
  },
  "prompt": "Refactor rankObservations in src/memory-domain/search.js to extract the scoring weights into a configurable object at the top of the module. The weights are: FTS relevance, recency, trust, recall, and typeBoost. Keep the same scoring behavior — this is a pure refactor. Run the existing tests to verify nothing broke.",
  "success": {
    "tests": ["npm test -- test/search.test.js --reporter=verbose 2>&1"],
    "must_touch": ["src/memory-domain/search.js"],
    "must_not_touch": ["test/search.test.js", "src/memory-domain/db.js"],
    "expected_facts": [
      {
        "id": "scoring-weights-extracted",
        "description": "The scoring weights were extracted into a configurable object",
        "aliases": ["scoring weights", "configurable", "extracted", "SCORING_WEIGHTS"]
      }
    ]
  }
}
```

- [ ] **Step 7: Create `staleness-code-index.json`**

A stale-index task. Memory should warn about stale code and recommend reindexing.

```json
{
  "id": "staleness-code-index",
  "category": "staleness",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "seed_memory": "memory-seeds/stale-index-warning.json"
  },
  "prompt": "The code index says parse-code.js exports a function called extractScopeEdges. Check if this function actually exists in the current source. If it doesn't, explain what happened and fix any code that references it.",
  "success": {
    "tests": [],
    "must_touch": [],
    "must_not_touch": ["src/memory-domain/search.js"],
    "expected_facts": [
      {
        "id": "stale-detection",
        "description": "The agent detected the code index is stale and the function doesn't exist",
        "aliases": ["stale", "doesn't exist", "not found", "no longer exists", "out of date", "reindex"]
      },
      {
        "id": "verify-source",
        "description": "The agent verified against current source code",
        "aliases": ["verified", "current source", "checked the file", "read the source"]
      }
    ]
  }
}
```

- [ ] **Step 8: Create `review-pr-trust-sync.json`**

A PR review task. Pi must evaluate a change in context of prior decisions.

```json
{
  "id": "review-pr-trust-sync",
  "category": "review",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT",
    "apply_patch": "patches/pr-trust-sync-change.patch",
    "seed_memory": "memory-seeds/trust-sync-architecture.json"
  },
  "prompt": "Review the staged changes in this checkout. The change modifies trust-sync to run synchronously after every git operation instead of only after pull/checkout/merge/rebase. Evaluate whether this is a good change. Consider performance implications and whether the original design decision to only sync on specific operations was intentional.",
  "success": {
    "tests": [],
    "must_touch": [],
    "must_not_touch": [],
    "expected_facts": [
      {
        "id": "original-design-intent",
        "description": "Trust sync was intentionally designed to only trigger on pull/checkout/merge/rebase",
        "aliases": ["pull/checkout/merge/rebase", "intentional", "specific git operations", "designed to only"]
      },
      {
        "id": "performance-concern",
        "description": "Running on every git operation would be unnecessarily expensive",
        "aliases": ["expensive", "unnecessary", "performance", "overhead", "too frequent", "every git operation"]
      }
    ]
  }
}
```

- [ ] **Step 9: Create `negative-control-readme.json`**

A negative-control task. Memory should not be needed.

```json
{
  "id": "negative-control-readme",
  "category": "negative-control",
  "repo": "PiMemoryExtension",
  "setup": {
    "checkout": "REPLACE_WITH_BASE_COMMIT"
  },
  "prompt": "What does the README say about running the test suite? Quote the exact command and explain what test framework is used. Answer from the current source only.",
  "success": {
    "tests": [],
    "must_touch": [],
    "must_not_touch": [],
    "expected_facts": [
      {
        "id": "test-command",
        "description": "The README mentions npm test or vitest for running tests",
        "aliases": ["npm test", "vitest", "npm run test"]
      },
      {
        "id": "test-framework",
        "description": "The test framework is vitest",
        "aliases": ["vitest", "Vitest"]
      }
    ]
  }
}
```

- [ ] **Step 10: Verify all tasks load**

```bash
node -e "
const fs = require('fs');
const path = require('path');
const dir = 'bench/realworld/tasks';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log('Found ' + files.length + ' tasks:');
files.forEach(f => {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  console.log('  ' + t.id + ' (' + t.category + ')');
});
"
```

Expected: 8 tasks listed with correct categories.

- [ ] **Step 11: Commit**

```bash
git add bench/realworld/tasks/
git commit -m "feat(bench): add 8 realworld task definitions"
```

---

### Task 5: Create patches (bug injection)

**Files:**
- Create: `bench/realworld/fixtures/patches/break-createdb-config.patch`
- Create: `bench/realworld/fixtures/patches/break-compact-guidance.patch`
- Create: `bench/realworld/fixtures/patches/pr-trust-sync-change.patch`

Patches are generated by making a deliberate breaking change, running `git diff > patch`, then reverting. Each patch must apply cleanly to the base checkout commit.

- [ ] **Step 1: Generate `break-createdb-config.patch`**

This patch introduces a bug where `createDb` shares config between instances instead of isolating it. The exact change depends on the current source, but the approach is:

1. Check out the base commit in a temp branch
2. Modify `src/memory-domain/db.js` to remove config isolation (e.g., remove the config save/restore, or introduce a shared mutable singleton)
3. Run `git diff > bench/realworld/fixtures/patches/break-createdb-config.patch`
4. Revert the change

First, examine the current createDb to understand what to break:

```bash
grep -n 'createDb\|getConfig\|_cached' src/memory-domain/db.js | head -20
```

Then create a patch that removes the config save/restore logic. Example approach:

```bash
# Create a temp branch from the base commit
git checkout -b temp-patch-base REPLACE_WITH_BASE_COMMIT

# Make the breaking change: remove config isolation in createDb
# (specific edit depends on current source structure)

# Generate the patch
git diff > bench/realworld/fixtures/patches/break-createdb-config.patch

# Revert
git checkout main
git branch -D temp-patch-base
```

The patch should be small (10-30 lines) and target a specific function.

- [ ] **Step 2: Verify the patch applies cleanly**

```bash
cd /tmp && rm -rf test-patch && git clone --no-checkout /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension test-patch
cd test-patch && git checkout REPLACE_WITH_BASE_COMMIT
git apply --stat /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/bench/realworld/fixtures/patches/break-createdb-config.patch
```

Expected: patch applies with stat showing changed files.

- [ ] **Step 3: Generate `break-compact-guidance.patch`**

Same approach — make a deliberate breaking change to compact guidance, capture the diff, revert.

- [ ] **Step 4: Generate `pr-trust-sync-change.patch`**

This is a synthetic PR that makes trust-sync run on every git operation. It should be plausible but suboptimal.

- [ ] **Step 5: Verify all patches are in place**

```bash
ls -la bench/realworld/fixtures/patches/
```

Expected: 3 `.patch` files.

- [ ] **Step 6: Commit**

```bash
git add bench/realworld/fixtures/patches/
git commit -m "feat(bench): add bug injection patches for realworld tasks"
```

---

### Task 6: Create memory seeds

**Files:**
- Create: `bench/realworld/fixtures/memory-seeds/createdb-history.json`
- Create: `bench/realworld/fixtures/memory-seeds/compact-guidance-history.json`
- Create: `bench/realworld/fixtures/memory-seeds/context-hook-navigation.json`
- Create: `bench/realworld/fixtures/memory-seeds/fts5-decision.json`
- Create: `bench/realworld/fixtures/memory-seeds/session-lifecycle.json`
- Create: `bench/realworld/fixtures/memory-seeds/stale-index-warning.json`
- Create: `bench/realworld/fixtures/memory-seeds/trust-sync-architecture.json`

Memory seeds are JSON arrays of `{type, title, content, project?, scope?}` objects. They simulate what a real LaPis user would have accumulated over time. Each seed file contains 2-5 realistic memories that should help the memory-on side.

- [ ] **Step 1: Create `createdb-history.json`**

Memories about the createDb config bug and its fix:

```json
[
  {
    "type": "bugfix",
    "title": "Fixed createDb config mutation bug",
    "content": "What: createDb was mutating global config — calling createDb for a test DB would overwrite the cached singleton config. Why: Tests creating isolated DBs were breaking the main DB's config. Where: src/memory-domain/db.js createDb function. Learned: Always save and restore config around createDb calls. The fix adds config isolation via save/restore of getConfig._cached.",
    "project": "PiMemoryExtension"
  },
  {
    "type": "architecture",
    "title": "createDb config isolation pattern",
    "content": "What: createDb uses a save/restore pattern for config isolation. The function saves the current config state, creates the new DB, and restores the original config. Why: Prevents test DBs from polluting the main DB's config. Where: src/memory-domain/db.js. Learned: The save/restore happens around the createDb call and is critical for test isolation.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 2: Create `compact-guidance-history.json`**

```json
[
  {
    "type": "bugfix",
    "title": "Fixed compact deterministic stale-index guidance",
    "content": "What: The compact command's stale-index guidance was non-deterministic and verbose. Why: It was including full observation context instead of just the relevant guidance line. Where: extensions/memory-layer/hooks/context-injection.ts and src/memory-domain/compact.js. Learned: Compact guidance should be a single concise line about stale indexes, not the full 10-observation context injection.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 3: Create `context-hook-navigation.json`**

```json
[
  {
    "type": "architecture",
    "title": "Context injection hook wiring",
    "content": "What: Automatic memory context is wired via extensions/memory-layer/hooks/context-injection.ts using the before_agent_start event hook. The hook is registered by extensions/memory-layer/index.ts. Why: When a Pi session starts, the hook injects recent relevant memories as system-level context. Where: extensions/memory-layer/hooks/context-injection.ts, registered in extensions/memory-layer/index.ts. Learned: The hook uses CONTEXT.DEFAULT_LIMIT (10) for primary context. Low-signal types are excluded by CONTEXT.EXCLUDED_TYPES.",
    "project": "PiMemoryExtension"
  },
  {
    "type": "architecture",
    "title": "Extension composition and registration",
    "content": "What: The extension root file extensions/memory-layer/index.ts composes and registers all hooks. It wires context injection, passive capture, session lifecycle, tool guardrails, and trust sync. Why: Each concern is isolated while sharing a common state object and mem() client. Where: extensions/memory-layer/index.ts. Learned: The register() function is the entry point called by Pi's extension API.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 4: Create `fts5-decision.json`**

```json
[
  {
    "type": "architecture",
    "title": "LaPis uses SQLite FTS5 for memory search",
    "content": "What: LaPis chose SQLite FTS5 as its full-text search engine. Why: Zero external service dependencies — SQLite FTS5 is built into the library LaPis already uses. This avoids needing Redis, Elasticsearch, or any external search service. Where: src/memory-domain/search.js. Learned: FTS5 provides sufficient search quality for the memory corpus size. The rankObservations() function applies composite scoring with FTS relevance, recency, trust, recall, and typeBoost weights. Do NOT replace FTS5 with an external service.",
    "project": "PiMemoryExtension"
  },
  {
    "type": "architecture",
    "title": "rankObservations scoring weights",
    "content": "What: The rankObservations function in src/memory-domain/search.js applies composite scoring. The weights are: ftsScore, recencyScore, trustScore, recallScore, and typeBoost. Why: Provides a balanced ranking that considers text relevance, freshness, code trust, usage patterns, and type priority. Where: src/memory-domain/search.js rankObservations(). Learned: typeBoost multiplies the final composite score. The function is the core of memory search ranking.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 5: Create `session-lifecycle.json`**

```json
[
  {
    "type": "architecture",
    "title": "Session lifecycle hook architecture",
    "content": "What: Session lifecycle is managed by extensions/memory-layer/hooks/session-lifecycle.ts. It handles session start and end events, saving session summaries with topics and turn counts. Why: Enables auto-recovery of incomplete sessions and provides a record of what was discussed. Where: extensions/memory-layer/hooks/session-lifecycle.ts. Learned: The module registers onSessionStart and onSessionEnd listeners. Session summaries are saved automatically.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 6: Create `stale-index-warning.json`**

```json
[
  {
    "type": "architecture",
    "title": "Stale code index detection and guidance",
    "content": "What: When the code index is stale (indexed code may not match current source), LaPis injects a staleness warning in the context. Why: Agents should verify against current source before relying on indexed code. Where: extensions/memory-layer/hooks/context-injection.ts adds staleness warning. Learned: The correct action is to run memory-code reindex-repo to update the index. Always verify indexed facts against current source code before acting on them.",
    "project": "PiMemoryExtension"
  },
  {
    "type": "bugfix",
    "title": "Fixed stale index guidance verbosity",
    "content": "What: Stale index guidance was injecting too much context (full 10 observations) when only the staleness line was needed. Why: Inflated LLM output by 1155+ chars of irrelevant observations. Where: extensions/memory-layer/hooks/context-injection.ts. Learned: The lightweight context path (stale warning only, no observations, no personal prefs) saves significant tokens for staleness-related queries.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 7: Create `trust-sync-architecture.json`**

```json
[
  {
    "type": "architecture",
    "title": "Trust sync design: only on pull/checkout/merge/rebase",
    "content": "What: Trust sync is intentionally designed to run only after git pull, checkout, merge, or rebase operations. Why: Running trust sync on every git operation would be unnecessarily expensive and provide little additional value. The specific operations are the ones where code changes from external sources are integrated. Where: extensions/memory-layer/hooks/trust-sync.ts. Learned: This was an intentional design decision. Trust sync compares stored HEAD vs current HEAD to detect changed symbols. It should NOT be triggered on every git operation.",
    "project": "PiMemoryExtension"
  }
]
```

- [ ] **Step 8: Verify all seeds load as valid JSON**

```bash
for f in bench/realworld/fixtures/memory-seeds/*.json; do
  echo -n "$f: "
  node -e "const s = require('./$f'); console.log(s.length + ' memories')"
done
```

Expected: Each file shows 1-3 memories.

- [ ] **Step 9: Commit**

```bash
git add bench/realworld/fixtures/memory-seeds/
git commit -m "feat(bench): add memory seeds for realworld tasks"
```

---

### Task 7: Write actual patches and validate end-to-end

**Files:**
- Modify: `bench/realworld/fixtures/patches/break-createdb-config.patch` (make real)
- Modify: `bench/realworld/fixtures/patches/break-compact-guidance.patch` (make real)
- Modify: `bench/realworld/fixtures/patches/pr-trust-sync-change.patch` (make real)
- Modify: `bench/realworld/tasks/*.json` (replace `REPLACE_WITH_BASE_COMMIT` with actual hash)

This task requires examining the actual source code to create patches that introduce realistic bugs. The patches must apply cleanly to the base commit and actually break tests.

- [ ] **Step 1: Determine the base commit hash**

```bash
git log --oneline -1 --format="%H"
```

Use this full hash as `BASE_COMMIT`.

- [ ] **Step 2: Update all task files with the real commit hash**

```bash
BASE_COMMIT=$(git log --oneline -1 --format="%H")
sed -i "s/REPLACE_WITH_BASE_COMMIT/$BASE_COMMIT/g" bench/realworld/tasks/*.json
```

- [ ] **Step 3: Examine createDb config isolation to craft the patch**

```bash
grep -n 'createDb\|_cached\|getConfig\|config.*save\|config.*restore' src/memory-domain/db.js | head -30
```

Based on the output, craft a patch that removes the config isolation. The patch should:
- Remove or comment out the config save/restore in createDb
- Or introduce a shared mutable variable that breaks isolation
- Be 10-30 lines of diff

- [ ] **Step 4: Create the patch using git workflow**

```bash
# Save current state
STASH=$(git stash create)

# Create temp commit with the breaking change
# (make the edit manually, then:)
git add src/memory-domain/db.js
git diff --cached > bench/realworld/fixtures/patches/break-createdb-config.patch

# Reset
git reset HEAD src/memory-domain/db.js
git checkout src/memory-domain/db.js
```

- [ ] **Step 5: Verify the patch applies and breaks the test**

```bash
# Create a test worktree
git worktree add /tmp/test-patch --detach $BASE_COMMIT
cd /tmp/test-patch
git apply /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/bench/realworld/fixtures/patches/break-createdb-config.patch
npm install --ignore-scripts 2>&1 | tail -1
npm test -- test/db-config.test.js 2>&1 | tail -5
cd -
git worktree remove /tmp/test-patch
```

Expected: Test fails after patch, confirming the bug injection works.

- [ ] **Step 6: Repeat for the other two patches**

Follow the same workflow for:
- `break-compact-guidance.patch` — break something in compact guidance
- `pr-trust-sync-change.patch` — modify trust-sync to run on all git operations

- [ ] **Step 7: Verify all 3 patches apply cleanly to the base commit**

```bash
BASE_COMMIT=$(grep -m1 '"checkout"' bench/realworld/tasks/bugfix-createdb-config.json | sed 's/.*: "//;s/".*//')
for patch in bench/realworld/fixtures/patches/*.patch; do
  echo -n "$patch: "
  git worktree add /tmp/verify-patch --detach $BASE_COMMIT 2>/dev/null
  (cd /tmp/verify-patch && git apply --stat /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension/$patch 2>&1 && echo "OK") || echo "FAIL"
  git worktree remove /tmp/verify-patch 2>/dev/null
done
```

Expected: All 3 patches show "OK".

- [ ] **Step 8: Commit**

```bash
git add bench/realworld/fixtures/patches/ bench/realworld/tasks/
git commit -m "feat(bench): finalize patches with real commit hashes"
```

---

### Task 8: Update README and validate full suite

**Files:**
- Modify: `bench/README.md` (add realworld section)

- [ ] **Step 1: Add realworld section to bench/README.md**

Append to `bench/README.md`:

```markdown

## Realworld Pi memory benchmark

`bench/realworld/bench-pi-realworld.js` runs Pi against real code-editing tasks — bugfixes, feature implementations, refactors, PR reviews — and measures whether memory-on improves completion rate, reduces wrong turns, and preserves project decisions better than memory-off.

Run:

```bash
npm run bench:pi-realworld
```

By default, the harness:
1. Creates a fresh git worktree for each run
2. Applies bug-injection patches to introduce failures
3. Runs Pi with the task prompt (memory-off first, then memory-on)
4. Grades results on three axes: tests pass, diff touches correct files, answer contains expected facts
5. Repeats each task 3 times for statistical signal

Options:

```bash
# More repetitions
node bench/realworld/bench-pi-realworld.js --runs 5

# Single task for debugging
node bench/realworld/bench-pi-realworld.js --only bugfix-createdb-config

# Keep worktrees for inspection
node bench/realworld/bench-pi-realworld.js --no-cleanup
```

Results are written under `bench/realworld/results/` with JSONL transcripts and a `report.json` summary.

The task pack lives in `bench/realworld/tasks/` with 8 tasks:
- 2 bugfix tasks (createDb config, compact guidance)
- 2 feature tasks (context hook, session summary)
- 1 refactor task (FTS5 rank scoring weights)
- 1 stale-index task (verify code index accuracy)
- 1 PR review task (evaluate trust-sync change)
- 1 negative-control task (README lookup)

Each task has:
- A `setup.checkout` pointing to a known-good commit
- Optional `setup.apply_patch` to inject a bug
- Optional `setup.seed_memory` to pre-populate LaPis with relevant memories
- `success.tests` — test commands that must pass after Pi edits
- `success.must_touch` / `success.must_not_touch` — file constraints
- `success.expected_facts` — answer content expectations

This complements the paired benchmark. The paired benchmark tests knowledge retrieval; this benchmark tests code editing and problem-solving.
```

- [ ] **Step 2: Verify the full suite loads without errors**

```bash
node bench/realworld/bench-pi-realworld.js --help
```

Expected: Help text printed, exit 0.

- [ ] **Step 3: Verify task loading works**

```bash
node -e "
const fs = require('fs');
const path = require('path');
const dir = 'bench/realworld/tasks';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let ok = true;
for (const f of files) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  if (t.setup.checkout === 'REPLACE_WITH_BASE_COMMIT') {
    console.error('UNRESOLVED: ' + f);
    ok = false;
  } else {
    console.log('OK: ' + t.id + ' @ ' + t.setup.checkout.slice(0, 8));
  }
}
process.exit(ok ? 0 : 1);
"
```

Expected: All 8 tasks show "OK" with short commit hashes.

- [ ] **Step 4: Commit**

```bash
git add bench/README.md
git commit -m "docs(bench): add realworld benchmark to README"
```

---

### Task 9: Smoke test — single task, single run

**Files:**
- No new files

This is a validation task. Run the benchmark with `--only negative-control-readme --runs 1` to verify the full pipeline works end-to-end without burning too many tokens.

- [ ] **Step 1: Run the negative-control task (cheapest — no patches, no code editing)**

```bash
node bench/realworld/bench-pi-realworld.js --only negative-control-readme --runs 1 --timeout-ms 300000
```

Expected: Completes without error, creates transcript files under `bench/realworld/results/`, prints the report table.

- [ ] **Step 2: Verify the output structure**

```bash
RESULT_DIR=$(ls -td bench/realworld/results/realworld-* | head -1)
ls -R "$RESULT_DIR"
```

Expected: Contains `report.json`, `transcripts/` directory with `.jsonl` files for memory-off and memory-on runs.

- [ ] **Step 3: Check the report JSON is valid**

```bash
RESULT_DIR=$(ls -td bench/realworld/results/realworld-* | head -1)
node -e "
const r = require('./$RESULT_DIR/report.json');
console.log('Tasks:', r.tasks);
console.log('Results:', r.results.length);
r.results.forEach(res => {
  console.log(res.task_id, res.side, 'run' + res.run_index,
    'tokens:', res.usage?.active_tokens || 0,
    'grade:', JSON.stringify(res.grade?.overall));
});
"
```

Expected: Shows 2 results (memory-off + memory-on), each with token usage and grade.

- [ ] **Step 4: Commit any fixes if needed**

If the smoke test revealed bugs, fix them and commit:

```bash
git add -A
git commit -m "fix(bench): fix issues found during smoke test"
```

---

## Self-Review

### Spec Coverage Check

| Requirement | Task |
|---|---|
| `npm run bench:pi-realworld` command | Task 1 (package.json script) |
| `bench/realworld/` directory structure | Task 1 |
| Task JSON definitions (6-8 tasks) | Task 4 (8 tasks created) |
| 2 bugfix tasks | Task 4 (createdb-config, compact-guidance) |
| 2 feature/navigation tasks | Task 4 (context-hook, session-summary) |
| 1 refactor respecting prior decision | Task 4 (fts5-rank) |
| 1 stale-index task | Task 4 (staleness-code-index) |
| 1 PR review task | Task 4 (review-pr-trust-sync) |
| 1 negative-control task | Task 4 (negative-control-readme) |
| `fixtures/patches/` | Tasks 5, 7 |
| `fixtures/memory-seeds/` | Task 6 |
| `graders/run-tests.js` | Task 2 |
| `graders/check-diff.js` | Task 2 |
| `graders/check-answer.js` | Task 2 |
| Fresh checkout per run | Task 3 (git worktree) |
| Seed/disable memory per side | Task 3 |
| Run Pi with task prompt | Task 3 |
| Grade tests, diff, answer | Task 3 (three-axis grading) |
| Save transcript, diff, tokens, tools | Task 3 |
| Repeat N times | Task 3 (`--runs` flag) |
| Report table (solved, tokens, time, tools, wrong edits) | Task 3 (printReport) |

### Placeholder Scan

- `REPLACE_WITH_BASE_COMMIT` appears in Task 4 step 2 and throughout Task 4. This is resolved in Task 7 step 2 with a sed replacement. Not a true placeholder — it's a deliberate variable that gets filled in a later task.
- No other TBD/TODO/fill-in-later patterns found.

### Type Consistency

- `runTests()` returns `{ passed, failed, total, results, skipped }` — used in `gradeRun()` as `testResult.passed === testResult.total && testResult.total > 0`. Matches.
- `checkDiff()` returns `{ passed, touched, violations, missed }` — used in `gradeRun()` as `diffResult.passed`. Matches.
- `checkAnswer()` returns `gradeAnswer()` output `{ matched, total, score, facts }` — used in report via `grade.answer`. Matches.
- Task JSON `success.tests` is `string[]` — `runTests()` iterates it as test commands. Matches.
- Task JSON `success.must_touch` / `success.must_not_touch` are `string[]` — `checkDiff()` iterates them. Matches.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-24-bench-pi-realworld.md`. Two execution options:

**Which execution approach?**

- **Sequential mode** (subagents) — I dispatch a fresh subagent per task, two-stage review (spec then quality). Fast iteration.
- **Direct mode** (no subagents) — Execute tasks in this session with checkpoint reviews. Same quality discipline, no agent delegation.

Both are part of superpowers:subagent-driven-development.
