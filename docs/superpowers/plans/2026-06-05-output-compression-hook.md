# Output Compression Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing token-saver module into Pi's `tool_result` hook so bash command output is automatically compressed before the LLM sees it.

**Architecture:** A new hook file (`output-compression.ts`) listens to Pi's `tool_result` event for bash tool results. When output exceeds a configurable threshold, it routes through the existing `classifyCommand` → `compressOutput` pipeline and returns modified content. A config key in `~/.pi/memory/config.jsonc` toggles the feature on/off (default: on). The hook records savings via the existing `savings-store`.

**Tech Stack:** TypeScript (extension hooks), Pi ExtensionAPI, existing token-saver module (CommonJS)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `extensions/memory-layer/hooks/output-compression.ts` | Hook: listens to `tool_result`, compresses bash output |
| Create | `test/output-compression.test.js` | Unit tests for the hook logic |
| Modify | `extensions/memory-layer/index.ts` | Register the new hook |
| Modify | `config.js` | Add `output_compression` defaults |
| Modify | `extensions/memory-layer/state.ts` | Add compression stats to state |

---

## Context: How tool_result works

From the Pi extension API, `tool_result` fires after tool execution, before the LLM sees the result. Handlers can return `{ content, details, isError }` patches:

```typescript
// BashToolResultEvent shape
interface BashToolResultEvent {
  type: "tool_result";
  toolName: "bash";
  toolCallId: string;
  input: { command: string; timeout?: number };  // BashToolInput
  content: (TextContent | ImageContent)[];        // The output
  details: BashToolDetails | undefined;           // truncation info
  isError: boolean;
}

// TextContent shape
interface TextContent { type: "text"; text: string; }
```

Our hook returns `{ content: [{ type: "text", text: compressedOutput }] }` to replace what the LLM sees.

## Context: Existing modules we reuse

- `src/token-saver/classify-command.js` → `classifyCommand(commandArgs)` → returns command type string
- `src/token-saver/compress-output.js` → `compressOutput({ commandType, commandArgs, stdout, stderr, exitCode })` → returns `{ summary, importantOutput }`
- `src/token-saver/estimate-tokens.js` → `estimateTokens(text)` → returns number
- `src/token-saver/savings-store.js` → `recordRun(run)` → writes to SQLite
- `config.js` → `getConfig()` → returns merged config with defaults

---

### Task 1: Add config defaults for output compression

**Files:**
- Modify: `config.js` (lines ~14-29, the `DEFAULTS` object)

- [ ] **Step 1: Add the failing test**

```javascript
// test/output-compression-config.test.js
const { describe, test, expect } = require('vitest');
const { resetConfigCache } = require('../config');

describe('output compression config defaults', () => {
  test('getConfig includes output_compression defaults', () => {
    // Force reload of config to pick up defaults
    resetConfigCache();
    const { getConfig } = require('../config');
    const config = getConfig();
    expect(config.output_compression).toBeDefined();
    expect(config.output_compression.enabled).toBe(true);
    expect(config.output_compression.min_chars).toBe(2000);
    expect(config.output_compression.min_savings_percent).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/output-compression-config.test.js`
Expected: FAIL — `config.output_compression` is undefined

- [ ] **Step 3: Add defaults to config.js**

In `config.js`, add `output_compression` to the `DEFAULTS` object, after `async_index_file_threshold`:

```javascript
// Add to DEFAULTS object (after async_index_file_threshold line):
  output_compression: {
    enabled: true,               // Master toggle — set false to disable auto-compression
    min_chars: 2000,             // Don't compress output shorter than this
    min_savings_percent: 30,     // Don't replace if savings < this %
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/output-compression-config.test.js`
Expected: PASS

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `npx vitest run test/config.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add config.js test/output-compression-config.test.js
git commit -m "feat(token-saver): add output_compression config defaults"
```

---

### Task 2: Add compression stats to extension state

**Files:**
- Modify: `extensions/memory-layer/state.ts` (the `state` object)

- [ ] **Step 1: Add the failing test**

