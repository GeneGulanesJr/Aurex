# Fix Context Injection Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the rich context injection format that embeds prompt-matched memory content inline, while keeping the `getSettings().contextLimit` override and other improvements added since the lean refactor.

**Architecture:** Revert the message-body construction in `context-injection.ts` from the lean one-line format back to the structured `## Memory Context (auto-loaded)` format with `### Prompt-Matched Memory` sections. Keep the `getSettings().contextLimit` feature and the `isHistoricalMemoryPrompt`/`isSourceAuthoritativePrompt` helpers. Restore the `summarizeMemoryContent` and `appendExtensionHint` helper functions that were deleted. Update all tests to match the restored format.

**Tech Stack:** TypeScript, Vitest, Pi extension hooks

---

## Files Involved

| File | Action | Responsibility |
|------|--------|---------------|
| `extensions/memory-layer/hooks/context-injection.ts` | Modify | Main context injection hook — restore rich format, keep `getSettings` support |
| `test/context-injection-prompt.test.js` | Modify | Tests for prompt extraction and context format — update to match rich format |
| `test/context-injection.test.js` | Rewrite | Tests for `buildLeanContext` → change to test the new rich `buildRichContext` helper |
| `test/context-limit-override.test.js` | No change | Already working with `getSettings` override |
| `constants.js` | Modify | Add `PROMPT_MEMORY_SNIPPET_LENGTH: 280` to `CONTEXT` |

---

### Task 1: Add missing constant to `constants.js`

**Files:**
- Modify: `constants.js:128` (inside `CONTEXT` object, before `STALE_GUIDANCE`)

- [ ] **Step 1: Add `PROMPT_MEMORY_SNIPPET_LENGTH` to the CONTEXT object**

Add this line after `MIN_OBSERVATION_TRUST: 0.8,` and before `STALE_GUIDANCE:`:

```js
  PROMPT_MEMORY_SNIPPET_LENGTH: 280,
```

- [ ] **Step 2: Verify the constant is importable**

Run: `node -e "const {CONTEXT} = require('./constants'); console.log(CONTEXT.PROMPT_MEMORY_SNIPPET_LENGTH)"`
Expected: `280`

- [ ] **Step 3: Commit**

```bash
git add constants.js
git commit -m "chore: add PROMPT_MEMORY_SNIPPET_LENGTH constant for context injection"
```

---

### Task 2: Restore rich context injection in `context-injection.ts`

