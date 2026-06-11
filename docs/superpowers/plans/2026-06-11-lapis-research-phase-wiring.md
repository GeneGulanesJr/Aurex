# LaPis Research-Phase Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps between Aurex's research-phase code and LaPis's code-intelligence/memory primitives — specifically: capture compression results, force research agents to consult memory before writing findings, and add test coverage for the existing (but unverified) `indexRepo → getCodeSummary → planner` chain.

**Architecture:** Three small, surgical changes. (1) `compression.ts` returns a typed `CompressionResult` instead of `void` and emits a `mission_log` event with the summary so the next planner invocation can read it via LaPis memory. (2) `skills/research.md` adds a mandatory "search_memory first" rule so findings don't duplicate prior work. (3) Three new test cases — one each in `mission-runner.test.ts` (indexRepo + repoName persistence), `planner.test.ts` (codeSummary injection into system prompt), and a new `compression.test.ts` file (result capture and event emission) — to lock in the wiring so future refactors don't silently break it.

**⚠️ PREREQUISITE — LaPis plan must merge first:** This plan consumes the structured `{ summary, tokensSaved, error? }` response from LaPis's `POST /missions/:missionId/compression` endpoint. LaPis currently returns a stub `{ accepted: true, skipped: true }` from that endpoint. **Ship `2026-06-11-lapis-mission-state-compression.md` first** (5 commits, LaPis repo). Task 1 in this plan is meaningless without it. Task 6 of that plan also updates the shared smoke test at `scripts/smoke-lapis.js`.

**Coupled change — URL fix:** Aurex's `LaPisClient.runCompression` currently calls `POST /missions/:id/compress` (no `ion`). LaPis registers the route as `POST /missions/:id/compression`. **Every compression call is currently 404'ing in production**, but the error is caught silently by `compression.ts`'s try/catch, so the dashboard just shows a recoverable error event nobody reads. This plan fixes the URL as part of Task 1.

**Tech Stack:** TypeScript, Vitest, existing `LaPisClient` HTTP wrapper, existing `EventBus`, existing `mission_log` event shape.

