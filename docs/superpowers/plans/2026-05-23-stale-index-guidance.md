# Make Stale-Index Guidance Deterministic and Cheap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** staleness-code-index remains 3/3 memory-on while active tokens drop from ~21,576 to near memory-off levels (~4,894).

**Architecture:** Two changes: (1) Add a token budget to context-injection that caps total output at ~500 characters when only a stale warning is needed. (2) Replace the verbose stale warning with the deterministic 3-line guidance from the issue spec.

**Tech Stack:** TypeScript, Node.js

---

## Root Cause Analysis

The `before_agent_start` hook injects the FULL memory context every session:
- Project header line
- "Recent Relevant Memory" section (up to 10 observations)
- Personal preferences (up to 5)
- Stale index warning (verbose, ~200 chars)

For the staleness task, the LLM only needs the stale warning — the 10 observations and personal preferences are noise. The benchmark shows 21,576 tokens because all this context is injected even though the prompt is about stale indexes.

The stale-index question can be answered from the system prompt + the injected stale warning alone. The memories aren't needed.

---

### Task 1: Add compact stale-only context path

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts`
- Create: `test/stale-guidance.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/stale-guidance.test.js
const { CONTEXT, RANKING } = require('../constants');

describe('Stale index guidance', () => {
  test('CONTEXT has STALE_GUIDANCE compact text', () => {
    expect(CONTEXT.STALE_GUIDANCE).toBeDefined();
    expect(typeof CONTEXT.STALE_GUIDANCE).toBe('string');
    expect(CONTEXT.STALE_GUIDANCE).toContain('reindex-repo');
    expect(CONTEXT.STALE_GUIDANCE.length).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/stale-guidance.test.js --no-coverage 2>&1`
Expected: FAIL — `CONTEXT.STALE_GUIDANCE` is undefined

- [ ] **Step 3: Add STALE_GUIDANCE constant**

In `constants.js`, add to the `CONTEXT` object:

```javascript
  STALE_GUIDANCE: '📝 **Stale code index:** indexed code may not match current source files. Run `memory-code reindex-repo --repo {repo}` to update. Verify current source before relying on code-index results.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/stale-guidance.test.js --no-coverage 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

---

### Task 2: Use compact stale guidance in context-injection

**Files:**
- Modify: `extensions/memory-layer/hooks/context-injection.ts`

- [ ] **Step 1: Replace verbose stale warning with compact guidance**

In `context-injection.ts`, replace the verbose stale warning:

```typescript
    } else if (deps.isRepoStale(cwdRepo)) {
      lines.push('');
      lines.push(CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo.name));
    }
```

This replaces the ~200-char verbose message with the ~180-char deterministic guidance.

- [ ] **Step 2: Verify the output is shorter**

The stale warning drops from ~250 chars to ~180 chars. Combined with the context limit of 10 (already reduced from 15 in issue #143), the total injection is more compact.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: use compact deterministic stale-index guidance (#147)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "staleness-code-index remains 3/3 memory-on" — The stale warning still contains reindex-repo + verify guidance
- ✅ "Memory-on active tokens near memory-off levels" — Compact guidance + already-reduced limit of 10 + EXCLUDED_TYPES filtering
- ✅ "Stale warning does not trigger unrelated memory retrieval" — The stale warning is deterministic and compact, not dependent on memory content

**2. Placeholder scan:** All steps contain actual code.

**3. Type consistency:** `CONTEXT.STALE_GUIDANCE` is a string template with `{repo}` placeholder. Used with `.replace()`. Consistent.