This is the core fix. The message body construction needs to go from the lean one-line format back to the structured rich format, while keeping the `getSettings` override for `contextLimit`.

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts`

- [ ] **Step 1: Add `summarizeMemoryContent` helper function**

Add this function before the `contentToText` function (it was removed in the lean refactor):

```typescript
function summarizeMemoryContent(content: unknown): string | null {
  if (typeof content !== 'string') {
    return null;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const priority = lines.filter((line) => /^\*\*(What|Why|Where)\*\*:/i.test(line));
  const selected = (priority.length > 0 ? priority : lines).slice(0, 3);
  if (selected.length === 0) {
    return null;
  }

  const normalized = selected
    .join(' ')
    .replace(/\*\*(What|Why|Where)\*\*:\s*/gi, '$1: ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return null;
  }

  const limit = CONTEXT.PROMPT_MEMORY_SNIPPET_LENGTH || 280;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
```

- [ ] **Step 2: Add `appendExtensionHint` helper function**

Add this function before the `registerContextReminder` function:

```typescript
function appendExtensionHint(lines: string[], cwd: string) {
  const extensionDir = path.join(cwd, 'extensions', 'memory-layer');
  try {
    const extStat = fs.statSync(extensionDir);
    if (extStat.isDirectory()) {
      lines.push('');
      lines.push('📂 Extension source: `extensions/memory-layer/` in this project repo.');
    }
  } catch {
    // No local extension dir — skip hint
  }
}
```

- [ ] **Step 3: Replace the lean message-body construction with the rich format**

Delete the exact block from line `const projectDir = cwdRepo?.path || ctx.cwd;` through (and including) the line `    };` that closes the `return { message: { ... } }` statement — this is the `};` right before the `});` that closes `pi.on`. Do NOT delete the `});` on the next line (that closes `pi.on`) or the `}` after it (that closes `registerBeforeAgentStart`).

In other words: delete from `const projectDir` through the `};` of the return, keeping the existing `});` and `}` closings intact.

Then insert the rich format in its place. The replacement must include:
1. `const topic` extraction
2. `const projectDir` and `const projectSummary` (re-declared in the replacement)
3. The full lines-building logic with rich format sections
4. The `return { message: ... }` and closing `};`

The exact code to insert:

```typescript
    const topic = effectiveContext.topic as string | null;

    const topicNote = topic ? ` | topic: ${topic}` : '';
    const lines: string[] = ['## Memory Context (auto-loaded)', ''];
    const projectDir = cwdRepo?.path || ctx.cwd;
    const projectSummary = getProjectSummary(projectDir);

    if (isNewProject) {
      lines.push(
        `Project: **${deps.state.currentProject}** | new project | ${effectiveStats?.total_memories || 0} total memories across all projects`,
      );
      lines.push('');
    } else {
      lines.push(
        `Project: **${deps.state.currentProject}** | ${effectiveStats?.total_memories || 0} memories | ${effectiveStats?.total_personal || 0} personal preferences${topicNote}`,
      );
      lines.push('');
    }

    lines.push('### Project Context');
    lines.push(`- Directory: \`${projectDir}\``);
    lines.push(`- Summary: ${projectSummary}`);
    if (cwdRepo) {
      const staleLabel = isStale ? ' (stale)' : '';
      lines.push(
        `- Code index: \`${cwdRepo.name}\` with ${cwdRepo.file_count} files / ${cwdRepo.symbol_count} symbols${staleLabel}`,
      );
    } else {
      lines.push(`- Code index: not indexed for this project`);
    }
    if ((effectiveStats?.active_workflows || 0) > 0) {
      lines.push(`- Active workflows: ${effectiveStats.active_workflows}`);
    }
    lines.push('');

    if (effectiveObservations.length > 0) {
      lines.push('### Prompt-Matched Memory');
      for (const o of effectiveObservations.slice(0, CONTEXT.PROMPT_INJECT_LIMIT)) {
        let trust = '';
        if (o.trust_score < 0.5) {
          trust = ' ⚠️';
        } else if (o.trust_score < 0.8) {
          trust = ' 🔎';
        }
        lines.push(`- [${o.type}] ${o.title}${trust}`);
        const snippet = summarizeMemoryContent(o.content);
        if (snippet) {
          lines.push(`  ${snippet}`);
        }
      }
      lines.push('');
    }

    if (promptQuery && personal.length > 0) {
      lines.push('### Personal Preferences');
      for (const p of personal.slice(0, CONTEXT.PERSONAL_INJECT_LIMIT)) {
        lines.push(`- ${p.title}`);
      }
      lines.push('');
    }

    lines.push('Use `memory-search` for deeper recall and `memory-save` for durable decisions.');

    if (!cwdRepo) {
      lines.push('');
      lines.push(
        `⚠️ **Code not indexed:** Project "${deps.state.currentProject}" has no code index yet. Run \`memory-code index-repo --path ${ctx.cwd} --name ${deps.state.currentProject}\` to enable memory-code analysis.`,
      );
    } else if (isStale && !isHistoricalMemoryPrompt(promptQuery)) {
      lines.push('');
      lines.push(CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo.name));
    }

    appendExtensionHint(lines, ctx.cwd);

    return {
      message: {
        customType: 'memory-context',
        content: lines.join('\n'),
        display: false,
      },
    };
```

**Key differences from the lean format:**
1. Uses `## Memory Context (auto-loaded)` heading
2. Shows `### Project Context` with directory, summary, and code index status
3. Shows `### Prompt-Matched Memory` with **inline content snippets** (What/Why/Where) — this is the critical missing piece that caused the regression
4. Shows `### Personal Preferences` when applicable
5. Stale warning is **suppressed for historical prompts** via `isHistoricalMemoryPrompt` check
6. Stale label in `### Project Context` is `(stale)` — informational, not a call to action

- [ ] **Step 4: Restore `personal` extraction from effectiveContext**

The lean format removed the `personal` array extraction. Add it back after the `observations` extraction block (after the `|| [];` closing of observations):

```typescript
    const personal =
      (effectiveContext.personal as Array<{
        id: number;
        title: string;
        type: string;
      }>) || [];
```

Note: `content?: string` is already present in the observations type — no change needed there.

- [ ] **Step 5: Skip — `topic` is already extracted in Step 3**

The replacement block in Step 3 includes `const topic = effectiveContext.topic as string | null;` as its first line. No separate addition needed. Do NOT add a duplicate `const topic` line.

- [ ] **Step 6: Run existing tests to check for compile/import errors**

Run: `npx vitest run test/context-injection-prompt.test.js test/context-limit-override.test.js`
Expected: May have failures due to changed output format — that's OK, we fix tests in Task 3.

- [ ] **Step 7: Commit**