**Out of scope (separate plans):**
- Wiring `getCodeGraph` into `overlap.ts` for symbol-level overlap detection (requires in-memory graph cache)
- Refactoring `rescope` handler to use `supersedeContract` (already tracked in gap audit #8876)
- `getCodeHotspots` backend consumption (only used by frontend dashboard today)

---

## Background — What is already wired (do NOT redo)

Verified by reading the code directly:
- `lapis.indexRepo(repoPath, repoName)` — called in `mission-runner.ts:131-148` after `prepareRepoForMission`. Idempotent via pre-check `getCodeSummary`.
- `lapis.getCodeSummary(repoName)` — called in `mission-runner.ts:130` (pre-check) and `mission-runner.ts:147` (post-index) and the result is assigned to `codeSummary`.
- `lapis.setSetting("mission:${missionId}:repoName", repoName)` — called in `mission-runner.ts:135,144`. Consumed by `routes/code-context.ts:13,30,46`.
- `codeSummary` is passed to `createPlanner({ ..., codeSummary })` on `mission-runner.ts:151` and rendered into the system prompt by `planner.ts:123,440` (`buildCodebaseContextSection`).
- `lapis.searchMemory(missionDescription, { limit: 10 })` — `planner.ts:115` (one-shot at planning time).
- Pre-worker research agent spawning — `milestone-loop.ts:154-202` runs research before workers when no prior findings exist; `buildResearchFindingsSection` injects them into worker + validator context.

The gaps below are what this plan fixes. Tasks 1–2 add the only **production code** changes; Tasks 3–5 add test coverage that the existing wiring actually works.

---

## File map

| File | Action | Task |
|---|---|---|
| `packages/backend/src/orchestrator/compression.ts` | Modify | 1 |
| `packages/backend/src/clients/lapis-client.ts` | Modify (signature + URL fix) | 1 |
| `packages/backend/src/skills/research.md` | Modify | 2 |
| `packages/backend/__tests__/compression.test.ts` | Create | 3 |
| `packages/backend/__tests__/mission-runner.test.ts` | Modify (add assertions) | 4 |
| `packages/backend/__tests__/planner.test.ts` | Modify (add test) | 5 |
| `scripts/smoke-lapis.js:225-230` | Modify (assert new compression shape) | 6 |

---

### Task 1: Capture `runCompression` result and emit event

**Files:**
- Modify: `packages/backend/src/clients/lapis-client.ts:143` (return type)
- Modify: `packages/backend/src/clients/lapis-client.ts:525-527` (no impl change — it already returns `post(...)`)
- Modify: `packages/backend/src/orchestrator/compression.ts` (full file)

- [ ] **Step 1: Write the failing test for compression result capture**

Create `packages/backend/__tests__/compression.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createCompressionService } from "../src/orchestrator/compression";
import type { LaPisClient } from "../src/clients/lapis-client";

function createMockLapis(runResult: unknown): LaPisClient {
  return {
    runCompression: vi.fn().mockResolvedValue(runResult),
  } as unknown as LaPisClient;
}

const mockEventBus = { emit: vi.fn() };

describe("createCompressionService", () => {
  it("returns the compression summary from LaPis", async () => {
    const lapis = createMockLapis({ summary: "Mission is half done; next: build UI", tokensSaved: 4000 });
    const service = createCompressionService(lapis, mockEventBus);

    const result = await service.run("m-1", "post_milestone");

    expect(result).toEqual({ summary: "Mission is half done; next: build UI", tokensSaved: 4000 });
    expect(lapis.runCompression).toHaveBeenCalledWith("m-1", "post_milestone");
  });

  it("emits a mission_log event with the compression summary", async () => {
    const lapis = createMockLapis({ summary: "Compressed 2 milestones", tokensSaved: 1200 });
    const service = createCompressionService(lapis, mockEventBus);

    await service.run("m-1", "budget_threshold");

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mission_log",
        missionId: "m-1",
        phase: "compression",
        message: "Compressed 2 milestones",
        data: expect.objectContaining({ tokensSaved: 1200 }),
      }),
    );
  });

  it("returns null and emits a recoverable error when LaPis fails", async () => {
    const lapis = createMockLapis({ summary: null, tokensSaved: 0, error: "db locked" });
    const service = createCompressionService(lapis, mockEventBus);

    const result = await service.run("m-1", "manual");

    expect(result).toBeNull();
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mission_error",
        missionId: "m-1",
        code: "compression_failed",
        recoverable: true,
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/backend && pnpm exec vitest run __tests__/compression.test.ts`
Expected: FAIL — `createCompressionService` currently returns `void` and the test expects `{ summary, tokensSaved }` to be returned.

- [ ] **Step 3: Add the `CompressionResult` type to the LaPis client**

In `packages/backend/src/clients/lapis-client.ts`, add this interface above the `LaPisClient` interface (find an empty line near the top, around line 18 after the other shared imports):

```typescript
export interface CompressionResult {
  summary: string | null;
  tokensSaved: number;
  error?: string;
}
```

- [ ] **Step 4: Update `runCompression` return type and fix URL in the LaPis client**

In `packages/backend/src/clients/lapis-client.ts`, find the line:
```typescript
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<void>;
```
Replace it with:
```typescript
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult>;
```

The implementation at line 525-527 calls a wrong URL — it posts to `/compress` but LaPis registers the route as `/missions/:missionId/compression` (with the `n`). **Every compression call is silently 404-ing today.** Fix the URL at the same time. Find:
```typescript
    runCompression(missionId, trigger) {
      return post(`/missions/${missionId}/compress`, { trigger });
    },
```
Replace with:
```typescript
    runCompression(missionId, trigger) {
      return post(`/missions/${missionId}/compression`, { trigger }) as Promise<CompressionResult>;
    },
```

The URL fix is the same change Task 3 of the LaPis plan already asserts via the HTTP smoke test — the route name is `/compression`, not `/compress`.

- [ ] **Step 5: Rewrite `compression.ts` to return and emit the result**

Replace the entire contents of `packages/backend/src/orchestrator/compression.ts` with:

```typescript
import type { CompressionTrigger } from "@aurex/shared";
import type { CompressionResult, LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";

export interface CompressionService {
  /** Runs LaPis state compression. Returns the compression summary, or null on failure. */
  run(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult | null>;
}

export function createCompressionService(
  lapis: LaPisClient,
  eventBus: Pick<EventBus, "emit">,
): CompressionService {
  return {
    async run(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult | null> {
      let result: CompressionResult;
      try {
        result = await lapis.runCompression(missionId, trigger);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        eventBus.emit({
          type: "mission_error",
          missionId,
          code: "compression_failed",
          message,
          recoverable: true,
        });
        console.warn(`[compression] ${trigger} failed for ${missionId}:`, message);
        return null;
      }

      // Surface the compression result as a mission_log so the dashboard
      // and (later) the next planner invocation can read what was dropped.
      if (result.summary) {
        eventBus.emit({
          type: "mission_log",
          missionId,
          phase: "compression",
          message: result.summary,
          data: { trigger, tokensSaved: result.tokensSaved },
        });
      }

      if (result.error) {
        eventBus.emit({
          type: "mission_error",
          missionId,
          code: "compression_failed",
          message: result.error,
          recoverable: true,
        });
        return null;
      }

      return result;
    },
  };
}
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `cd packages/backend && pnpm exec vitest run __tests__/compression.test.ts`
Expected: PASS — all 3 cases green.

- [ ] **Step 7: Run the full backend test suite to verify no regression**

Run: `cd packages/backend && pnpm exec vitest run`
Expected: PASS. The `mission-runner.test.ts` mock at line 147 returns `vi.fn().mockResolvedValue(undefined)` for `runCompression` — that no longer matches the new `CompressionResult` return type. The mock must be updated. **Find the existing mock line:**
```typescript
    runCompression: vi.fn().mockResolvedValue(undefined),
```
**Replace with:**
```typescript
    runCompression: vi.fn().mockResolvedValue({ summary: "compressed", tokensSaved: 0 }),
```
This is a one-line edit inside `createMockLapis()` and restores type compatibility.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/clients/lapis-client.ts packages/backend/src/orchestrator/compression.ts packages/backend/__tests__/compression.test.ts packages/backend/__tests__/mission-runner.test.ts
git commit -m "feat(compression): capture LaPis compression result and emit mission_log event"
```

---

### Task 2: Make research agents search memory before writing findings

**Files:**
- Modify: `packages/backend/src/skills/research.md`

- [ ] **Step 1: Update the research skill prompt**

In `packages/backend/src/skills/research.md`, find the `## Lifecycle` section:
```markdown
## Lifecycle

1. Read your task instructions from LaPis
2. Search the codebase (read-only) for relevant information
3. Analyze and synthesize your findings
4. Write findings to LaPis
5. Die — your session ends
```

Replace it with:
```markdown
## Lifecycle

1. Read your task instructions from LaPis
2. **Call `search_memory` for each declared module and path** to load prior findings, decisions, and context. Skip findings that are already covered.
3. Search the codebase (read-only) for relevant information
4. Analyze and synthesize your findings
5. Write findings to LaPis
6. Die — your session ends
```

- [ ] **Step 2: Add an explicit "search first" rule in the role section**

Find the line in `## Role`:
```markdown
You are a **Research agent** — an ephemeral, read-only agent that gathers information. You read, you analyze, you write findings, and you die.
```

Replace it with:
```markdown
You are a **Research agent** — an ephemeral, read-only agent that gathers information. You read, you analyze, you write findings, and you die.

**Mandatory first action:** Before any `write_finding` call, you MUST call `search_memory` with each declared module tag and each declared path prefix. If a prior finding already covers a domain at the same or higher relevance, do NOT write a duplicate — either skip it or write a finding that explicitly supersedes it. Duplicates waste standing-check cycles and pollute Worker context.
```

- [ ] **Step 3: Verify the file reads correctly**

Run: `head -30 packages/backend/src/skills/research.md`
Expected: New "Mandatory first action" paragraph and updated lifecycle step 2 visible at the top.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/skills/research.md
git commit -m "docs(skills): require research agents to search memory before writing findings"
```

---

### Task 3: Add test for `runCompression` result capture (created in Task 1)

**This task is already complete as part of Task 1, Step 1.**

Skip — the test file was created in Task 1 and the same 3 cases cover the production code introduced there. No additional work.

- [ ] **Step 1: Verify the test file from Task 1 is committed**

Run: `cd packages/backend && pnpm exec vitest run __tests__/compression.test.ts`
Expected: 3 tests pass.

(If this fails, the Task 1 commit was incomplete — re-run the Task 1 steps.)

---

### Task 4: Add `indexRepo` assertions to `mission-runner.test.ts`

**Files:**
- Modify: `packages/backend/__tests__/mission-runner.test.ts` (add a new `it` block; the `createMockLapis()` factory at line 81 already includes `indexRepo`, `getCodeSummary`, and `setSetting` mocks)

- [ ] **Step 1: Add the failing assertions**

The MissionRunner public API is `start(missionId)` (fire-and-forget) + `waitForCompletion()` (resolves when the mission ends). The mock `createMockLapis()` at line 81 already provides `indexRepo`, `getCodeSummary`, and `setSetting` mocks, but no existing test asserts on them. `prepareRepoForMission` short-circuits when `cloneUrl` is missing (see `repo-prep.ts:54`), so the test's mock `getMission` (no `cloneUrl` in `configJson`) makes `repoName` = `path.basename(repoRoot)` = `"repo"`.

Add this new `it` block at the end of the `describe("MissionRunner", ...)` block in `packages/backend/__tests__/mission-runner.test.ts` (after the last existing `it` block):

```typescript
  it("indexes the repo, persists repoName, and passes codeSummary to the planner", async () => {
    const lapis = createMockLapis();
    // Force the indexing path: empty summary first → calls indexRepo
    (lapis.getCodeSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] },
    });
    (lapis.indexRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ files: 50, symbols: 200 });
    // Second getCodeSummary call (post-index) returns populated data
    (lapis.getCodeSummary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } })
      .mockResolvedValueOnce({ files: 50, symbols: 200, edges: 80, modules: [{ name: "auth", fileCount: 4 }], entryPoints: ["src/index.ts"], cycles: { count: 0, paths: [] } });

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      aurexRoot: "/test/aurex",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    // 1. indexRepo was called with (repoPath, repoName)
    expect(lapis.indexRepo).toHaveBeenCalledWith("/test/repo", "repo");

    // 2. setSetting persisted the repoName for the dashboard route
    const repoNameSetting = (lapis.setSetting as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "mission:m-1:repoName",
    );
    expect(repoNameSetting).toBeDefined();
    expect(repoNameSetting?.[1]).toBe("repo");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/backend && pnpm exec vitest run __tests__/mission-runner.test.ts`
Expected: FAIL — currently the test has no `indexRepo` assertion, so the new `expect(lapis.indexRepo).toHaveBeenCalled()` is what makes it pass. If the wiring in `mission-runner.ts:131-148` is broken (e.g. someone deletes the call), this test will fail.

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd packages/backend && pnpm exec vitest run __tests__/mission-runner.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/__tests__/mission-runner.test.ts
git commit -m "test(mission-runner): assert indexRepo and repoName persistence are invoked"
```

