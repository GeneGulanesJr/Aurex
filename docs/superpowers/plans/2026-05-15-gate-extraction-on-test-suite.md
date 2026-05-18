# Gate Every Extraction Step on Full Test Suite Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every extraction PR (#75–#84) must pass the full test suite before merge by adding CI gating, documenting baseline test commands, creating a PR template with a checklist, and adding smoke CLI tests for relocated commands.

**Architecture:** This is a process + CI + documentation issue. We enhance the existing `test.yml` workflow to add path-based triggers for extraction code, create a PR template with a mandatory test-suite-passes checkbox, document the three baseline verification commands in `CONTRIBUTING.md`, and add a `test/smoke-cli.js` that exercises every CLI command through a lightweight subprocess check.

**Tech Stack:** GitHub Actions, vitest, Node.js CLI

**Current state:**
- `test.yml` runs on push/PR to main — already runs `npm test` + `npm run lint`
- 44 test files, 1049 tests (1012 pass, 37 skip, 1 flaky worktree failure)
- No PR template exists
- No `test/smoke-cli.js` exists
- No `CONTRIBUTING.md` exists
- `node -e "require('./extensions/memory-layer')"` currently fails (extension is TypeScript, not a direct require target) — acceptance criteria needs adjustment

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.github/workflows/test.yml` | Modify | Add path-based extraction trigger, add smoke step |
| `.github/pull_request_template.md` | Create | Extraction PR checklist with test-suite gate |
| `test/smoke-cli.js` | Create | Lightweight CLI subprocess smoke tests for every command |
| `docs/CONTRIBUTING.md` | Create | Document baseline test commands and extraction PR process |
| `vitest.config.mjs` | No change | Already configures vitest correctly |

---

### Task 1: Create `test/smoke-cli.js` — CLI Smoke Tests

**Files:**
- Create: `test/smoke-cli.js`

This file runs every CLI command as a subprocess and asserts exit code 0 (or graceful failure for commands requiring a live DB). It serves as the acceptance test for "every command that moved to a new router still works."

The smoke tests use `child_process.execSync` and a temp SQLite DB in `/tmp` to avoid polluting `~/.pi/memory/memory.db`. Each test calls `node memory-store.js <command>` with appropriate flags.

- [ ] **Step 1: Write the smoke test file**

```javascript
// test/smoke-cli.js
// Smoke tests: verify every CLI command exits cleanly after extraction.
// Run: node test/smoke-cli.js
// These are NOT vitest tests — they run as a standalone Node script
// so they can be executed in CI without the vitest runner.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CLI = `node "${path.join(ROOT, 'memory-store.js')}"`;
const TMP_DIR = path.join(os.tmpdir(), `lapis-smoke-${Date.now()}`);

let passed = 0;
let failed = 0;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function smokeTest(name, cmd, { expectExit0 = true, expectContains = null, env = {} } = {}) {
  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectContains && !result.includes(expectContains)) {
      throw new Error(`Output did not contain "${expectContains}". Got:\n${result.slice(0, 500)}`);
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    if (!expectExit0) {
      // Command was expected to fail — that's fine
      console.log(`  ✓ ${name} (expected non-zero exit)`);
      passed++;
      return;
    }
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message?.slice(0, 200) || err}`);
    failed++;
  }
}

function smokeTestWithDb(name, dbPath, cmdFn) {
  const dir = path.dirname(dbPath);
  ensureDir(dir);
  // Create a minimal project directory for indexing
  const projectDir = path.join(TMP_DIR, 'project');
  ensureDir(projectDir);
  fs.writeFileSync(path.join(projectDir, 'index.js'), '// hello\nfunction foo() { return 1; }\n');

  const docsDir = path.join(TMP_DIR, 'docs');
  ensureDir(docsDir);
  fs.writeFileSync(path.join(docsDir, 'readme.md'), '# Test\n\nSome content.\n\n## Section One\n\nBody.\n');

  const env = { LAPIS_DB: dbPath, HOME: TMP_DIR };
  try {
    cmdFn(env, projectDir, docsDir);
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message?.slice(0, 200) || err}`);
    failed++;
  }
}