```bash
git add extensions/memory-layer/hooks/context-injection.ts
git commit -m "fix: restore rich context injection with inline memory content

The lean format (commit 3d385d7a) removed inline memory content and
showed a stale warning unconditionally, causing the agent to distrust
memory and fall back to manual bash searches. Benchmark regression:
- active tokens 3,192 → 30,118 (+843%)
- elapsed 85s → 297s (+247%)
- tool calls 6 → 44 (+633%)

Rich format restores:
- ### Prompt-Matched Memory with inline What/Why/Where content
- ### Project Context with code index status
- Stale warning suppressed for historical memory prompts
- summarizeMemoryContent helper for content snippets
- appendExtensionHint helper for local extension source

Keeps the getSettings().contextLimit override added after the lean refactor."
```

---

### Task 3: Update `test/context-injection-prompt.test.js` to match rich format

**Files:**
- Modify: `test/context-injection-prompt.test.js`

- [ ] **Step 1: Update "promptless startup injects project summary" test**

The test currently checks for lean format. Update assertions to match the rich format:

```javascript
    expect(deps.mem).toHaveBeenCalledWith(
      'context',
      expect.objectContaining({ project: 'PiMemoryExtension', limit: '1' }),
    );
    // Rich format: structured sections with Project Context
    expect(content).toContain('## Memory Context (auto-loaded)');
    expect(content).toContain('### Project Context');
    expect(content).toContain('Code index: `PiMemoryExtension`');
    expect(content).not.toContain('Noisy prior decision');
    expect(content).not.toContain('Personal preference');
```

- [ ] **Step 2: Update "prompt-matched startup caps injected memories" test**

```javascript
    expect(deps.mem).toHaveBeenCalledWith(
      'context',
      expect.objectContaining({ project: 'PiMemoryExtension', limit: '5', query: 'benchmark memory context' }),
    );
    // Rich format: ### Prompt-Matched Memory with inline content
    expect(content).toContain('### Prompt-Matched Memory');
    // PROMPT_INJECT_LIMIT = 1, so only first observation is included
    expect(content).toContain('Matched decision 1');
    expect(content).toContain('What: Use SQLite FTS5 Why: Avoid external search services Where: src/search.js');
    // Second and third observations are beyond PROMPT_INJECT_LIMIT
    expect(content).not.toContain('Matched bugfix 2');
    expect(content).not.toContain('Matched pattern 3');
    expect(content).not.toContain('Should not be injected');
```

- [ ] **Step 3: Update "historical prompt suppresses stale code verification warning" test**

```javascript
    // Historical prompt: stale warning suppressed, code index still shown
    expect(content).toContain('Code index: `PiMemoryExtension`');
    expect(content).not.toContain('Stale code index');
    expect(content).toContain('Why: Avoid external services Where: src/memory-domain/search.js');
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/context-injection-prompt.test.js`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/context-injection-prompt.test.js
git commit -m "test: update context-injection-prompt tests for restored rich format"
```

---

### Task 4: Rewrite `test/context-injection.test.js` for rich format

The existing test file tests a `buildLeanContext` function that no longer exists. It needs to test the equivalent rich format behavior.

**Files:**
- Modify: `test/context-injection.test.js`

- [ ] **Step 1: Replace the entire test file**

The tests should verify the rich format output through the `registerBeforeAgentStart` hook (same pattern as `context-injection-prompt.test.js`). Here's the replacement:

```javascript
import { registerBeforeAgentStart } from '../extensions/memory-layer/hooks/context-injection.ts';

/**
 * Extract the handler registered by registerBeforeAgentStart
 */
function extractHandler(deps) {
  let handler;
  const pi = {
    on: vi.fn((_eventName, callback) => {
      handler = callback;
    }),
  };
  registerBeforeAgentStart(pi, deps);
  return handler;
}

