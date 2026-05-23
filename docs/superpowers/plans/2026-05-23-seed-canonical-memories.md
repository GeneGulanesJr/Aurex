# Seed Canonical Memories for FTS5 Rationale and Context Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed 5 canonical memories into the PiMemoryExtension database so that benchmark tasks decision-fts5-no-external-service, navigation-context-hook, and bug-history-createdb-config all reach 3/3 memory-on.

**Architecture:** This is a data-only fix — no code changes. The memories are inserted via `node memory-store.js save` using the existing CLI. Each memory is a `decision` or `architecture` type with a specific `topic_key` for targeted recall.

**Tech Stack:** Node.js CLI (memory-store.js)

---

## Root Cause Analysis

From `bench/results/pi-paired-2026-05-23T03-31-37-614Z/report.json`:

| Task | Memory-On Score | Missing Facts |
|------|----------------|---------------|
| decision-fts5-no-external-service | 1/3 | zero-dependency rationale, `src/memory-domain/search.js` location |
| navigation-context-hook | 0/3 | `context-injection.ts`, `index.ts`, startup context wiring |
| bug-history-createdb-config | 2/3 | test-isolation/global singleton failure mode |

Search for these topics returns empty results — the canonical knowledge simply doesn't exist in the database.

## Memory Seeding Strategy

Five memories covering all 9 missing facts:

1. **FTS5 decision rationale** — covers zero-dependency rationale + search module location (2 facts)
2. **Context injection hook** — covers `context-injection.ts` + `before_agent_start` event (2 facts)
3. **Extension composition** — covers `index.ts` + hook registration (2 facts)
4. **createDb config mutation bug** — covers global singleton / test isolation failure mode (1 fact)
5. **Architecture: memory domain modules** — covers `search.js` as the canonical search module (reinforces fact 1)

---

### Task 1: Seed FTS5 decision rationale

- [ ] **Step 1: Save the memory**

```bash
node memory-store.js save \
  --title "Architecture choice: LaPis uses SQLite FTS5 for memory search to avoid external dependencies" \
  --content "**What**: LaPis chose SQLite FTS5 as its full-text search engine for memory recall.**Why**: The primary rationale is zero external service dependencies — SQLite FTS5 is built into the SQLite library that LaPis already uses for storage. This avoids needing Redis, Elasticsearch, or any external search service, keeping the deployment footprint minimal and the system fully self-contained.**Where**: The search implementation lives in `src/memory-domain/search.js`. The `search()` function handles FTS5 queries with fallback to LIKE-based search when FTS5 operators are used. The `rankObservations()` function in the same file applies composite scoring (FTS relevance, recency, trust, recall, typeBoost).**Learned**: FTS5 provides sufficient search quality for the memory corpus size LaPis handles. The trigram-based `rankObservations()` fallback handles queries that FTS5 can't process directly." \
  --project PiMemoryExtension \
  --type architecture \
  --topic-key "search/fts5-rationale" \
  --scope project
```

- [ ] **Step 2: Verify it's searchable**

```bash
node memory-store.js search --query "SQLite FTS5 search" --project PiMemoryExtension --limit 3
```

Expected: The new memory appears in results.

- [ ] **Step 3: Commit (seed script)**

---

### Task 2: Seed context injection hook memory

- [ ] **Step 1: Save the memory**

```bash
node memory-store.js save \
  --title "Architecture: automatic memory context is wired via context-injection.ts before_agent_start hook" \
  --content "**What**: Automatic project memory context injection happens in `extensions/memory-layer/hooks/context-injection.ts` via the `before_agent_start` event hook.**Why**: When a Pi session starts, the extension registers a `before_agent_start` listener that calls `mem('context', { project, limit })` to fetch recent relevant memories and injects them as a system-level message into the LLM conversation. This gives the agent immediate awareness of past decisions, bugfixes, and architecture constraints without requiring explicit `memory-search` calls.**Where**: `extensions/memory-layer/hooks/context-injection.ts` — the `registerBeforeAgentStart()` function. It queries project-scoped observations, cross-project fallback, personal preferences, and appends a staleness warning for outdated code indexes.**Learned**: The hook uses `CONTEXT.DEFAULT_LIMIT` (10) for the primary context and `Math.max(CONTEXT.DEFAULT_LIMIT - 3, 5)` for cross-project fallback. Low-signal types (progress, accomplished, session_summary) are excluded by `CONTEXT.EXCLUDED_TYPES`." \
  --project PiMemoryExtension \
  --type architecture \
  --topic-key "extension/context-injection" \
  --scope project
```

- [ ] **Step 2: Verify it's searchable**

```bash
node memory-store.js search --query "context injection hook extension" --project PiMemoryExtension --limit 3
```

Expected: The new memory appears.

---

### Task 3: Seed extension composition memory

- [ ] **Step 1: Save the memory**