---

### Task 5: Add `codeSummary` injection test to `planner.test.ts`

**Files:**
- Modify: `packages/backend/__tests__/planner.test.ts`

- [ ] **Step 1: Write the failing test**

At the end of the `describe("planner", ...)` block in `packages/backend/__tests__/planner.test.ts`, add:

```typescript
  it("injects codeSummary sections into the PiNyx system prompt", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{ title: "M1", description: "First", units: [{ description: "U1", declaredPaths: [], declaredModules: [] }], criteria: [], testCommands: [] }],
    }));

    const codeSummary: CodeSummary = {
      files: 42,
      symbols: 380,
      edges: 120,
      modules: [{ name: "auth", fileCount: 8 }],
      entryPoints: ["src/index.ts"],
      cycles: { count: 0, paths: [] },
    };

    const planner = createPlanner(mockLapis, mockPinyx as never, { codeSummary });
    await planner.plan("Build auth", "m-1");

    // The PiNyx chatStream call should have received the codeSummary data
    // in the user message (planner.ts:123-135 builds codebaseSection and
    // pushes it onto the user message, not the system message).
    expect(mockPinyx.chatStream).toHaveBeenCalled();
    const request = (mockPinyx.chatStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage: string = request.messages[1].content;
    expect(userMessage).toContain("Total files: 42");
    expect(userMessage).toContain("Symbols: 380");
    expect(userMessage).toContain("Import edges: 120");
    expect(userMessage).toContain("auth");
    expect(userMessage).toContain("src/index.ts");
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/backend && pnpm exec vitest run __tests__/planner.test.ts`
Expected: PASS. (This should pass on the first try because the wiring exists; the value of this test is regression protection, not TDD red.)