function buildDeps(overrides = {}) {
  return {
    state: { currentProject: 'TestProject', hasInjectedContext: false, sessionId: 1 },
    mem: vi.fn().mockResolvedValue({
      observations: [],
      personal: [],
      stats: { total_memories: 42, total_personal: 1, active_workflows: 0 },
      topic: null,
    }),
    getKnownRepos: vi.fn().mockResolvedValue([]),
    isRepoStale: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('rich context injection', () => {
  test('produces structured format with Memory Context heading', async () => {
    const deps = buildDeps();
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('## Memory Context (auto-loaded)');
    expect(content).toContain('### Project Context');
    expect(content).toContain('Project: **TestProject**');
  });

  test('includes project summary from package.json', async () => {
    const deps = buildDeps();
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    // LaPis package.json has a description
    expect(content).toContain('LaPis');
  });

  test('includes code index details when repo is known', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-29T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(false),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('Code index: `TestRepo`');
    expect(content).toContain('100 files');
    expect(content).toContain('500 symbols');
  });

  test('shows stale label when index is stale', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('(stale)');
  });

  test('injects prompt-matched memory with inline content', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'decision',
            title: 'Use SQLite FTS5',
            trust_score: 0.95,
            content: '**What**: Use FTS5\n**Why**: No external deps\n**Where**: search.js',
          },
        ],
        personal: [],
        stats: { total_memories: 10, total_personal: 0, active_workflows: 0 },
        topic: 'fts5',
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'why fts5' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('### Prompt-Matched Memory');
    expect(content).toContain('[decision] Use SQLite FTS5');
    expect(content).toContain('What: Use FTS5 Why: No external deps Where: search.js');
  });

  test('suppresses stale warning for historical prompts', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'architecture',
            title: 'FTS5 rationale',
            trust_score: 0.95,
            content: '**Why**: Performance',
          },
        ],
        personal: [],
        stats: { total_memories: 10, total_personal: 0, active_workflows: 0 },
        topic: 'fts5',
      }),
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'Why did we choose SQLite?' }, { cwd: process.cwd() });
    const content = result.message.content;

    // (stale) label is shown in Project Context, but STALE_GUIDANCE block is suppressed
    expect(content).toContain('(stale)');
    expect(content).not.toContain('Stale code index');
    expect(content).not.toContain('reindex');
  });

  test('shows stale guidance block for non-historical prompts', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'refactor the context module' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('Stale code index');
    expect(content).toContain('reindex');
  });

  test('new project format shows cross-project context', async () => {
    const callCount = { n: 0 };
    const deps = buildDeps({
      mem: vi.fn().mockImplementation(() => {
        callCount.n++;
        // First call (project-specific) returns null → triggers cross-project
        if (callCount.n === 1) {
          return null;
        }
        return {
          observations: [],
          personal: [],
          stats: { total_memories: 5, total_personal: 0, active_workflows: 0 },
          topic: null,
        };
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('new project');
  });

  test('personal preferences are not injected when PERSONAL_INJECT_LIMIT is 0', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [],
        personal: [{ id: 1, title: 'Use tabs not spaces', type: 'preference' }],
        stats: { total_memories: 10, total_personal: 1, active_workflows: 0 },
        topic: null,
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'format code' }, { cwd: process.cwd() });
    const content = result.message.content;

    // PERSONAL_INJECT_LIMIT = 0, so no personal section appears
    expect(content).not.toContain('### Personal Preferences');
    expect(content).not.toContain('Use tabs not spaces');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run test/context-injection.test.js`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/context-injection.test.js
git commit -m "test: rewrite context-injection tests for restored rich format"
```

---

### Task 5: Run full test suite and verify no regressions

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All 979+ tests pass, 0 failures.

- [ ] **Step 2: Run lint and format check**

Run: `npm run check`
Expected: 0 errors, formatting clean.

- [ ] **Step 3: Reindex repo**

Run: `memory-code reindex-repo --repo PiMemoryExtension`
Expected: Successful reindex.

- [ ] **Step 4: Final commit if any formatting fixes needed**

```bash
git add -A
git commit -m "chore: formatting fixes from context injection restore"
```

---

## Self-Review

### Spec coverage
| Requirement | Task |
|-------------|------|
| Restore `### Prompt-Matched Memory` with inline content | Task 2 (Step 3) |
| Restore `### Project Context` with code index status | Task 2 (Step 3) |
| Suppress stale warning for historical prompts | Task 2 (Step 3) |
| Keep `getSettings().contextLimit` override | Task 2 (preserved) |
| Keep `isSourceAuthoritativePrompt` bypass | Task 2 (preserved) |
| Restore `summarizeMemoryContent` helper | Task 2 (Step 1) |
| Restore `appendExtensionHint` helper | Task 2 (Step 2) |
| Add `PROMPT_MEMORY_SNIPPET_LENGTH` constant | Task 1 |
| Update tests to match rich format | Tasks 3, 4 |

### Placeholder scan
No TBD, TODO, or "implement later" patterns. All steps contain actual code.

### Type consistency
- `observations` array type includes `content?: string` (needed by `summarizeMemoryContent`)
- `personal` array type matches old format usage
- `topic` extracted as `string | null` — consistent with usage in template literal
- `PROMPT_MEMORY_SNIPPET_LENGTH` referenced in `summarizeMemoryContent` matches the constant added in Task 1