```javascript
// test/output-compression-state.test.js
const { describe, test, expect } = require('vitest');

describe('output compression state', () => {
  test('state has compressionStats counters', () => {
    // Re-require to get fresh state
    delete require.cache[require.resolve('../extensions/memory-layer/state')];
    const { state } = require('../extensions/memory-layer/state');
    expect(state.compressionStats).toBeDefined();
    expect(state.compressionStats.totalRuns).toBe(0);
    expect(state.compressionStats.totalOriginalTokens).toBe(0);
    expect(state.compressionStats.totalCompressedTokens).toBe(0);
    expect(state.compressionStats.totalSavedTokens).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/output-compression-state.test.js`
Expected: FAIL — `state.compressionStats` is undefined

- [ ] **Step 3: Add compressionStats to state object**

In `extensions/memory-layer/state.ts`, find the `state` const (the mutable state object). Add a `compressionStats` field:

```typescript
  compressionStats: {
    totalRuns: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    totalSavedTokens: 0,
  },
```

Add it as a sibling to existing state fields like `lastMemoryToolCall`, `currentProject`, etc.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/output-compression-state.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/memory-layer/state.ts test/output-compression-state.test.js
git commit -m "feat(token-saver): add compressionStats to extension state"
```

---

### Task 3: Create the output-compression hook

**Files:**
- Create: `extensions/memory-layer/hooks/output-compression.ts`

This is the core integration. The hook:
1. Listens to `tool_result` for bash events
2. Extracts command + output text
3. Checks config + min threshold
4. Classifies command and compresses output
5. Only replaces content if savings exceed threshold
6. Records stats to state + SQLite

- [ ] **Step 1: Create the hook file**

```typescript
// extensions/memory-layer/hooks/output-compression.ts
// oxlint-disable sort-imports
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isBashToolResult } from '@earendil-works/pi-coding-agent';
import { state } from '../state';
import { classifyCommand } from '../../../src/token-saver/classify-command';
import { compressOutput } from '../../../src/token-saver/compress-output';
import { estimateTokens } from '../../../src/token-saver/estimate-tokens';
import { recordRun } from '../../../src/token-saver/savings-store';

interface CompressionDeps {
  state: typeof state;
  getConfig: () => { output_compression?: { enabled?: boolean; min_chars?: number; min_savings_percent?: number } };
}

const DEFAULT_MIN_CHARS = 2000;
const DEFAULT_MIN_SAVINGS_PERCENT = 30;

