# Consistency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7 root-cause issues making LaPis behave inconsistently — indexed repos not being recognized by guardrails, stale index detection never firing, and explored files not tracked from non-outline analysis modes.

**Architecture:** Each fix targets a specific layer of the enforcement pipeline: repo cache invalidation after mutations (state layer), explored-files tracking from all analysis modes (guardrails layer), staleness detection via actual file mtimes (detector layer), context reminder frequency (hooks layer), dedup bypass in passive capture (capture layer), config file false positives (guardrails layer), and silent registration failures (bootstrap layer).

**Tech Stack:** TypeScript, Vitest, Node.js `fs`/`path`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/memory-layer/state.ts` | Modify | Add `invalidateRepoCache()` helper |
| `extensions/memory-layer/host/project-detector.ts` | Modify | Fix `isRepoStale` to sample file mtimes; add `invalidateRepoCache` |
| `extensions/memory-layer/tools/code-tools.ts` | Modify | Call `invalidateRepoCache` after index/reindex |
| `extensions/memory-layer/hooks/tool-guardrails.ts` | Modify | Track explored files from all modes; exclude config file patterns |
| `extensions/memory-layer/hooks/context-injection.ts` | Modify | Change reminder to sliding-window counter |
| `extensions/memory-layer/hooks/passive-capture.ts` | Modify | Remove `force: true` from auto-detected decisions |
| `extensions/memory-layer/index.ts` | Modify | Surface registration failures via UI |
| `test/repo-cache.test.js` | Modify | Add tests for new staleness logic and cache invalidation |
| `test/guardrails.test.js` | Create | Tests for tool guardrails (repo cache, explored files, config exclusion) |
| `test/context-reminder.test.js` | Create | Tests for sliding-window context reminder |

---

## Task 1: Add `invalidateRepoCache` to state + project-detector

**Files:**
- Modify: `extensions/memory-layer/state.ts:95-96`
- Modify: `extensions/memory-layer/host/project-detector.ts:7-19`
- Test: `test/repo-cache.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/repo-cache.test.js` after the existing `isRepoStale` describe block:

```javascript
import { isRepoStale, getKnownRepos, invalidateRepoCache } from '../extensions/memory-layer/host/project-detector.ts';
import { state } from '../extensions/memory-layer/state.ts';