```bash
node memory-store.js save \
  --title "Architecture: extension hook composition and registration lives in extensions/memory-layer/index.ts" \
  --content "**What**: The memory-layer extension root file `extensions/memory-layer/index.ts` composes and registers all hooks into the Pi extension system.**Why**: This is the entry point that wires together context injection (`context-injection.ts`), passive capture (`passive-capture.ts`), session lifecycle (`session-lifecycle.ts`), tool guardrails (`tool-guardrails.ts`), and trust sync (`trust-sync.ts`). Pi's extension API calls the exported `register()` function with the `ExtensionAPI` object, and each hook module registers its event listeners.**Where**: `extensions/memory-layer/index.ts` — exports `register(pi)` which calls `registerBeforeAgentStart(pi, deps)`, `registerContextReminder(pi, deps)`, `registerSessionStart(pi, deps)`, `registerSessionEnd(pi, deps)`, `registerToolGuardrails(pi)`, `registerToolHooks(pi, deps)`, and `registerTrustSync(pi, deps)`.**Learned**: The extension composition pattern keeps each concern isolated while sharing a common `state` object and `mem()` client. The `ContextDeps` interface provides dependency injection for testability." \
  --project PiMemoryExtension \
  --type architecture \
  --topic-key "extension/composition" \
  --scope project
```

- [ ] **Step 2: Verify it's searchable**

```bash
node memory-store.js search --query "extension index.ts composition register hooks" --project PiMemoryExtension --limit 3
```

Expected: The new memory appears.

---

### Task 4: Seed createDb config mutation bug history

- [ ] **Step 1: Save the memory**

```bash
node memory-store.js save \
  --title "Bug fix: createDb config save/restore prevents global singleton mutation" \
  --content "**What**: `createDb()` in `db.js` was mutating `getConfig._cached` (the global cached config singleton) by merging test-specific config overrides into it. This meant that after creating a test DB, the global config was permanently corrupted for subsequent operations.**Why**: The fix adds a save/restore pattern — before applying overrides, the original cached config is saved; after DB creation, it's restored. This prevents test isolation failures where one test's config bled into the next. The failure mode was that `createDb` changes `getConfig._cached` to the merged config object, making it impossible to create a second DB with different settings.**Where**: `db.js` — the `createDb` function. The fix saves the previous cached config before applying overrides and restores it after the DB is created.**Learned**: Global singletons with mutable state are dangerous in test environments. The save/restore pattern is a minimal fix, but the real lesson is to avoid sharing mutable global state between DB instances." \
  --project PiMemoryExtension \
  --type bugfix \
  --topic-key "db/createdb-config-mutation" \
  --scope project
```

- [ ] **Step 2: Verify it's searchable**

```bash
node memory-store.js search --query "createDb config mutation global singleton test isolation" --project PiMemoryExtension --limit 3
```

Expected: The new memory appears.

---

### Task 5: Seed search module location memory

- [ ] **Step 1: Save the memory**

```bash
node memory-store.js save \
  --title "Architecture: memory search implementation lives in src/memory-domain/search.js" \
  --content "**What**: The memory search module is `src/memory-domain/search.js`. It exports `search()`, `rankObservations()`, `symbolCluster()`, and `related()` functions.**Why**: This is the canonical search implementation for LaPis. The `search()` function uses SQLite FTS5 for full-text search with LIKE-based fallback for special queries. Results are ranked via `rankObservations()` which computes a composite score from FTS relevance, recency (exponential decay with configurable half-life), trust score, recall count, and type boost.**Where**: `src/memory-domain/search.js` — the `search()` function is at line 57, `rankObservations()` at line 23. The FTS5 query is built with `TRUST_RECALL_JOINS` for joining trust and recall data. The `TYPE_PRIORITY_CASE` SQL expression maps memory types to priority values for ordering.**Learned**: The search module is the single source of truth for memory recall. The `context` command (in `context.js`) reuses `TYPE_PRIORITY_CASE` and `TRUST_RECALL_JOINS` from search.js for consistency." \
  --project PiMemoryExtension \
  --type architecture \
  --topic-key "search/module-location" \
  --scope project
```

- [ ] **Step 2: Verify it's searchable**

```bash
node memory-store.js search --query "search module implementation" --project PiMemoryExtension --limit 3
```

Expected: The new memory appears.

---

### Task 6: Verify all seeded memories are recallable via context

- [ ] **Step 1: Run context for PiMemoryExtension**

```bash
node memory-store.js context --project PiMemoryExtension --limit 15
```

Expected: All 5 new memories appear in the observations list.

- [ ] **Step 2: Search for each individual topic**

```bash
node memory-store.js search --query "FTS5 rationale zero dependency" --project PiMemoryExtension --limit 3
node memory-store.js search --query "context injection before_agent_start" --project PiMemoryExtension --limit 3
node memory-store.js search --query "extension composition index.ts register" --project PiMemoryExtension --limit 3
node memory-store.js search --query "createDb global singleton test isolation" --project PiMemoryExtension --limit 3
node memory-store.js search --query "search.js module implementation" --project PiMemoryExtension --limit 3
```

Expected: Each query returns the corresponding seeded memory.

---

## Self-Review

**1. Spec coverage:**
- ✅ "decision-fts5-no-external-service reaches 3/3" — Task 1 covers zero-dependency rationale + Task 5 covers search.js location
- ✅ "navigation-context-hook reaches 3/3" — Task 2 covers context-injection.ts + Task 3 covers index.ts + both cover startup wiring
- ✅ "bug-history-createdb-config reaches 3/3" — Task 4 covers test-isolation/global singleton failure mode (the only missing fact was test-isolation)

**2. Placeholder scan:** No TBDs, TODOs, or placeholders. All steps contain actual CLI commands with full content.

**3. Type consistency:** All memories use `--type architecture` or `--type bugfix` with `--scope project`. Topic keys use hierarchical `category/name` format consistent with existing patterns.
