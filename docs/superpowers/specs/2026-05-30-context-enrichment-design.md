# Context Injection Enrichment — File Paths + Bumped Inject Limit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three improvements to the `before_agent_start` context injection:
1. Bump `PROMPT_INJECT_LIMIT` from 1 to 3 as the maximum prompt-matched injection limit.
2. Apply that maximum adaptively: navigation/location prompts can receive up to 3 memories; policy/advice prompts stay at 1.
3. For navigation/location prompts only, extract file paths from injected memory content and append them as a compact `Related:` line.

**Motivation:** Benchmark (`bench:pi-paired`) showed `decision-fts5-no-external-service` scoring 2/3 facts — missing the file path `src/memory-domain/search.js` that existed in memory #7075 but wasn't injected because only the top-1 memory was surfaced. The LLM answered from context alone and never searched the code.

**Architecture:** Pure extension-layer change. No CLI, no DB schema, no new modules. The `registerBeforeAgentStart` function in `context-injection.ts` classifies prompts as navigation/location vs policy/advice. Navigation/location prompts use the configured maximum (`PROMPT_INJECT_LIMIT: 3`) and receive `Related:` path hints. Policy/advice prompts use a compact limit of 1 and omit `Related:` path hints to avoid code-browsing rabbit holes.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `constants.js` | Modify | Bump `PROMPT_INJECT_LIMIT` from 1 to 3 |
| `extensions/memory-layer/hooks/context-injection.ts` | Modify | Extract file paths from injected memory content, append `Related:` line |
| `test/context-injection.test.js` | Modify | Tests for file path extraction and enrichment |

---

## Task 1: Bump PROMPT_INJECT_LIMIT

**Files:**
- Modify: `constants.js` — `CONTEXT.PROMPT_INJECT_LIMIT`

- [ ] **Step 1: Change the constant**

In `constants.js`, change:
```javascript
PROMPT_INJECT_LIMIT: 1,
```
to:
```javascript
PROMPT_INJECT_LIMIT: 3,
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All 978 tests PASS (the constant is only consumed by `context-injection.ts` which already slices the array)

- [ ] **Step 3: Commit**

```bash
git add constants.js
git commit -m "feat: bump PROMPT_INJECT_LIMIT from 1 to 3 for richer context injection"
```

---

## Task 2: Extract file paths from memory content and append to injection

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts` — the `effectiveObservations` rendering loop

**Design details:**

The extraction logic:

```typescript
function extractFilePaths(content: string): string[] {
  if (!content || typeof content !== 'string') return [];

  // Match paths like src/foo.js, lib/bar.ts, extensions/baz.ts, commands/qux.js
  // Also match Markdown code-backtick paths like `src/foo.js`
  const pathRe = /(?:^|\s|`)([\w/.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|py|go|rs|sql))(?:`|\s|,|\.|$)/gm;
  const matches: string[] = [];
  let match;
  while ((match = pathRe.exec(content)) !== null) {
    const p = match[1];
    // Filter out obvious non-file-paths (too short, no slash, etc.)
    if (p.includes('/') && p.length > 5) {
      matches.push(p);
    }
  }
  // Deduplicate, max 3
  return [...new Set(matches)].slice(0, 3);
}
```

The rendering change — after the existing snippet line in the `effectiveObservations` loop, add:

```typescript
        const filePaths = extractFilePaths(o.content || '');
        if (filePaths.length > 0) {
          lines.push(`  Related: ${filePaths.map(p => '`' + p + '`').join(', ')}`);
        }
```

This appends a `Related:` line only when file paths are found in the memory's content. The paths come from the memory's `**Where**:` field or inline mentions.

No code-index lookup needed — the paths in memory content are already verified (they were written when the memory was created). We surface them compactly only when the prompt asks for navigation/location information.

- [ ] **Step 1: Write the failing test**

Add to `test/context-injection.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

describe('extractFilePaths', () => {
  it('should extract file paths from memory content', async () => {
    const { extractFilePaths } = await import('../extensions/memory-layer/hooks/context-injection');
    const content = '**What**: Search module\n**Why**: FTS5\n**Where**: src/memory-domain/search.js handles FTS5 queries';
    const paths = extractFilePaths(content);
    expect(paths).toContain('src/memory-domain/search.js');
  });

  it('should extract multiple paths and deduplicate', async () => {
    const { extractFilePaths } = await import('../extensions/memory-layer/hooks/context-injection');
    const content = '**Where**: src/memory-domain/search.js and src/memory-domain/context.js also uses src/memory-domain/search.js';
    const paths = extractFilePaths(content);
    expect(paths).toEqual(['src/memory-domain/search.js', 'src/memory-domain/context.js']);
  });

  it('should limit to 3 paths', async () => {
    const { extractFilePaths } = await import('../extensions/memory-layer/hooks/context-injection');
    const content = 'src/a.js src/b.js src/c.js src/d.js src/e.js';
    const paths = extractFilePaths(content);
    expect(paths.length).toBe(3);
  });

  it('should return empty array for content without paths', async () => {
    const { extractFilePaths } = await import('../extensions/memory-layer/hooks/context-injection');
    const paths = extractFilePaths('No file paths here, just a decision about architecture.');
    expect(paths).toEqual([]);
  });

  it('should ignore short strings without slashes', async () => {
    const { extractFilePaths } = await import('../extensions/memory-layer/hooks/context-injection');
    const paths = extractFilePaths('Used test.js in the project');
    expect(paths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/context-injection.test.js`
Expected: FAIL — `extractFilePaths` is not exported

- [ ] **Step 3: Implement `extractFilePaths` and wire into rendering**

In `extensions/memory-layer/hooks/context-injection.ts`:

1. Add `extractFilePaths` as an exported function at the bottom of the file.
2. In the `effectiveObservations` rendering loop, after the `snippet` line, add the `Related:` line.
3. Export the function for testing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/context-injection.test.js`
Expected: All PASS

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All 978+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/memory-layer/hooks/context-injection.ts test/context-injection.test.js
git commit -m "feat: enrich injected memories with Related file paths from content"
```

---

## Self-Review

### 1. Spec coverage

| Issue | Task |
|---|---|
| Only 1 memory injected, missing complementary facts | Task 1 (bump limit) |
| Injected memory lacks file paths that exist in content | Task 2 (extract + append) |

All issues covered. ✅

### 2. Placeholder scan

No TBD, TODO, "implement later", or "similar to" found. ✅

### 3. Type consistency

- `extractFilePaths(content: string): string[]` defined and exported in Task 2. ✅
- `PROMPT_INJECT_LIMIT: 3` used by existing `slice()` call in context-injection.ts. ✅