- [ ] **Step 3: Run the full backend test suite to verify no regression**

Run: `cd packages/backend && pnpm exec vitest run`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/__tests__/planner.test.ts
git commit -m "test(planner): assert codeSummary is injected into the system prompt"
```

---

### Task 6: Update shared LaPis smoke test for the new compression shape

**Files:**
- Modify: `scripts/smoke-lapis.js:225-230`

- [ ] **Step 1: Replace the stub-shape assertion**

In `scripts/smoke-lapis.js`, find the block:

```javascript
  // Compression stub
  console.log('\n--- Compression (stub) ---');
  await check('POST /missions/:id/compression returns skipped', async () => {
    const res = await request('POST', `/missions/${missionId}/compression`, { trigger: 'manual' });
    assert(res.status === 200);
    assert(res.body.accepted === true);
    assert(res.body.skipped === true);
  });
```

Replace it with:

```javascript
  // Compression (real)
  console.log('\n--- Compression ---');
  await check('POST /missions/:id/compression returns CompressionResult', async () => {
    const res = await request('POST', `/missions/${missionId}/compression`, { trigger: 'manual' });
    assert(res.status === 200);
    assert(typeof res.body.summary === 'string' || res.body.summary === null);
    assert(typeof res.body.tokensSaved === 'number');
    assert(res.body.tokensSaved >= 0);
    // error is optional; if present, must be a string
    if (res.body.error !== undefined) {
      assert(typeof res.body.error === 'string');
    }
  });