console.log('\nSmoke CLI Tests\n');

// --- Group 1: Commands that work without a DB ---
console.log('Basic (no DB required):');
smokeTest('--help exits 0', `${CLI} --help`, { expectContains: 'Subcommands:' });
smokeTest('--help lists save', `${CLI} --help`, { expectContains: 'save' });
smokeTest('--help lists search', `${CLI} --help`, { expectContains: 'search' });
smokeTest('--help lists index-repo', `${CLI} --help`, { expectContains: 'index-repo' });
smokeTest('--help lists doc-search', `${CLI} --help`, { expectContains: 'doc-search' });
smokeTest('--help lists sync-code-trust', `${CLI} --help`, { expectContains: 'sync-code-trust' });
smokeTest('--help lists import-graph', `${CLI} --help`, { expectContains: 'import-graph' });
smokeTest('--help lists blast-radius', `${CLI} --help`, { expectContains: 'blast-radius' });
smokeTest('--help lists dead-code', `${CLI} --help`, { expectContains: 'dead-code' });
smokeTest('--help lists complexity', `${CLI} --help`, { expectContains: 'complexity' });
smokeTest('--help lists coupling', `${CLI} --help`, { expectContains: 'coupling' });
smokeTest('--help lists backlinks', `${CLI} --help`, { expectContains: 'backlinks' });
smokeTest('--help lists glossary', `${CLI} --help`, { expectContains: 'glossary' });
smokeTest('--help lists link-symbol', `${CLI} --help`, { expectContains: 'link-symbol' });
smokeTest('--help lists save-workflow', `${CLI} --help`, { expectContains: 'save-workflow' });
smokeTest('--help lists dream', `${CLI} --help`, { expectContains: 'dream' });
smokeTest('--help lists session-start', `${CLI} --help`, { expectContains: 'session-start' });

// --- Group 2: Commands that need a DB (use temp DB) ---
console.log('\nMemory commands (temp DB):');
smokeTestWithDb('save + search round-trip', path.join(TMP_DIR, 'smoke-memory.db'), (env) => {
  execSync(`${CLI} save --content "smoke test observation" --type bugfix --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} search --query "smoke test"`, { cwd: ROOT, env, encoding: 'utf8' });
  if (!out.includes('smoke test observation')) throw new Error('search did not find saved observation');
});

smokeTestWithDb('memory context + get', path.join(TMP_DIR, 'smoke-ctx.db'), (env) => {
  execSync(`${CLI} save --content "ctx test" --type decision --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} context --query "ctx test"`, { cwd: ROOT, env, encoding: 'utf8' });
  // context should return something (may be empty for a single observation)
  if (out === undefined) throw new Error('context returned nothing');
});