export function registerOutputCompression(pi: ExtensionAPI, deps: CompressionDeps) {
  pi.on('tool_result', async (event, _ctx) => {
    // Only process bash tool results
    if (!isBashToolResult(event)) {
      return;
    }

    // Check config toggle
    const config = deps.getConfig();
    const ocConfig = config.output_compression || {};
    if (ocConfig.enabled === false) {
      return;
    }

    const minChars = ocConfig.min_chars ?? DEFAULT_MIN_CHARS;
    const minSavingsPercent = ocConfig.min_savings_percent ?? DEFAULT_MIN_SAVINGS_PERCENT;

    // Extract command and output text
    const command = event.input.command as string;
    const textContent = event.content.find((c): c is { type: 'text'; text: string } => c.type === 'text');
    if (!textContent) {
      return;
    }

    const output = textContent.text;

    // Skip short output — no point compressing
    if (output.length < minChars) {
      return;
    }

    // Parse command into args for the classifier
    const commandArgs = command.trim().split(/\s+/);

    // Classify and compress
    const commandType = classifyCommand(commandArgs);
    const exitCode = event.isError ? 1 : 0;

    // Split output into stdout/stdstderr — bash tool gives combined output
    // so we pass it all as stdout with empty stderr
    const compressed = compressOutput({
      commandType,
      commandArgs,
      stdout: output,
      stderr: '',
      exitCode,
    });

    // Calculate savings
    const originalTokens = estimateTokens(output);
    const compressedTokens = estimateTokens(compressed.importantOutput);
    const savedTokens = Math.max(0, originalTokens - compressedTokens);
    const savingsPercent = originalTokens > 0
      ? Math.round((savedTokens / originalTokens) * 1000) / 10
      : 0;

    // Only replace if savings are meaningful
    if (savingsPercent < minSavingsPercent) {
      return;
    }

    // Update in-memory stats
    deps.state.compressionStats.totalRuns += 1;
    deps.state.compressionStats.totalOriginalTokens += originalTokens;
    deps.state.compressionStats.totalCompressedTokens += compressedTokens;
    deps.state.compressionStats.totalSavedTokens += savedTokens;

    // Record to SQLite (best-effort)
    try {
      recordRun({
        command,
        commandType,
        exitCode,
        originalChars: output.length,
        compressedChars: compressed.importantOutput.length,
        estimatedOriginalTokens: originalTokens,
        estimatedCompressedTokens: compressedTokens,
        estimatedSavedTokens: savedTokens,
        savingsPercent,
        summary: compressed.summary,
      });
    } catch {
      // Swallow — telemetry writes must not break tool results
    }

    // Prepend a savings note so the LLM knows output was compressed
    const prefix = `[Output compressed: ${savingsPercent}% token savings (${savedTokens} tokens saved). Summary: ${compressed.summary}]\n\n`;
    const newContent = prefix + compressed.importantOutput;

    // Return modified content
    return {
      content: [{ type: 'text' as const, text: newContent }],
    };
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit extensions/memory-layer/hooks/output-compression.ts 2>&1 || echo "TypeScript check done"`
Expected: No errors (or only import resolution warnings for CommonJS requires from TS)

Actually, since this is a jiti-loaded extension, strict compilation isn't required, but let's make sure the imports resolve. The key concern is the CommonJS require from TypeScript — jiti handles this at runtime.

- [ ] **Step 3: Commit**

```bash
git add extensions/memory-layer/hooks/output-compression.ts
git commit -m "feat(token-saver): create output-compression hook for tool_result"
```

---

### Task 4: Write unit tests for the hook

**Files:**
- Create: `test/output-compression.test.js`

The tests simulate `tool_result` events by calling the hook's event handler directly through a mock `pi.on` registration.

- [ ] **Step 1: Write comprehensive tests**

```javascript
// test/output-compression.test.js
const { describe, test, expect, vi, beforeEach } = require('vitest');

// Mock the token-saver modules
vi.mock('../../src/token-saver/classify-command', () => ({
  classifyCommand: vi.fn((args) => {
    const cmd = args.join(' ');
    if (cmd.startsWith('npm test')) return 'test';
    if (cmd.startsWith('git diff')) return 'git-diff';
    if (cmd.startsWith('npm install')) return 'install';
    if (cmd.startsWith('cat ')) return 'file-read';
    if (cmd.startsWith('ls ')) return 'list';
    if (cmd.startsWith('grep ')) return 'search';
    return 'generic';
  }),
}));

vi.mock('../../src/token-saver/compress-output', () => ({
  compressOutput: vi.fn(({ stdout }) => ({
    summary: 'Compressed output',
    importantOutput: 'COMPRESSED: ' + stdout.slice(0, 100),
  })),
}));

vi.mock('../../src/token-saver/estimate-tokens', () => ({
  estimateTokens: vi.fn((text) => Math.ceil(String(text || '').length / 4)),
}));

vi.mock('../../src/token-saver/savings-store', () => ({
  recordRun: vi.fn(),
}));

// Must import after mocks
const { registerOutputCompression } = require('../extensions/memory-layer/hooks/output-compression');
const { classifyCommand } = require('../src/token-saver/classify-command');
const { compressOutput } = require('../src/token-saver/compress-output');
const { recordRun } = require('../src/token-saver/savings-store');

function createMockPi() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    getHandler: (event) => handlers[event],
  };
}

function createMockState() {
  return {
    compressionStats: {
      totalRuns: 0,
      totalOriginalTokens: 0,
      totalCompressedTokens: 0,
      totalSavedTokens: 0,
    },
  };
}

function createBashResultEvent(command, output, isError = false) {
  return {
    type: 'tool_result',
    toolName: 'bash',
    toolCallId: 'test-call-1',
    input: { command },
    content: [{ type: 'text', text: output }],
    details: undefined,
    isError,
  };
}

function createNonBashResultEvent() {
  return {
    type: 'tool_result',
    toolName: 'read',
    toolCallId: 'test-call-2',
    input: { path: '/some/file.ts' },
    content: [{ type: 'text', text: 'file contents here' }],
    details: undefined,
    isError: false,
  };
}

describe('registerOutputCompression', () => {
  let mockPi;
  let mockState;
  let mockGetConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = createMockPi();
    mockState = createMockState();
    mockGetConfig = () => ({
      output_compression: { enabled: true, min_chars: 2000, min_savings_percent: 30 },
    });
  });

  test('registers a tool_result handler', () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    expect(mockPi.on).toHaveBeenCalledWith('tool_result', expect.any(Function));
  });

  test('ignores non-bash tool results', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const result = await handler(createNonBashResultEvent(), {});
    expect(result).toBeUndefined();
    expect(classifyCommand).not.toHaveBeenCalled();
  });

  test('ignores short output (below min_chars)', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const event = createBashResultEvent('echo hello', 'short output');
    const result = await handler(event, {});
    expect(result).toBeUndefined();
  });

  test('compresses large bash output', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('npm test', largeOutput);
    const result = await handler(event, {});

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('[Output compressed:');
    expect(result.content[0].text).toContain('COMPRESSED:');
    expect(classifyCommand).toHaveBeenCalledWith(['npm', 'test']);
    expect(compressOutput).toHaveBeenCalled();
  });

  test('does not compress when config.enabled is false', async () => {
    mockGetConfig = () => ({
      output_compression: { enabled: false, min_chars: 2000, min_savings_percent: 30 },
    });
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('npm test', largeOutput);
    const result = await handler(event, {});

    expect(result).toBeUndefined();
  });

  test('updates compressionStats after compression', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('npm test', largeOutput);
    await handler(event, {});

    expect(mockState.compressionStats.totalRuns).toBe(1);
    expect(mockState.compressionStats.totalOriginalTokens).toBeGreaterThan(0);
    expect(mockState.compressionStats.totalSavedTokens).toBeGreaterThan(0);
  });

  test('records run to SQLite via recordRun', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('npm test', largeOutput);
    await handler(event, {});

    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npm test',
        commandType: 'test',
        savingsPercent: expect.any(Number),
      }),
    );
  });

  test('handles missing text content gracefully', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const event = {
      type: 'tool_result',
      toolName: 'bash',
      toolCallId: 'test',
      input: { command: 'npm test' },
      content: [{ type: 'image', data: 'base64...' }],
      details: undefined,
      isError: false,
    };
    const result = await handler(event, {});
    expect(result).toBeUndefined();
  });

  test('handles recordRun throwing without breaking', async () => {
    recordRun.mockImplementation(() => { throw new Error('DB locked'); });
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('npm test', largeOutput);
    // Should NOT throw
    const result = await handler(event, {});
    expect(result).toBeDefined();
    expect(result.content[0].text).toContain('COMPRESSED:');
  });

  test('works with default config when output_compression is missing', async () => {
    mockGetConfig = () => ({});
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'x'.repeat(5000);
    const event = createBashResultEvent('git diff', largeOutput);
    const result = await handler(event, {});
    expect(result).toBeDefined();
  });

  test('handles isError = true (non-zero exit code)', async () => {
    registerOutputCompression(mockPi, { state: mockState, getConfig: mockGetConfig });
    const handler = mockPi.getHandler('tool_result');
    const largeOutput = 'FAIL '.repeat(2000);
    const event = createBashResultEvent('npm test', largeOutput, true);
    const result = await handler(event, {});
    expect(result).toBeDefined();
    expect(compressOutput).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 1 }),
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run test/output-compression.test.js`
Expected: All 10 tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/output-compression.test.js
git commit -m "test(token-saver): add output-compression hook unit tests"
```

