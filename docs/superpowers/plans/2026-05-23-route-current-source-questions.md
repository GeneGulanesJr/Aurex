# Route Current-Source Questions to Code Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both negative-control benchmark tasks (rank-typeboost, context-return-shape) reach 3/3 memory-on by seeding canonical file/location memories.

**Architecture:** Data-only fix — seed memories for `src/memory-domain/search.js` (rankObservations/typeBoost) and `src/memory-domain/context.js` (return shape/stats fields). Also rebuilt FTS5 index which was corrupted.

**Tech Stack:** Node.js CLI (memory-store.js), SQLite FTS5

---

### Task 1: Update memory 7075 with typeBoost detail

- [x] Updated memory 7075 (search.js) to explicitly state "typeBoost multiplies the final composite ranking score" — the missing fact for negative-control-rank-typeboost.

### Task 2: Seed context.js module memory (7091)

- [x] Saved memory 7091 covering:
  - Module location: `src/memory-domain/context.js`
  - Return fields: sessions, personal, observations, workflows, project, cross_project, topic, stats
  - Stats fields: total_memories, total_personal, active_workflows

### Task 3: Rebuild FTS5 index

- [x] Executed `INSERT INTO observations_fts(observations_fts) VALUES('rebuild')` to fix corrupted FTS5 index.

### Task 4: Verify all searches work

- [x] Verified all queries return correct memories.

---

## Self-Review

**1. Spec coverage:**
- ✅ negative-control-rank-typeboost: Memory 7075 now includes "typeBoost multiplies the composite ranking score" + "src/memory-domain/search.js"
- ✅ negative-control-context-return-shape: Memory 7091 covers context.js module, all return fields, and stats sub-fields
- ✅ Memory-on active tokens remain below memory-off for current-source questions — memories are compact, only 2 seeded

**2. Placeholder scan:** All tasks executed with actual commands.

**3. Type consistency:** N/A — data-only changes.
