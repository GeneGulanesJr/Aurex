# Protocols

## 1. Code & Doc Retrieval — Use memory-code / memory-doc

The `memory-layer` extension **enforces** structured retrieval over raw file reads:

- **Code** → `memory-code` tool
  - Modes: callers, callees, blast-radius, dead-code, complexity, deps, outline, churn, hotspots, cycles, importance, coupling, extractable, hierarchy, signal-chains, layer-violations
- **Docs** → `memory-doc` tool
  - Modes: search, outline, backlinks, broken-links, glossary, tutorial-path, code-examples, orphans, coverage, stale-pages, duplicates

If a repo isn't indexed yet, the tool will tell you exactly how to index it.

**Enforcement rules:**
- `read` on a code file in an indexed repo **without** offset/limit → BLOCKED. Use `memory-code outline` first.
- `read` on a code file **with** offset/limit → ALLOWED (editing targeted lines).
- `bash` grep/rg/find on source code in an indexed repo → BLOCKED. Use `memory-code` instead.
- After calling `memory-code outline` on a file, subsequent reads are allowed.

## 2. Persistent Memory — Automatic

Memory is handled automatically by the `memory-layer` extension. It:
- **Injects context** at session start (decisions, preferences, recent memories)
- **Re-injects context after compaction** — `/compact` no longer destroys memory awareness
- **Auto-detects decisions** — pattern-matches assistant messages for decisions, bugfixes, discoveries, and auto-saves them
- **Periodic progress checkpoints** — every 10 turns, saves an auto-checkpoint with files edited
- **Persistent memory reminder** — every 8th LLM call, injects a lightweight reminder if no memory tool was used recently
- **Git-triggered trust sync** — after git pull/checkout/merge/rebase, auto-syncs code trust scores
- **Auto-saves session summaries** on shutdown with topics, files, and turn count
- **Auto-recovers** incomplete sessions
- **Detects stale indexes** and warns when code indexes are out of date
- **Hard-blocks reads of code files** in indexed repos — must use `memory-code outline` first; partial reads (offset/limit) allowed for editing

### When to use the tools
- **`memory-save`** — Decisions, bugfixes, architecture constraints, patterns, discoveries. Always search first.
- **`memory-search`** — Before making decisions, to avoid repeating past mistakes or re-deciding settled questions.
- **`memory-get`** — To read the full content of a specific memory.
- **`memory-related`** — To find all memories linked to the same code symbol.
- **`memory-load-context`** — Deep-dive into everything memory knows about a specific topic.
- **`memory-sync-code-trust`** — After git pulls / branch switches, to sync trust scores with changed symbols.

### Content format
Use **What/Why/Where/Learned** in the content field:
```
**What**: …
**Why**: …
**Where**: …
**Learned**: …
```

### No manual protocol needed
The extension handles session start, context loading, and session shutdown automatically. No bash calls to memory-store.js needed during sessions.

Full feature docs: `~/.pi/agent/skills/memory-layer/SKILL.md`