---

### Task 5: Register the hook in the extension entry point

**Files:**
- Modify: `extensions/memory-layer/index.ts`

- [ ] **Step 1: Add import and registration**

At the top of `extensions/memory-layer/index.ts`, add the import alongside existing imports:

```typescript
import { registerOutputCompression } from './hooks/output-compression';
```

Find the `getConfig` function — it's already used in the extension but imported from `../../config`. Add `getConfig` to the deps object if not already there, or import it directly.

In the `memoryLayer` function, add a registration call after the existing `safeRegister` calls:

```typescript
  safeRegister(pi, deps, 'output-compression hook', (pi, deps) => {
    const { getConfig } = require('../../config');
    registerOutputCompression(pi, { state: deps.state, getConfig });
  });
```

Note: We wrap in a lambda because `getConfig` isn't part of the existing `deps` object and we don't want to change the deps interface just for this. The `require` is lazy — jiti handles the resolution.

- [ ] **Step 2: Verify the extension loads without errors**

Run: `node -e "require('./extensions/memory-layer/index')" 2>&1`
Expected: No import/require errors (the extension factory itself won't run without a Pi ExtensionAPI, but the module should load cleanly)

Actually, the extension exports a function and doesn't execute on require, so this is safe. Let's verify:

Run: `node -e "const m = require('./extensions/memory-layer/index'); console.log('Module loaded:', typeof m.default)" 2>&1`
Expected: `Module loaded: function`

- [ ] **Step 3: Commit**

```bash
git add extensions/memory-layer/index.ts
git commit -m "feat(token-saver): register output-compression hook in memory-layer extension"
```

---

### Task 6: Run full test suite for regression check

**Files:**
- None (verification only)

- [ ] **Step 1: Run all token-saver tests**

Run: `npx vitest run test/token-saver --reporter=verbose`
Expected: All 42 tests PASS

- [ ] **Step 2: Run all output-compression tests**

Run: `npx vitest run test/output-compression --reporter=verbose`
Expected: All 10+ tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS, no regressions

- [ ] **Step 4: Run existing tool-guardrails tests**

Run: `npx vitest run test/tool-guardrails.test.js`
Expected: PASS — guardrails unaffected

---

### Task 7: Manual integration test with live Pi

This task verifies the hook works in a real Pi session. Not automatable via unit tests.

- [ ] **Step 1: Verify the hook loads in Pi**

Start a Pi session and check for startup errors:
```bash
pi
```
Then type any message. If no error notifications appear about `output-compression`, the hook registered successfully.

- [ ] **Step 2: Test with a large-output command**

Ask Pi to run a command that produces large output:
```
Run `npm test` and show me the results
```
The LLM should see compressed output with a `[Output compressed: ...%]` prefix.

- [ ] **Step 3: Test with a short-output command**

Ask Pi to run:
```
Run `echo hello`
```
Short output should NOT be compressed (below 2000 char threshold).

- [ ] **Step 4: Test with config disabled**

Add to `~/.pi/memory/config.jsonc`:
```jsonc
{
  "output_compression": {
    "enabled": false
  }
}
```
Then ask Pi to run `npm test` again. Output should NOT be compressed. Remove the config after testing.

- [ ] **Step 5: Verify stats are recorded**

Run:
```bash
lapis token-saver-stats
```
Should show runs with token savings data.

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|-------------|------|
| Hook into `tool_result` for bash | Task 3 |
| Check config toggle | Task 3 (checks `output_compression.enabled`) |
| Skip short output | Task 3 (`min_chars` threshold) |
| Only compress if meaningful savings | Task 3 (`min_savings_percent` threshold) |
| Route through existing compressors | Task 3 (reuses `classifyCommand` + `compressOutput`) |
| Record to SQLite | Task 3 (reuses `recordRun`) |
| Update in-memory stats | Task 3 (updates `state.compressionStats`) |
| Config defaults | Task 1 |
| Unit tests | Task 4 |
| Register in extension | Task 5 |
| No regressions | Task 6 |
| Manual smoke test | Task 7 |

### 2. Placeholder Scan

No TBD, TODO, or placeholder patterns found.

### 3. Type Consistency

- `classifyCommand(commandArgs: string[])` → returns `string` — matches usage in Task 3
- `compressOutput({ commandType, commandArgs, stdout, stderr, exitCode })` → returns `{ summary: string, importantOutput: string }` — matches usage in Task 3
- `estimateTokens(text: string)` → returns `number` — matches usage in Task 3
- `recordRun(run)` → run shape matches what we construct in Task 3
- `isBashToolResult(event)` → narrows to `BashToolResultEvent` with `input.command: string` and `content` — matches usage
- `state.compressionStats` shape matches between Task 2 (state.ts) and Task 3 (hook)
- Config key `output_compression` matches between Task 1 (config.js DEFAULTS) and Task 3 (hook reads it)