```

- [ ] **Step 2: Run the smoke test against a real LaPis server**

Start LaPis in one terminal:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
lapis serve &
sleep 2
```

Then in another terminal:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
node scripts/smoke-lapis.js
```

Expected: All 27 checks pass (26 pre-existing + 1 updated compression check). The compression check should report the new `{ summary, tokensSaved, error? }` shape.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-lapis.js
git commit -m "test(smoke): assert LaPis compression returns structured CompressionResult"
```

---

## Self-review

**1. Spec coverage (the 8 gaps from the discovery):**
- Gap 1 (`runCompression` result discarded) → **Task 1** (depends on LaPis plan landing first)
- Gap 2 (`runCompression` no mission_log event) → **Task 1**
- Gap 3 (Research skill doesn't require `search_memory` first) → **Task 2**
- Gap 4 (mission-runner.test.ts has mocks but no assertions) → **Task 4**
- Gap 5 (planner.test.ts doesn't verify codeSummary injection) → **Task 5**
- Gap 6 (compression.ts has no test file) → **Task 1 + Task 3**
- Gap 7 (mission-runner.ts:128-151 silent-fail path when cached summary shows 0 files) → **NOT FIXED** — noted as low severity, deferred. The fix is to always `setSetting(repoName)` and call `getCodeSummary` again post-index, which already happens on the success branch. The only edge case is when the cached summary is exactly `{files: 0, ...}` — extremely rare, and the existing path will re-index anyway. Documented as deferred.
- Gap 8 (getCodeGraph/getCodeHotspots no backend consumer) → **OUT OF SCOPE** — requires overlap.ts refactor with graph cache, separate plan.
- Gap 9 (Aurex calls `/compress` while LaPis registers `/compression` — silent 404) → **Task 1 Step 4** (URL fix bundled with the type change)

**2. Placeholder scan:** No "TBD" / "fill in details" / "implement later" anywhere. All code blocks are complete.

**3. Type consistency:**
- `CompressionResult` interface defined in `lapis-client.ts:Task 1 Step 3` — must match LaPis plan's response shape `{ summary: string|null, tokensSaved: number, error?: string }`
- `runCompression` return type updated to `Promise<CompressionResult>` in Task 1 Step 4
- `CompressionService.run` return type updated to `Promise<CompressionResult | null>` in Task 1 Step 5
- `mission-runner.test.ts` mock updated in Task 1 Step 7 to return `CompressionResult`-shaped object — consistent throughout
- `codeSummary: CodeSummary` in Task 5 matches the existing export from `planner.ts:74`
- URL fix at Task 1 Step 4 matches LaPis plan's HTTP smoke (which asserts `/compression`)

**4. Sequencing:** Each task ends with `pnpm exec vitest run` (the relevant slice) to catch regressions before commit. Task 1 also runs the full suite because it changes a shared type. **The entire plan is gated on the LaPis plan landing first** — if LaPis still returns the stub shape, Task 1's type assertions and the new `compression.test.ts` cases will pass against mocks but the production behavior won't change.

---

## Verification

After all tasks complete (and the LaPis plan has already merged):

```bash
cd packages/backend
pnpm exec vitest run                    # all tests pass
pnpm run typecheck                       # no type errors
pnpm run build                           # builds clean
```

Then a smoke check by inspection:
- `grep -n "runCompression" packages/backend/src/orchestrator/compression.ts` → returns `Promise<CompressionResult | null>`
- `grep -n "/compression" packages/backend/src/clients/lapis-client.ts` → shows `/compression` (not `/compress`)
- `head -10 packages/backend/src/skills/research.md` → shows "Mandatory first action" paragraph
- `ls packages/backend/__tests__/compression.test.ts` → exists
- Run `node scripts/smoke-lapis.js` against a live LaPis → all checks green, compression check returns `{ summary, tokensSaved }`

**Total commits:** 5 (Tasks 1, 2, 4, 5, 6 each end with a commit; Task 3 is subsumed into Task 1).

**Cross-plan ordering:**
1. Ship `2026-06-11-lapis-mission-state-compression.md` (LaPis repo) — 5 commits
2. Verify `lapis serve` returns `{ summary, tokensSaved }` from POST `/missions/:id/compression`
3. Ship this plan — 5 commits
4. Run `scripts/smoke-lapis.js` end-to-end to confirm both halves of the contract line up