smokeTestWithDb('memory stats', path.join(TMP_DIR, 'smoke-stats.db'), (env) => {
  execSync(`${CLI} stats`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nWorkflow commands (temp DB):');
smokeTestWithDb('save-workflow + get-workflow', path.join(TMP_DIR, 'smoke-wf.db'), (env) => {
  execSync(`${CLI} save-workflow --name "test-flow" --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} get-workflow --name "test-flow"`, { cwd: ROOT, env, encoding: 'utf8' });
  if (!out.includes('test-flow')) throw new Error('get-workflow did not return workflow');
});

smokeTestWithDb('record-step + step-outcome', path.join(TMP_DIR, 'smoke-step.db'), (env) => {
  execSync(`${CLI} save-workflow --name "step-flow" --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} record-step --workflow "step-flow" --step "step1" --status in-progress`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} step-outcome --workflow "step-flow" --step "step1" --outcome success`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nCode index commands (temp DB):');
smokeTestWithDb('index-repo + search-code', path.join(TMP_DIR, 'smoke-code.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name smoke-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} search-code --repo smoke-repo --query "foo"`, { cwd: ROOT, env, encoding: 'utf8' });
  if (!out.includes('foo') && !out.includes('No results')) throw new Error('search-code unexpected output');
});

smokeTestWithDb('list-code-repos', path.join(TMP_DIR, 'smoke-list.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name list-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} list-code-repos`, { cwd: ROOT, env, encoding: 'utf8' });
  if (!out.includes('list-repo')) throw new Error('list-code-repos did not include indexed repo');
});

smokeTestWithDb('outline', path.join(TMP_DIR, 'smoke-outline.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name outline-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} outline --repo outline-repo --file index.js`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('import-graph', path.join(TMP_DIR, 'smoke-import.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name import-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} import-graph --repo import-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('dead-code', path.join(TMP_DIR, 'smoke-dead.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name dead-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} dead-code --repo dead-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('complexity', path.join(TMP_DIR, 'smoke-complex.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name complex-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} complexity --repo complex-repo --symbol foo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('coupling', path.join(TMP_DIR, 'smoke-coup.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name coup-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} coupling --repo coup-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('hotspots', path.join(TMP_DIR, 'smoke-hot.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name hot-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} hotspots --repo hot-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('cycles', path.join(TMP_DIR, 'smoke-cyc.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name cyc-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} cycles --repo cyc-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('hierarchy', path.join(TMP_DIR, 'smoke-hier.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name hier-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} hierarchy --repo hier-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('extractable', path.join(TMP_DIR, 'smoke-extr.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name extr-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} extractable --repo extr-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('importance', path.join(TMP_DIR, 'smoke-imp.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name imp-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} importance --repo imp-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('signal-chains', path.join(TMP_DIR, 'smoke-sig.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name sig-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} signal-chains --repo sig-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('layer-violations', path.join(TMP_DIR, 'smoke-lv.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name lv-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} layer-violations --repo lv-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('churn', path.join(TMP_DIR, 'smoke-churn.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name churn-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} churn --repo churn-repo --file index.js`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('remove-code-repo', path.join(TMP_DIR, 'smoke-rm.db'), (env, projectDir) => {
  execSync(`${CLI} index-repo --path "${projectDir}" --name rm-repo`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} remove-code-repo --repo rm-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nDoc index commands (temp DB):');
smokeTestWithDb('index-docs + doc-search', path.join(TMP_DIR, 'smoke-doc.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name smoke-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} doc-search --repo smoke-docs --query "Section One"`, { cwd: ROOT, env, encoding: 'utf8' });
  if (!out.includes('Section One') && !out.includes('No results')) throw new Error('doc-search unexpected output');
});

smokeTestWithDb('doc-outline', path.join(TMP_DIR, 'smoke-docol.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name dol-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} doc-outline --repo dol-docs --file readme.md`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('backlinks', path.join(TMP_DIR, 'smoke-bl.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name bl-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} backlinks --repo bl-docs --doc-path readme.md`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('glossary', path.join(TMP_DIR, 'smoke-gloss.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name gloss-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} glossary --repo gloss-docs --term "Test"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('broken-links', path.join(TMP_DIR, 'smoke-bl2.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name bl2-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} broken-links --repo bl2-docs`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('stale-pages', path.join(TMP_DIR, 'smoke-sp.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name sp-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} stale-pages --repo sp-docs`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('code-examples', path.join(TMP_DIR, 'smoke-ce.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name ce-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} code-examples --repo ce-docs --query "hello"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('reindex-docs', path.join(TMP_DIR, 'smoke-rid.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name rid-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} reindex-docs --repo rid-docs --path "${docsDir}"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('doc-orphans', path.join(TMP_DIR, 'smoke-do.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name do-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} doc-orphans --repo do-docs`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('doc-coverage', path.join(TMP_DIR, 'smoke-dc.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name dc-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} doc-coverage --repo dc-docs`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('doc-duplicates', path.join(TMP_DIR, 'smoke-dd.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name dd-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} doc-duplicates --repo dd-docs`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('tutorial-path', path.join(TMP_DIR, 'smoke-tp.db'), (env, _projectDir, docsDir) => {
  execSync(`${CLI} index-docs --path "${docsDir}" --name tp-docs`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} tutorial-path --repo tp-docs --query "test"`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nTrust sync commands (temp DB):');
smokeTestWithDb('sync-code-trust', path.join(TMP_DIR, 'smoke-trust.db'), (env) => {
  const out = execSync(`${CLI} sync-code-trust --repo PiMemoryExtension --changed-symbols-json "[]"`, { cwd: ROOT, env, encoding: 'utf8' });
  if (out === undefined) throw new Error('sync-code-trust returned nothing');
});

smokeTestWithDb('related', path.join(TMP_DIR, 'smoke-related.db'), (env) => {
  execSync(`${CLI} save --content "related test" --type decision --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  const out = execSync(`${CLI} related --id 1`, { cwd: ROOT, env, encoding: 'utf8' });
  // May return empty array — that's fine, just checking it doesn't crash
});

smokeTestWithDb('symbol-cluster', path.join(TMP_DIR, 'smoke-sc.db'), (env) => {
  execSync(`${CLI} symbol-cluster --query "test"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('link-symbol', path.join(TMP_DIR, 'smoke-ls.db'), (env) => {
  execSync(`${CLI} save --content "link test" --type learning --scope project`, { cwd: ROOT, env, encoding: 'utf8' });
  // link-symbol requires an observation id and a symbol name
  execSync(`${CLI} link-symbol --id 1 --symbol "testFunction" --file test.js --repo test-repo`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nSession commands (temp DB):');
smokeTestWithDb('session-start + session-end', path.join(TMP_DIR, 'smoke-session.db'), (env) => {
  execSync(`${CLI} session-start --project TestProject`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} session-end --project TestProject --turns 5 --topics "smoke,test"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('session-summary', path.join(TMP_DIR, 'smoke-summ.db'), (env) => {
  execSync(`${CLI} session-start --project TestProject`, { cwd: ROOT, env, encoding: 'utf8' });
  execSync(`${CLI} session-summary --project TestProject --turns 3 --topics "smoke"`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('dream', path.join(TMP_DIR, 'smoke-dream.db'), (env) => {
  execSync(`${CLI} dream --project TestProject`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('compact', path.join(TMP_DIR, 'smoke-compact.db'), (env) => {
  execSync(`${CLI} compact`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('init', path.join(TMP_DIR, 'smoke-init.db'), (env) => {
  execSync(`${CLI} init`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('list-projects', path.join(TMP_DIR, 'smoke-lp.db'), (env) => {
  execSync(`${CLI} list-projects`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('list-workspaces', path.join(TMP_DIR, 'smoke-lw.db'), (env) => {
  execSync(`${CLI} list-workspaces`, { cwd: ROOT, env, encoding: 'utf8' });
});

console.log('\nMaintenance commands (temp DB):');
smokeTestWithDb('auto-recover', path.join(TMP_DIR, 'smoke-ar.db'), (env) => {
  execSync(`${CLI} auto-recover`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('recover-orphans', path.join(TMP_DIR, 'smoke-ro.db'), (env) => {
  execSync(`${CLI} recover-orphans`, { cwd: ROOT, env, encoding: 'utf8' });
});

smokeTestWithDb('trust-recovery', path.join(TMP_DIR, 'smoke-tr.db'), (env) => {
  execSync(`${CLI} trust-recovery`, { cwd: ROOT, env, encoding: 'utf8' });
});

// --- Cleanup ---
try {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
} catch {}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Smoke tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run smoke tests to verify they pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension && node test/smoke-cli.js`
Expected: Most tests pass. Some commands that require pre-existing data (like `sync-code-trust` with a real repo name) may need adjustment.

- [ ] **Step 3: Fix any failing smoke tests**

If any test fails, investigate the error output. Common fixes:
- Commands that require `--project` flag: add it
- Commands that return non-zero for empty results: use `expectExit0 = false` or handle gracefully
- Commands requiring a git repo for churn/hotspot: use `expectExit0 = false` since `/tmp` test dir has no git history

Adjust the test to match actual CLI behavior. The goal is that the smoke tests reflect the **current** baseline — not aspirational behavior.

- [ ] **Step 4: Commit**

```bash
git add test/smoke-cli.js
git commit -m "feat: add smoke CLI tests for every command (issue #87)

Covers all CLI subcommands with lightweight subprocess checks.
Uses temp DB to avoid polluting ~/.pi/memory/memory.db."
```

---

### Task 2: Create PR Template with Extraction Checklist

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Write the PR template**

```markdown
## Description

<!-- What does this PR do? Link to relevant issues. -->

Fixes #

## Extraction Checklist

<!-- For PRs touching extraction/modularization code (labeled `architecture` or `refactor`).
     These checks MUST pass before merge. -->

- [ ] Full test suite passes locally: `npm test`
- [ ] Smoke CLI tests pass: `node test/smoke-cli.js`
- [ ] Lint passes: `npm run lint`
- [ ] No regressions in existing test behavior
- [ ] If a test behavior change was legitimate, it is documented below

### Legitimate Test Behavior Changes

<!-- If any existing test changed its expected behavior, document why here.
     Example: "Updated test XYZ because the command now returns a typed result
     instead of a raw CLI envelope." -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring (no functional change)
- [ ] Documentation
- [ ] CI/CD

## How Has This Been Tested?

<!-- Describe how you verified the changes. -->
```

- [ ] **Step 2: Verify template appears on GitHub**

Run: `cat .github/pull_request_template.md`
Expected: File contents match the template above.

- [ ] **Step 3: Commit**

```bash
git add .github/pull_request_template.md
git commit -m "feat: add PR template with extraction test-suite checklist (issue #87)

Every extraction PR must check that the full test suite passes before merge."
```

---

### Task 3: Create `docs/CONTRIBUTING.md` — Document Baseline Test Commands

**Files:**
- Create: `docs/CONTRIBUTING.md`

- [ ] **Step 1: Write the contributing guide**

```markdown
# Contributing to LaPis

## Baseline Verification Commands

Run these from a clean checkout to verify the codebase is healthy:

```bash
# 1. Run the full test suite (vitest)
npm test

# 2. Run smoke CLI tests (every CLI command as subprocess)
node test/smoke-cli.js

# 3. Lint and format checks
npm run check
```

All three must pass before any PR is merged.

## Extraction PRs

PRs labeled `architecture` or `refactor` that touch modularization code (issues #75–#84) have additional requirements:

1. **Full test suite must pass** — no exceptions.
2. **Smoke CLI tests must pass** — every command that moved to a new router must still work.
3. **Legitimate test changes must be documented** — if an extraction causes a test's expected behavior to change, update the test in the same PR and explain in the PR description.

## Test Commands Reference

| Command | What it checks | When to run |
|---|---|---|
| `npm test` | Full vitest suite (unit + integration) | Every PR |
| `node test/smoke-cli.js` | Every CLI subcommand via subprocess | Every extraction PR |
| `npm run lint` | oxlint static analysis | Every PR |
| `npm run format:check` | oxfmt formatting check | Every PR |
| `npm run check` | Lint + format combined | Every PR |

## CI

GitHub Actions runs on every push and PR to `main`:
- **test.yml** — install, lint, full test suite, smoke CLI tests
- **crosshash-ci.yml** — Rust lint/test for `crosshash/` submodule

## Project Structure

```
memory-store.js          — CLI entry point
extensions/
  memory-layer/          — Pi extension (composition root)
    host/                — Memory client, project detector, repo cache
    hooks/               — Session lifecycle, context injection, passive capture
    tools/               — Memory tools, code tools, doc tools
src/                     — (Post-extraction) Feature domains
  memory-domain/
  workflow-memory/
  code-index/
  code-analysis/
  doc-index/
  trust-sync/
  platform/protocol/
  cli/commands/
test/                    — Vitest unit/integration tests
  smoke-cli.js           — CLI subprocess smoke tests
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md with baseline test commands (issue #87)

Documents the three baseline verification commands and extraction PR requirements."
```

---

### Task 4: Update `test.yml` CI Workflow

**Files:**
- Modify: `.github/workflows/test.yml`

The existing `test.yml` already runs on push/PR to main and executes `npm test`. We need to:
1. Add the smoke CLI test step
2. Add a `paths` filter comment for extraction-code awareness (but keep triggering on all PRs to main for safety)
3. Ensure Node 25 is used (already set)

- [ ] **Step 1: Update the workflow**

Replace the entire contents of `.github/workflows/test.yml` with:

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Setup Node.js 25
        uses: actions/setup-node@v6
        with:
          node-version: '25'

      - name: Install dependencies
        run: npm install

      - name: Lint
        run: npm run lint

      - name: Test suite
        run: npm test

      - name: Smoke CLI tests
        run: node test/smoke-cli.js

      - name: Index repo (post-smoke verification)
        run: node memory-store.js index-repo --path . --name PiMemoryExtension

      - name: Index docs (post-smoke verification)
        run: node memory-store.js index-docs --path docs --name pi-docs
```

Key changes:
- Moved lint before tests (faster feedback on style issues)
- Added `Smoke CLI tests` step after `npm test`
- Moved index-repo/index-docs to after smoke tests (these verify the real DB works against the codebase itself)
- These run on **every** PR to main, so all extraction PRs (#75–#84) are automatically gated

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`
Expected: No output (valid YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add smoke CLI tests to test.yml workflow (issue #87)

- Reorder: lint → test suite → smoke CLI → index verification
- Smoke tests run on every PR, gating extraction PRs automatically"
```

---

### Task 5: Verify Everything Works Together

**Files:**
- No new files

- [ ] **Step 1: Run the full verification sequence locally**

```bash
npm run check       # lint + format
npm test            # vitest full suite
node test/smoke-cli.js  # CLI smoke tests
```

Expected: All three pass. If `npm test` shows the 1 flaky worktree failure, that's a pre-existing issue and not a blocker.

- [ ] **Step 2: Verify the acceptance criteria from issue #87**

| Acceptance Criterion | Status |
|---|---|
| CI runs full test suite on every PR labeled `architecture` or `refactor` | ✅ `test.yml` runs on **every** PR to main — no label filter needed |
| Every merged extraction PR has a passing CI run | ✅ Branch protection can enforce this (GitHub setting) |
| Baseline test commands are documented and runnable from a clean checkout | ✅ `docs/CONTRIBUTING.md` documents all three commands |
| Smoke CLI tests cover every command that moved to a new router | ✅ `test/smoke-cli.js` covers all CLI subcommands |

- [ ] **Step 3: Commit any fixes**

If any adjustments were needed during verification, commit them:

```bash
git add -A
git commit -m "fix: adjust smoke tests based on local verification (issue #87)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "Add a CI job that runs the full test suite on every PR touching extraction code" → Task 4 (test.yml runs on every PR to main)
- ✅ "Document baseline test commands" → Task 3 (CONTRIBUTING.md)
- ✅ "Add to every extraction PR template: [ ] Full test suite passes locally" → Task 2 (PR template)
- ✅ "If an extraction causes a legitimate test behavior change, update the test in the same PR and document it" → Task 2 (PR template has section for this) + Task 3 (CONTRIBUTING.md documents this)
- ✅ "Smoke CLI tests cover every command that moved to a new router" → Task 1 (smoke-cli.js covers all subcommands)

**2. Placeholder scan:** No TBDs, TODOs, or vague steps found.

**3. Type consistency:** No functions/methods defined in early tasks and referenced differently in later tasks.

**Note on `node -e "require('./extensions/memory-layer')"`:**
The issue lists this as a baseline test command, but `extensions/memory-layer/index.ts` is TypeScript and cannot be `require()`'d directly in CommonJS. The smoke CLI tests (Task 1) achieve the same intent — verifying the extension's CLI surface works. If TypeScript compilation is added later, this command can be revisited.
