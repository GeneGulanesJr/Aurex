# Lean Context Injection

**Date:** 2026-05-26
**Status:** Draft
**Affects:** `extensions/memory-layer/hooks/context-injection.ts`, `src/memory-domain/context.js`, `constants.js`, `test/context-injection.test.js`

## Problem

The injected memory context block has grown to ~15-20 lines (~800 tokens) per turn. Every `before_agent_start` event produces:

1. A multi-section markdown block (header, project context, prompt-matched memory, personal preferences, footer guidance)
2. Garbage prompt-matching — casual sentences like "All of those lol" or "Yeah that's what I want only when it's relevant" match unrelated observations with low relevance
3. Personal preferences injected every turn regardless of relevance
4. Redundant staleness warning + extension hint adding ~4 trailing lines

This wastes LLM context tokens on every single turn, and the garbage matches can mislead the agent.

## Design

### 1. One-line header (replaces 5+ line Project Context section)

**Before:**
```
## Memory Context (auto-loaded)

Project: **PiMemoryExtension** | 409 memories | 3 personal preferences | topic: ...

### Project Context
- Directory: `/home/genegulanesjr/...`
- Summary: 💎 LaPis — Persistent memory for the Pi coding agent...
- Code index: `PiMemoryExtension` with 292 files / 6967 symbols (stale)
```

**After:**
```
🧠 **PiMemoryExtension** — 408 memories · 292 files indexed (stale) · 💎 LaPis persistent memory
```

Rules:
- Single line. Project name, memory count, code index status, project summary (from `package.json` description)
- Staleness shown as `(stale)` inline, not as a separate warning block
- Directory path removed (LLM knows `cwd` from its own context)
- No `## heading` — the 🧠 emoji is the visual anchor
- When no code index exists: `not indexed` instead of file/symbol counts

### 2. Prompt-matched observations: only when genuinely relevant

**Before:** Up to 2 observations with 280-char snippets, matched on any keyword overlap, including low-trust results.

**After:** At most 1 observation, title only (no snippet), subject to:

| Condition | Rule |
|---|---|
| Trust score | `trust_score >= 0.8` (high confidence only) |
| Match quality | Observation title must share at least 1 meaningful keyword with the prompt (already handled by `buildTopicQueryMatch`, but the result is now filtered at injection time) |
| Max count | 1 observation, title only, no content preview |
| No prompt | Skip observations entirely |

The injection code checks `effectiveObservations` after the `mem('context')` call. If the top result has `trust_score < 0.8`, observations are silently dropped — the LLM sees just the header and footer.

### 3. Personal preferences: removed from injection

Personal preferences are available via `memory-search` when the agent needs them. They are no longer injected automatically.

**Rationale:** 99% of turns don't reference personal preferences. The 3-line block (`### Personal Preferences`, titles, blank line) is pure waste at session scale.

### 4. One-line footer (replaces 3-5 trailing lines)

**Before:**
```
Use `memory-search` for deeper recall and `memory-save` for durable decisions.

📝 **Stale code index:** indexed code may not match current source files. Run `memory-code reindex-repo --repo PiMemoryExtension` to update. Verify current source before relying on code-index results.

📂 Extension source: `extensions/memory-layer/` in this project repo.
```

**After (stale):**
```
`memory-search` for recall · `memory-save` for decisions · reindex: `memory-code reindex-repo --repo PiMemoryExtension`
```

**After (fresh):**
```
`memory-search` for recall · `memory-save` for decisions
```

Rules:
- Staleness reindex command folded into footer (only when stale)
- Extension source hint removed entirely
- `Use` prefix removed (shorter)

### 5. Constants changes

In `constants.js`, `CONTEXT`:

| Constant | Before | After | Reason |
|---|---|---|---|
| `PROMPT_INJECT_LIMIT` | 2 | 1 | Max 1 observation |
| `PERSONAL_INJECT_LIMIT` | 2 | 0 | Personal prefs removed |
| `PROMPT_MEMORY_SNIPPET_LENGTH` | 280 | 0 | No snippet shown |
| `MIN_OBSERVATION_TRUST` | (new) | 0.8 | Trust threshold for injection |

`PROMPT_RELEVANT_LIMIT` stays at 5 (the query to `mem('context')` can still return up to 5 — we filter at injection). This lets the agent `memory-search` get richer results while the auto-injection stays lean.

### 6. New project (no matching project) handling

When `crossProjectResult` is used (new project, no project-specific memories), the header adapts:

```
🧠 **NewProject** — new project · 408 memories across all projects
```

No observations, no personal prefs. Just the header + footer.

## Complete output examples

### Fresh session, no prompt, stale index
```
🧠 **PiMemoryExtension** — 408 memories · 292 files indexed (stale) · 💎 LaPis persistent memory
`memory-search` for recall · `memory-save` for decisions · reindex: `memory-code reindex-repo --repo PiMemoryExtension`
```

### Prompt with strong memory match
```
🧠 **PiMemoryExtension** — 408 memories · 292 files indexed (stale) · 💎 LaPis persistent memory
- [decision] Architecture: context injection wiring
`memory-search` for recall · `memory-save` for decisions · reindex: `memory-code reindex-repo --repo PiMemoryExtension`
```

### Prompt with weak/no memory match (the "lol" case)
```
🧠 **PiMemoryExtension** — 408 memories · 292 files indexed (stale) · 💎 LaPis persistent memory
`memory-search` for recall · `memory-save` for decisions · reindex: `memory-code reindex-repo --repo PiMemoryExtension`
```

### New project, fresh index
```
🧠 **MyNewApp** — new project · 12 memories across all projects
`memory-search` for recall · `memory-save` for decisions
```

## Token impact estimate

| Scenario | Before | After | Reduction |
|---|---|---|---|
| No prompt, stale | ~600 tokens | ~80 tokens | ~87% |
| Prompt with match | ~800 tokens | ~120 tokens | ~85% |
| Prompt no match | ~700 tokens | ~80 tokens | ~89% |

## Files to change

1. **`extensions/memory-layer/hooks/context-injection.ts`** — Rewrite the lines-building logic (the main change)
2. **`constants.js`** — Update `CONTEXT` limits, add `MIN_OBSERVATION_TRUST`
3. **`test/context-injection.test.js`** — Rewrite tests to match new output format

## Out of scope

- Changing `mem('context')` query logic or ranking (`src/memory-domain/context.js`)
- Adding a settings toggle (we can add `contextMode` later if users want the old format)
- Changing the context reminder (`registerContextReminder`) — that's a separate concern