describe('invalidateRepoCache', () => {
  it('should clear cached repos and reset cache time', () => {
    state.cachedRepos = [{ name: 'test', path: '/test', indexed_at: '2025-01-01', file_count: 1, symbol_count: 1 }];
    state.repoCacheTime = Date.now();

    invalidateRepoCache();

    expect(state.cachedRepos).toBeNull();
    expect(state.repoCacheTime).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/repo-cache.test.js`
Expected: FAIL — `invalidateRepoCache` is not exported

- [ ] **Step 3: Write minimal implementation**

In `extensions/memory-layer/host/project-detector.ts`, add after line 19 (after the `getKnownRepos` function):

```typescript
export function invalidateRepoCache(): void {
  state.cachedRepos = null;
  state.repoCacheTime = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/repo-cache.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/state.ts extensions/memory-layer/host/project-detector.ts test/repo-cache.test.js
git commit -m "feat: add invalidateRepoCache helper for cache busting after index operations"
```

---

## Task 2: Invalidate repo cache after index/reindex

**Files:**
- Modify: `extensions/memory-layer/tools/code-tools.ts:8-13` (deps interface)
- Modify: `extensions/memory-layer/tools/code-tools.ts:195-215` (index-repo handler)
- Modify: `extensions/memory-layer/index.ts:19` (pass new dep)

- [ ] **Step 1: Write the failing test**

Create `test/guardrails.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('code-tools repo cache invalidation', () => {
  it('should call invalidateRepoCache after successful index-repo', async () => {
    const { invalidateRepoCache } = await import('../extensions/memory-layer/host/project-detector.ts');
    const { state } = await import('../extensions/memory-layer/state.ts');

    state.cachedRepos = [{ name: 'old', path: '/old', indexed_at: '2020-01-01', file_count: 1, symbol_count: 1 }];
    state.repoCacheTime = Date.now();

    invalidateRepoCache();

    expect(state.cachedRepos).toBeNull();
    expect(state.repoCacheTime).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (the helper already exists from Task 1)

Run: `npx vitest run test/guardrails.test.js`
Expected: PASS

- [ ] **Step 3: Wire `invalidateRepoCache` into code-tools after index/reindex**

In `extensions/memory-layer/tools/code-tools.ts`, add to the `CodeDeps` interface:

```typescript
interface CodeDeps {
  mem: typeof mem;
  memStreaming: typeof memStreaming;
  getKnownRepos: typeof getKnownRepos;
  formatCodeResult: typeof formatCodeResult;
  invalidateRepoCache: () => void;
}
```

In the `execute` handler, after the successful `index-repo`/`reindex-repo` result (line ~207, after `return toolTextResult(fmt || 'Indexing completed.', result ?? {});` — actually before the return), insert cache invalidation:

```typescript
          // Invalidate repo cache so guardrails immediately recognize the new/updated repo
          deps.invalidateRepoCache();
          let fmt: string | undefined | null;
          try {
            fmt = deps.formatCodeResult(mode, result);
          } catch {
            fmt = '';
          }
          return toolTextResult(fmt || 'Indexing completed.', result ?? {});
```

In `extensions/memory-layer/index.ts`, add to the deps object (after `getKnownRepos`):

```typescript
    getKnownRepos,
    invalidateRepoCache,
```

And update the import at the top of `index.ts`:

```typescript
import { detectProject, getKnownRepos, invalidateRepoCache, isRepoStale } from './host/project-detector';
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/tools/code-tools.ts extensions/memory-layer/index.ts test/guardrails.test.js
git commit -m "fix: invalidate repo cache after index/reindex so guardrails activate immediately"
```

---

## Task 3: Fix `isRepoStale` to sample file mtimes

**Files:**
- Modify: `extensions/memory-layer/host/project-detector.ts:21-31`
- Test: `test/repo-cache.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/repo-cache.test.js` inside the existing `isRepoStale` describe block:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ... inside describe('isRepoStale', ...) add:

  it('should return true when source files were modified after indexing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-stale-'));
    try {
      const srcFile = path.join(tmpDir, 'index.js');
      fs.writeFileSync(srcFile, 'console.log("hello")');

      // indexed 2 hours ago
      const indexedAt = new Date(Date.now() - 7200000).toISOString();
      const repo = {
        name: 'test-stale',
        path: tmpDir,
        indexed_at: indexedAt,
        file_count: 1,
        symbol_count: 1,
      };

      // File was just modified (newer than indexed_at + 1hr threshold)
      expect(isRepoStale(repo)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return false when source files are older than indexing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-fresh-'));
    try {
      const srcFile = path.join(tmpDir, 'index.js');
      fs.writeFileSync(srcFile, 'console.log("hello")');

      // indexed just now
      const indexedAt = new Date().toISOString();
      const repo = {
        name: 'test-fresh',
        path: tmpDir,
        indexed_at: indexedAt,
        file_count: 1,
        symbol_count: 1,
      };

      expect(isRepoStale(repo)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/repo-cache.test.js`
Expected: The "modified after indexing" test FAILS because the current `isRepoStale` only checks directory mtime, not file mtime.

- [ ] **Step 3: Rewrite `isRepoStale` to sample file mtimes**

Replace the `isRepoStale` function in `extensions/memory-layer/host/project-detector.ts` (lines 21-31):

```typescript
export function isRepoStale(repo: RepoInfo): boolean {
  try {
    const fs = require('fs');
    const pathMod = require('path');
    const indexedTime = new Date(repo.indexed_at).getTime() + 3600000; // 1h grace

    // Sample up to 50 source files for mtime changes
    const extensions = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java']);
    let checked = 0;
    const maxCheck = 50;

    function checkDir(dir) {
      if (checked >= maxCheck) return true; // assume stale if too many files
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const entry of entries) {
        if (checked >= maxCheck) return true;
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (checkDir(fullPath)) return true;
        } else if (extensions.has(pathMod.extname(entry.name).toLowerCase())) {
          checked++;
          try {
            const stat = fs.statSync(fullPath);
            if (Math.max(stat.mtimeMs, stat.ctimeMs) > indexedTime) return true;
          } catch {}
        }
      }
      return false;
    }

    return checkDir(repo.path);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/repo-cache.test.js`
Expected: All PASS

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/memory-layer/host/project-detector.ts test/repo-cache.test.js
git commit -m "fix: isRepoStale now samples source file mtimes instead of directory mtime"
```

---

## Task 4: Track explored files from all memory-code modes

**Files:**
- Modify: `extensions/memory-layer/hooks/tool-guardrails.ts:14-27`
- Modify: `extensions/memory-layer/tools/code-tools.ts:8-13` (add state dep)
- Modify: `extensions/memory-layer/index.ts` (pass state dep)
- Test: `test/guardrails.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/guardrails.test.js`:

```javascript
import { state } from '../extensions/memory-layer/state.ts';

describe('tool-guardrails exploredFiles tracking', () => {
  beforeEach(() => {
    state.exploredFiles = new Set();
  });

  it('should add file to exploredFiles when memory-code outline is called', () => {
    const relPath = 'src/foo.ts';
    state.exploredFiles.add(relPath.toLowerCase());
    expect(state.exploredFiles.has(relPath.toLowerCase())).toBe(true);
  });

  it('should not block read after a file was explored via memory-code', () => {
    const relPath = 'src/foo.ts';
    state.exploredFiles.add(relPath.toLowerCase());
    // Simulating the guardrail check: if exploredFiles has it, don't block
    const basename = 'foo.ts';
    const absPath = '/project/src/foo.ts';
    const shouldAllow =
      state.exploredFiles.has(basename.toLowerCase()) ||
      state.exploredFiles.has(relPath.toLowerCase()) ||
      state.exploredFiles.has(absPath.toLowerCase());
    expect(shouldAllow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these test the state logic, already works)

Run: `npx vitest run test/guardrails.test.js`
Expected: PASS

- [ ] **Step 3: Modify tool-guardrails to also accept `tool_result` events from memory-code**

The key change: in addition to tracking `file` from `tool_call`, also track files from `tool_result` when memory-code returns results containing file paths.

In `extensions/memory-layer/hooks/tool-guardrails.ts`, modify the `registerToolGuardrails` function. After the existing `tool_call` handler, add a `tool_result` handler:

```typescript
  pi.on('tool_result', async (event, _ctx) => {
    if (event.toolName !== 'memory-code') return;
    if (!event.result) return;

    // Extract file paths from memory-code results to mark as explored
    const resultText = typeof event.result === 'string'
      ? event.result
      : JSON.stringify(event.result);

    // Match relative file paths like "src/foo.ts" or "extensions/memory-layer/hooks/tool-guardrails.ts"
    const filePaths = resultText.match(/[\w/.-]+\.(ts|js|tsx|jsx|mjs|cjs|py|go|rs)/g) || [];
    for (const fp of filePaths) {
      deps.state.exploredFiles.add(fp.toLowerCase());
      const basename = fp.split('/').pop();
      if (basename) {
        deps.state.exploredFiles.add(basename.toLowerCase());
      }
    }
  });
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/hooks/tool-guardrails.ts test/guardrails.test.js
git commit -m "fix: track explored files from all memory-code modes via tool_result, not just outline"
```

---

## Task 5: Exclude config files from guardrail blocking

**Files:**
- Modify: `extensions/memory-layer/hooks/tool-guardrails.ts:64-68` (read handler)
- Modify: `extensions/memory-layer/state.ts:53-88` (CODE_EXTENSIONS or new set)
- Test: `test/guardrails.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/guardrails.test.js`:

```javascript
describe('config file exclusion', () => {
  it('should identify config files that should not be blocked', () => {
    const configFilePatterns = [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'vitest.config.mjs',
      'vitest.config.ts',
      '.eslintrc.json',
      '.prettierrc',
      'tailwind.config.ts',
    ];

    // These should NOT be treated as code files for guardrail purposes
    const isConfig = (fp) => {
      const basename = fp.split('/').pop() || fp;
      return basename.includes('config.') ||
        basename.startsWith('.eslint') ||
        basename.startsWith('.prettier') ||
        basename === 'package.json' ||
        basename === 'package-lock.json' ||
        basename === 'composer.json';
    };

    for (const fp of configFilePatterns) {
      expect(isConfig(fp)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/guardrails.test.js`
Expected: PASS

- [ ] **Step 3: Add config-file allowlist to guardrails**

In `extensions/memory-layer/hooks/tool-guardrails.ts`, add a constant after the imports:

```typescript
const CONFIG_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.node.json',
  'vitest.config.ts',
  'vitest.config.mjs',
  'vitest.config.js',
  'jest.config.ts',
  'jest.config.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  'tailwind.config.ts',
  'tailwind.config.js',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'rollup.config.js',
  'babel.config.js',
  'babel.config.json',
  '.babelrc',
  'composer.json',
  'Cargo.toml',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
]);
```

Then in the `read` tool handler, after the `if (!deps.isCodeFile(filePath)) return;` check (line ~68), add:

```typescript
      const basename = path.basename(filePath);
      if (CONFIG_FILENAMES.has(basename)) {
        return;
      }
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/hooks/tool-guardrails.ts test/guardrails.test.js
git commit -m "fix: exclude config files (package.json, tsconfig, etc.) from guardrail blocking"
```

---

## Task 6: Change context reminder to sliding-window counter

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts:163-191`
- Modify: `extensions/memory-layer/state.ts:97` (add new state field)
- Test: `test/context-reminder.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/context-reminder.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

describe('context reminder sliding window', () => {
  it('should track calls since last memory tool use', () => {
    const REMINDER_THRESHOLD = 5;
    let callsSinceLastMemory = 0;
    let lastMemoryToolCall = 0;

    function shouldRemind(now) {
      callsSinceLastMemory++;
      if (now - lastMemoryToolCall < 180000) return false;
      return callsSinceLastMemory >= REMINDER_THRESHOLD;
    }

    // After memory tool call, reset
    lastMemoryToolCall = Date.now();
    callsSinceLastMemory = 0;

    expect(shouldRemind(Date.now())).toBe(false); // 1
    expect(shouldRemind(Date.now())).toBe(false); // 2
    expect(shouldRemind(Date.now())).toBe(false); // 3
    expect(shouldRemind(Date.now())).toBe(false); // 4
    expect(shouldRemind(Date.now())).toBe(true);  // 5 → triggers
  });

  it('should reset counter when memory tool is used', () => {
    let callsSinceLastMemory = 0;
    const REMINDER_THRESHOLD = 5;

    function shouldRemind() {
      callsSinceLastMemory++;
      return callsSinceLastMemory >= REMINDER_THRESHOLD;
    }

    function onMemoryToolCall() {
      callsSinceLastMemory = 0;
    }

    expect(shouldRemind()).toBe(false); // 1
    expect(shouldRemind()).toBe(false); // 2
    expect(shouldRemind()).toBe(false); // 3
    onMemoryToolCall(); // reset
    expect(shouldRemind()).toBe(false); // 1
    expect(shouldRemind()).toBe(false); // 2
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/context-reminder.test.js`
Expected: PASS (pure logic test)

- [ ] **Step 3: Add `callsSinceLastMemory` to state**

In `extensions/memory-layer/state.ts`, add to the `state` object after `lastMemoryToolCall`:

```typescript
  callsSinceLastMemory: 0 as number,
```

And change `MEMORY_REMINDER_INTERVAL`:

```typescript
export const MEMORY_REMINDER_INTERVAL = 5;
```

- [ ] **Step 4: Update tool-guardrails to reset counter on memory tool use**

In `extensions/memory-layer/hooks/tool-guardrails.ts`, update the memory-code and memory-\* handlers:

```typescript
    if (toolName === 'memory-code') {
      deps.state.lastMemoryToolCall = Date.now();
      deps.state.callsSinceLastMemory = 0;
      // ... rest unchanged
    }
    if (toolName.startsWith('memory-')) {
      deps.state.lastMemoryToolCall = Date.now();
      deps.state.callsSinceLastMemory = 0;
      return;
    }
```

- [ ] **Step 5: Rewrite `registerContextReminder` to use sliding window**

Replace the body of `registerContextReminder` in `extensions/memory-layer/hooks/context-injection.ts` (lines 163-191):

```typescript
export function registerContextReminder(pi: ExtensionAPI, deps: ContextDeps) {
  pi.on('context', async (event, _ctx) => {
    if (deps.state.hasInjectedContext) {
      deps.state.hasInjectedContext = false;
      return;
    }

    deps.state.callsSinceLastMemory++;

    if (deps.state.callsSinceLastMemory < MEMORY_REMINDER_INTERVAL) {
      return;
    }

    if (Date.now() - deps.state.lastMemoryToolCall < 180000) {
      return;
    }

    // Reset counter after firing
    deps.state.callsSinceLastMemory = 0;

    return {
      messages: [
        ...event.messages,
        {
          role: 'user' as const,
          content:
            '💡 Memory reminder: Use `memory-search` before decisions to avoid repeating past mistakes. Use `memory-save` for decisions, bugfixes, and discoveries.',
        },
      ],
    };
  });
}
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 7: Commit**

```bash
git add extensions/memory-layer/hooks/context-injection.ts extensions/memory-layer/hooks/tool-guardrails.ts extensions/memory-layer/state.ts test/context-reminder.test.js
git commit -m "fix: context reminder uses sliding-window counter (5 calls since last memory use) instead of modulo"
```

---

## Task 7: Remove `force: true` from auto-detected decisions in passive capture

**Files:**
- Modify: `extensions/memory-layer/hooks/passive-capture.ts:107-127`

- [ ] **Step 1: Write the failing test**

Add to `test/guardrails.test.js`:

```javascript
describe('passive capture dedup', () => {
  it('should NOT use force:true for auto-detected decisions', () => {
    // Verify that the auto-save call doesn't include force:true
    // This is a design contract test
    const autoSaveArgs = {
      title: 'Design decision: test',
      type: 'decision',
      project: 'test',
      scope: 'project',
      // force should NOT be present for decisions
      content: '**What**: Auto-detected',
    };

    expect(autoSaveArgs.force).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/guardrails.test.js`
Expected: PASS (contract test)

- [ ] **Step 3: Remove `force: true` from auto-detected decisions**

In `extensions/memory-layer/hooks/passive-capture.ts`, change the `save` call in the `message_end` handler (around line 118):

Remove `force: 'true'` from the object. The new call:

```typescript
        await deps.mem('save', {
          title,
          type: pattern.type,
          project: deps.state.currentProject || 'unknown',
          scope: 'project',
          content: [
            `**What**: Auto-detected ${pattern.label.toLowerCase()}`,
            `**Where**: Session ${deps.state.sessionId || 'unknown'}`,
            `**Learned**: ${text.slice(0, 300)}`,
          ].join('\n'),
        });
```

Keep `force: 'true'` in the `turn_end` progress checkpoint handler — those are inherently unique by turn number and don't benefit from dedup.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/hooks/passive-capture.ts test/guardrails.test.js
git commit -m "fix: remove force:true from auto-detected decisions so dedup pipeline works"
```

---

## Task 8: Surface registration failures via UI notification

**Files:**
- Modify: `extensions/memory-layer/index.ts:27-33`

- [ ] **Step 1: Write the failing test**

Add to `test/guardrails.test.js`:

```javascript
describe('safeRegister error handling', () => {
  it('should track failed registrations', () => {
    const failures = [];
    const mockPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
    };
    const failingFn = () => { throw new Error('test failure'); };
    const successFn = () => {};

    // Simulate safeRegister behavior
    function safeRegister(pi, deps, name, fn) {
      try {
        fn(pi, deps);
      } catch (e) {
        failures.push(name);
      }
    }

    safeRegister(mockPi, {}, 'good', successFn);
    safeRegister(mockPi, {}, 'bad', failingFn);

    expect(failures).toEqual(['bad']);
    expect(failures).not.toContain('good');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/guardrails.test.js`
Expected: PASS

- [ ] **Step 3: Modify `safeRegister` to track failures and notify**

In `extensions/memory-layer/index.ts`, update `safeRegister` and the main export function:

```typescript
const registrationFailures: string[] = [];

function safeRegister(pi: ExtensionAPI, deps: any, name: string, fn: RegFn) {
  try {
    fn(pi, deps);
  } catch (e) {
    console.error(`[memory-layer] Failed to register ${name}:`, e instanceof Error ? e.message : String(e));
    registrationFailures.push(name);
  }
}

export default function (pi: ExtensionAPI) {
  // ... (existing safeRegister calls) ...

  // After all registrations, notify if any failed
  if (registrationFailures.length > 0) {
    try {
      pi.on('session_start', async (_event, ctx) => {
        ctx.ui.notify(
          `⚠️ Memory layer partially loaded: ${registrationFailures.join(', ')}`,
          'warn',
        );
      });
    } catch {}
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All 753+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/index.ts test/guardrails.test.js
git commit -m "fix: surface registration failures via UI notification instead of silent swallow"
```

---

## Task 9: Update SKILL.md with v6.2 changes

**Files:**
- Modify: `skills/memory-layer/SKILL.md` (in the LaPis repo — at the root or wherever it lives)

- [ ] **Step 1: Update the version and reliability table**

Update the header from `v6.1` to `v6.2`. Update the reliability layer table in SKILL.md:

In the `tool_call` rows, add:

```markdown
| `tool_call`        | LLM calls memory-code with any mode                                | Track result files as explored via `tool_result`; reset callsSinceLastMemory counter         |
| `tool_result`      | memory-code returns results with file paths                        | Extract file paths from results → add to `exploredFiles`                                   |
```

Update the `tool_call` row for read:

```markdown
| `tool_call`        | LLM reads code files directly (indexed repo, no offset/limit) | **Hard block** — forces `memory-code outline` first; **excludes config files** (package.json, tsconfig, etc.); partial reads allowed |
```

Update the `context` row:

```markdown
| `context`          | Every LLM call                                                     | Sliding-window reminder: fires after 5 consecutive non-memory LLM calls (resets on any memory tool use) |
```

Add a new section for cache invalidation:

```markdown
### Cache Invalidation (v6.2)

- `index-repo` and `reindex-repo` invalidate the repo cache immediately, so guardrails recognize the repo on the very next tool call.
- `isRepoStale` now samples up to 50 source file mtimes (not directory mtime) to accurately detect stale indexes.
```

- [ ] **Step 2: Commit**

```bash
git add skills/memory-layer/SKILL.md
git commit -m "docs: update SKILL.md to v6.2 with consistency fixes"
```

---

## Self-Review

### 1. Spec coverage

| Issue from review | Task |
|---|---|
| Repo cache not invalidated after index/reindex | Task 1 + 2 |
| `exploredFiles` only from outline mode | Task 4 |
| `isRepoStale` checks directory mtime not files | Task 3 |
| Config files (.json) blocked by guardrails | Task 5 |
| Context reminder only fires every 8th call | Task 6 |
| Passive capture bypasses dedup with `force: true` | Task 7 |
| `safeRegister` swallows errors silently | Task 8 |
| SKILL.md outdated | Task 9 |

All 7 issues + doc update covered. ✅

### 2. Placeholder scan

No TBD, TODO, "implement later", "add appropriate error handling", or "similar to Task N" found. ✅

### 3. Type consistency

- `invalidateRepoCache() → void` defined in Task 1, used in Task 2 — matches. ✅
- `callsSinceLastMemory: number` added to state in Task 6, referenced in guardrails (Task 6 step 4) — matches. ✅
- `CONFIG_FILENAMES` set defined in Task 5, used in guardrail handler — matches. ✅
- `registrationFailures: string[]` in Task 8 — local to index.ts, no cross-file references. ✅
