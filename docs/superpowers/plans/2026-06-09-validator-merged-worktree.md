# Validator Merged Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the validator's "constantly find new things to do" loop by spawning it from a merged worktree that contains all worker branch changes, so its `read` and `bash` calls return the post-worker code that matches the diff in its context.

**Architecture:** Add a `createValidatorWorktree(milestoneId, units)` helper to `WorktreeManager` that creates a fresh worktree at `${repoRoot}/.git-worktrees/validator-${milestoneId}` from `gitMainBranch` and merges all worker `taskBranch` references into it (using `git merge --no-ff --no-commit`, then committing if no conflicts). The milestone loop calls this helper before each validator spawn and uses the resulting path as the spawn `cwd`. After the spawn completes (success, failure, or timeout) the loop prunes the worktree. If any worker branch fails to merge, the loop records a verdict-style failure for that unit before spawning the validator, so the validator is told explicitly via context which units have merge conflicts (and the validator's `cwd` is the partial merge worktree).

**Tech Stack:** TypeScript, Vitest, Node.js `child_process.execFile` (existing), git worktree/branch/merge (no new deps).

---

### Task 1: Refactor `git` helper and add `createValidatorWorktree` to `WorktreeManager`

**Files:**
- Modify: `packages/backend/src/orchestrator/worktree.ts`
- Modify: `packages/backend/__tests__/worktree.test.ts`

- [ ] **Step 1: Write the failing test for `createValidatorWorktree`**

Add to `packages/backend/__tests__/worktree.test.ts`, after the `pruneWorktree` test (around line 62):

```typescript
  describe("createValidatorWorktree", () => {
    it("creates a fresh worktree at validator-${milestoneId} from base branch", async () => {
      const manager = createWorktreeManager("/repo/root");
      const result = await manager.createValidatorWorktree("ms-1", "main", [
        "task/worker-a/auth-001",
      ]);

      expect(result.worktreePath).toBe("/repo/root/.git-worktrees/validator-ms-1");
      expect(result.validationBranch).toBe("validation/ms-1");

      const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
      expect(calls.some((c) => c.includes("branch validation/ms-1 main"))).toBe(true);
      expect(calls.some((c) => c.includes("worktree add /repo/root/.git-worktrees/validator-ms-1 validation/ms-1"))).toBe(true);
      expect(calls.some((c) => c.includes("merge --no-ff --no-commit task/worker-a/auth-001"))).toBe(true);
    });

    it("merges multiple worker branches in order", async () => {
      const manager = createWorktreeManager("/repo/root");
      await manager.createValidatorWorktree("ms-2", "main", [
        "task/worker-a/auth-001",
        "task/worker-b/db-002",
      ]);

      const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
      const firstIdx = calls.findIndex((c) => c.includes("task/worker-a/auth-001"));
      const secondIdx = calls.findIndex((c) => c.includes("task/worker-b/db-002"));
      expect(firstIdx).toBeGreaterThan(-1);
      expect(secondIdx).toBeGreaterThan(firstIdx);
    });

    it("returns mergedUnitIds reflecting which branches merged cleanly", async () => {
      // Simulate conflict on the second merge only — the first commits
      // successfully, the second throws (conflict). Setup calls (worktree
      // cleanup, branch creation, worktree add) all succeed first.
      let mergeCallCount = 0;
      mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("merge") && !args.includes("--abort")) {
          mergeCallCount++;
          if (mergeCallCount === 2) {
            throw new Error("CONFLICT: merge conflict in src/auth.ts");
          }
        }
        return { stdout: "", stderr: "" };
      });

      const manager = createWorktreeManager("/repo/root");
      const result = await manager.createValidatorWorktree("ms-3", "main", [
        "task/worker-a/auth-001",
        "task/worker-b/db-002",
      ]);

      expect(result.mergedUnitIds).toEqual(["task/worker-a/auth-001"]);
      expect(result.conflictedBranches).toEqual(["task/worker-b/db-002"]);
    });

    it("aborts in-progress merge on conflict and leaves branch usable", async () => {
      // After a failed merge, --no-commit leaves the worktree mid-merge.
      // We need to run `git merge --abort` so the worktree is in a clean state
      // for the validator to read.
      mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("merge") && !args.includes("--abort")) {
          throw new Error("CONFLICT");
        }
        return { stdout: "", stderr: "" };
      });

      const manager = createWorktreeManager("/repo/root");
      const result = await manager.createValidatorWorktree("ms-4", "main", [
        "task/worker-b/db-002",
      ]);

      expect(result.conflictedBranches).toEqual(["task/worker-b/db-002"]);

      const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
      expect(calls.some((c) => c.includes("-C /repo/root/.git-worktrees/validator-ms-4 merge --abort"))).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd packages/backend && npx vitest run __tests__/worktree.test.ts -t "createValidatorWorktree"`
Expected: FAIL — `createValidatorWorktree` is not a function

- [ ] **Step 3: Refactor the `git` helper to take a `cwd` parameter, and add `createValidatorWorktree`**

In `packages/backend/src/orchestrator/worktree.ts`, first refactor the `git` helper so that the per-worktree `createValidatorWorktree` can use it (and inherit `sanitizeGitArg` automatically). Find the helper at line 30:

```typescript
  async function git(...args: string[]): Promise<string> {
    for (const arg of args) sanitizeGitArg(arg);
    // Stryker disable next-line MethodExpression: stdout → stderr mutant
    // is equivalent when git output goes to either stream in test mocks.
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args]);
    return stdout.trim();
  }
```

Replace with:

```typescript
  async function git(cwd: string, ...args: string[]): Promise<string> {
    for (const arg of args) sanitizeGitArg(arg);
    // Stryker disable next-line MethodExpression: stdout → stderr mutant
    // is equivalent when git output goes to either stream in test mocks.
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
    return stdout.trim();
  }
```

Then update every existing call site to pass `repoRoot` as the first argument. The seven call sites are:

```typescript
      await git("branch", taskBranch, agentBranch);
      await git("worktree", "add", worktreePath, taskBranch);
      await git("branch", branchName, baseBranch);
      await git("checkout", targetBranch);
      await git("merge", sourceBranch, "--no-ff");
      await git("worktree", "remove", worktreePath, "--force");
      await git("worktree", "prune");
```

Replace each with the same call prefixed by `repoRoot,`:

```typescript
      await git(repoRoot, "branch", taskBranch, agentBranch);
      await git(repoRoot, "worktree", "add", worktreePath, taskBranch);
      await git(repoRoot, "branch", branchName, baseBranch);
      await git(repoRoot, "checkout", targetBranch);
      await git(repoRoot, "merge", sourceBranch, "--no-ff");
      await git(repoRoot, "worktree", "remove", worktreePath, "--force");
      await git(repoRoot, "worktree", "prune");
```

Now update the `WorktreeManager` interface (around line 11) to add the new method:

```typescript
export interface CreateValidatorWorktreeResult {
  worktreePath: string;
  validationBranch: string;
  mergedUnitIds: string[];   // branches that merged cleanly
  conflictedBranches: string[]; // branches that hit a merge conflict
}

export interface WorktreeManager {
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  createBranch(branchName: string, baseBranch: string): Promise<void>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
  installBranchGuard(worktreePath: string, allowedBranch: string): Promise<void>;
  createValidatorWorktree(
    milestoneId: string,
    baseBranch: string,
    taskBranches: string[],
  ): Promise<CreateValidatorWorktreeResult>;
}
```

Then add a new method to the returned object (after `installBranchGuard`, before the closing `};` of `createWorktreeManager`):

```typescript
    async createValidatorWorktree(milestoneId, baseBranch, taskBranches) {
      const validationBranch = `validation/${milestoneId}`;
      const worktreePath = `${worktreeBase}/validator-${milestoneId}`;

      // Idempotent cleanup: if a previous run left the worktree behind, remove it.
      // Stryker disable next-line StringLiteral: git command args
      try { await git(repoRoot, "worktree", "remove", worktreePath, "--force"); } catch { /* not present */ }
      try { await git(repoRoot, "branch", "-D", validationBranch); } catch { /* not present */ }
      // Stryker disable next-line StringLiteral: git command args
      try { await git(repoRoot, "worktree", "prune"); } catch { /* best-effort */ }

      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "branch", validationBranch, baseBranch);
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "add", worktreePath, validationBranch);

      const mergedUnitIds: string[] = [];
      const conflictedBranches: string[] = [];

      for (const taskBranch of taskBranches) {
        // Stryker disable next-line StringLiteral: git command args
        // --no-commit so we can detect conflicts and abort cleanly.
        try {
          await git(worktreePath, "merge", "--no-ff", "--no-commit", taskBranch);
          // Stryker disable next-line StringLiteral: git commit args
          // --no-verify bypasses the branch-guard pre-commit hook (which
          // restricts to task/integration/release/*; validation/* is not
          // in that list but is a legitimate internal branch).
          await git(worktreePath, "commit", "--no-verify", "-m", `merge ${taskBranch} into ${validationBranch}`);
          mergedUnitIds.push(taskBranch);
        } catch {
          // Stryker disable next-line StringLiteral: git command args
          // Conflict: abort the in-progress merge so the worktree is clean.
          try {
            await git(worktreePath, "merge", "--abort");
          } catch { /* nothing to abort */ }
          conflictedBranches.push(taskBranch);
        }
      }

      return { worktreePath, validationBranch, mergedUnitIds, conflictedBranches };
    },
```

Note: the `git` helper was refactored (above) to take a `cwd` as its first parameter. This means the new method passes `worktreePath` for per-worktree operations (merge, commit, merge --abort) and `repoRoot` for repo-level operations (worktree remove, branch create/delete, worktree add). The helper still calls `sanitizeGitArg` on every arg, so shell metacharacter injection is prevented.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/worktree.test.ts -t "createValidatorWorktree"`
Expected: All 4 new tests PASS

- [ ] **Step 5: Run the full worktree test suite to verify no regressions**

Run: `cd packages/backend && npx vitest run __tests__/worktree.test.ts`
Expected: All existing + new tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/orchestrator/worktree.ts packages/backend/__tests__/worktree.test.ts
git commit -m "feat(worktree): add createValidatorWorktree — merge worker branches into a validation worktree"
```

---

### Task 2: Inject merged-worktree path into validator context

**Files:**
- Modify: `packages/backend/src/agents/context-builder.ts`
- Modify: `packages/backend/__tests__/agents/context-builder.test.ts`

- [ ] **Step 1: Read the existing context-builder test file to understand the test harness**

Run: `head -50 packages/backend/__tests__/agents/context-builder.test.ts`
Expected: A test file importing `buildValidatorContext` with `it` blocks. Note the existing test pattern for `buildValidatorContext` (likely tests like `it("includes diff summary when provided")` from the validator-scrutiny-fix plan).

- [ ] **Step 2: Write the failing test for the merged worktree path**

Add to `packages/backend/__tests__/agents/context-builder.test.ts`, inside the `describe("buildValidatorContext")` block, after the diff-summary tests:

```typescript
  it("includes merged worktree path and merge status when provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: ["Login returns JWT"],
      testCommands: ["npm test"],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [
        { id: "u-1", description: "auth", declaredPaths: [], declaredModules: [], taskBranch: "task/worker-a/u-1", worktreePath: "/repo/.git-worktrees/worker-a-u-1" },
        { id: "u-2", description: "db", declaredPaths: [], declaredModules: [], taskBranch: "task/worker-b/u-2", worktreePath: "/repo/.git-worktrees/worker-b-u-2" },
      ],
      validatorWorktree: {
        path: "/repo/.git-worktrees/validator-ms-1",
        mergedBranches: ["task/worker-a/u-1"],
        conflictedBranches: ["task/worker-b/u-2"],
      },
    });

    expect(ctx).toContain("## Merged Validation Worktree");
    expect(ctx).toContain("/repo/.git-worktrees/validator-ms-1");
    expect(ctx).toContain("Your `read` and `bash` tool calls operate from THIS directory.");
    expect(ctx).toContain("task/worker-b/u-2");
    expect(ctx).toContain("u-2");
  });

  it("omits merged worktree section when not provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
    });

    expect(ctx).not.toContain("## Merged Validation Worktree");
  });
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd packages/backend && npx vitest run __tests__/agents/context-builder.test.ts -t "merged worktree"`
Expected: FAIL — `validatorWorktree` is not a property of `ValidatorContextInput`

- [ ] **Step 4: Add `validatorWorktree` to the input interface and render it**

In `packages/backend/src/agents/context-builder.ts`, update the `ValidatorContextInput` interface to add the new field:

Find:
```typescript
export interface ValidatorContextInput {
  validatorType: "validator_scrutiny" | "validator_user_testing";
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  contractId: string;
  contractCriteria: string[];
  testCommands: string[];
  acceptanceBehavior: string;
  baseBranch: string;
  units: ValidatorUnitContext[];
  researchFindings?: ResearchFinding[];
  /** Concatenated git diff for all working unit branches against baseBranch. */
  diffSummary?: string;
}
```

Replace with:
```typescript
export interface ValidatorWorktreeInfo {
  /** Absolute path to the worktree the validator was spawned from. */
  path: string;
  /** Worker branches that merged cleanly into the validation branch. */
  mergedBranches: string[];
  /** Worker branches that had merge conflicts and were NOT applied. */
  conflictedBranches: string[];
}

export interface ValidatorContextInput {
  validatorType: "validator_scrutiny" | "validator_user_testing";
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  contractId: string;
  contractCriteria: string[];
  testCommands: string[];
  acceptanceBehavior: string;
  baseBranch: string;
  units: ValidatorUnitContext[];
  researchFindings?: ResearchFinding[];
  /** Concatenated git diff for all working unit branches against baseBranch. */
  diffSummary?: string;
  /**
   * Information about the merged validation worktree the validator is
   * spawned from. When present, the validator's read/bash tools operate
   * from this worktree (which contains all worker code changes merged in).
   * Conflicted branches have NOT been applied — the validator is told so
   * explicitly and is expected to fail those units.
   */
  validatorWorktree?: ValidatorWorktreeInfo;
}
```

Then in `buildValidatorContext`, add the new section. Find the "Validator Assignment" block:

```typescript
  sections.push(
    [
      "## Validator Assignment",
      "",
      `- Validator type: ${input.validatorType}`,
      `- Contract ID: ${input.contractId}`,
      `- Base branch: ${input.baseBranch}`,
    ].join("\n"),
  );
```

Replace with:
```typescript
  sections.push(
    [
      "## Validator Assignment",
      "",
      `- Validator type: ${input.validatorType}`,
      `- Contract ID: ${input.contractId}`,
      `- Base branch: ${input.baseBranch}`,
    ].join("\n"),
  );

  if (input.validatorWorktree) {
    const vw = input.validatorWorktree;
    const conflictedUnitIds = vw.conflictedBranches
      .map((branch) => input.units.find((u) => u.taskBranch === branch)?.id)
      .filter((id): id is string => Boolean(id));
    sections.push(
      [
        "## Merged Validation Worktree",
        "",
        `Path: \`${vw.path}\``,
        "",
        "Your `read` and `bash` tool calls operate from THIS directory. The code on disk is the post-worker state — files added or modified by workers ARE present here. Do NOT search the base branch for code that the diff shows as added; it exists here.",
        "",
        `- Merged cleanly: ${vw.mergedBranches.length === 0 ? "(none)" : vw.mergedBranches.join(", ")}`,
        `- Merge conflicts (NOT applied — treat as failed): ${vw.conflictedBranches.length === 0 ? "(none)" : vw.conflictedBranches.join(", ")}`,
        conflictedUnitIds.length > 0
          ? `\nUnits with unmergeable code: ${conflictedUnitIds.join(", ")}. These MUST be listed in \`failedUnitIds\` with the reason "merge conflict — worker code could not be integrated".`
          : "",
      ].filter(Boolean).join("\n"),
    );
  }
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/agents/context-builder.test.ts -t "merged worktree"`
Expected: Both new tests PASS

- [ ] **Step 6: Run the full context-builder test suite**

Run: `cd packages/backend && npx vitest run __tests__/agents/context-builder.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/agents/context-builder.ts packages/backend/__tests__/agents/context-builder.test.ts
git commit -m "feat(context-builder): inject merged worktree path and merge status into validator context"
```

---

### Task 3: Use the merged worktree in `milestone-loop.ts` validator spawn

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Modify: `packages/backend/__tests__/milestone-loop-validator-e2e.test.ts`

- [ ] **Step 1: Write the failing test for validator spawn cwd**

Add to `packages/backend/__tests__/milestone-loop-validator-e2e.test.ts`, after the existing "returns checkpoint_needed when integration merge fails after validator pass" test, inside the same `describe` block:

```typescript
  it("spawns validator from a merged worktree, not the base repo root", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const unit = makeUnit();
    const verdicts: ValidationVerdict[] = [];
    const handoffs: unknown[] = [];

    const spawnCwds: string[] = [];

    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([unit]),
      getContractHistory: vi.fn().mockResolvedValue([
        {
          id: "contract-e2e",
          content: { criteria: ["validator uses merged worktree"], testCommands: [], acceptanceBehavior: "" },
        },
      ]),
      writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
      getHandoffsForMilestone: vi.fn().mockResolvedValue([]),
      writeVerdict: vi.fn().mockImplementation(async (sessionId: string, v: Omit<ValidationVerdict, "id" | "sessionId">) => {
        const written = { id: `verdict-${verdicts.length + 1}`, sessionId, ...v };
        verdicts.push(written);
        return written;
      }),
      getVerdicts: vi.fn().mockImplementation(async () => verdicts),
      getSessionsForMilestone: vi.fn().mockResolvedValue([]),
      incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-e2e", retries: 0, rescopes: 0 }),
      registerAgentSession: vi.fn().mockResolvedValue(undefined),
      searchMemory: vi.fn().mockResolvedValue([]),
      getFindings: vi.fn().mockResolvedValue([]),
      runCompression: vi.fn().mockResolvedValue(undefined),
    } as unknown as LaPisClient;

    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      spawnCwds.push(opts.cwd);
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) { subscriber = fn; return () => {}; },
          async prompt() {
            const verdictTool = opts.customTools.find((t) => t.name === "write_verdict");
            if (verdictTool) {
              await verdictTool.execute("v", { verdict: "pass", findings: "ok", failedUnitIds: [] });
            }
            subscriber({ type: "agent_end" });
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot,
      gitMainBranch: "main",
    });

    await loop.run(mission, [milestone]);

    // The validator spawn (session 2 — research is session 1, validator is session 2) must use a worktree path
    const validatorCwd = spawnCwds[spawnCwds.length - 1];
    expect(validatorCwd).toContain(".git-worktrees/validator-");
    expect(validatorCwd).not.toBe(repoRoot);
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/milestone-loop-validator-e2e.test.ts -t "spawns validator from a merged worktree"`
Expected: FAIL — validator spawns with `cwd === repoRoot`

- [ ] **Step 3: Implement the merged worktree spawn in `milestone-loop.ts`**

In `packages/backend/src/orchestrator/milestone-loop.ts`, first add the import for `CreateValidatorWorktreeResult`. Find the import line (around line 6):

```typescript
import { createWorktreeManager } from "./worktree.js";
```

Replace with:

```typescript
import { createWorktreeManager, type CreateValidatorWorktreeResult } from "./worktree.js";
```

Then find the validator phase that begins after the diff collection (around line 410 — the line that starts `for (const validatorType of validatorTypes)`).

The block to find starts with collecting `diffSummary` and ends right before the validator spawn `for` loop. The current shape is:

```typescript
          // Collect git diff for all validator units against base branch.
          let diffSummary = "";
          try { ... } catch { ... }

          for (const validatorType of validatorTypes) {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({
              validatorType, missionDescription: mission.description,
              ...
            });

            callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
            const handle = await spawner.spawn({
              agentType: validatorType, agentId, missionId: mission.id, milestoneId: milestone.id,
              contractId, cwd: loopConfig.repoRoot,
              ...
            });
            ...
          }
```

Replace the entire `for (const validatorType of validatorTypes)` block (including the spawn call and the awaiting of `handle.completed`) with:

```typescript
          // Build a merged worktree once for all validator types so they
          // share the same on-disk post-worker state. The validator's
          // read/bash calls operate from this directory.
          let validatorWorktree: CreateValidatorWorktreeResult | null = null;
          try {
            validatorWorktree = await worktreeManager.createValidatorWorktree(
              milestone.id,
              loopConfig.gitMainBranch,
              validatorUnits.map((u) => u.taskBranch).filter(Boolean),
            );
          } catch (err) {
            // Merged worktree creation is best-effort. If it fails, the
            // validator falls back to the base repo cwd (legacy behavior)
            // and the diff in context is its only signal.
            console.warn(
              `[validator] Failed to create merged worktree for milestone ${milestone.id}:`,
              err instanceof Error ? err.message : err,
            );
          }
          const validatorCwd = validatorWorktree?.worktreePath ?? loopConfig.repoRoot;

          for (const validatorType of validatorTypes) {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({
              validatorType, missionDescription: mission.description,
              milestoneTitle: milestone.title, milestoneDescription: milestone.description,
              contractId, contractCriteria: criteria, testCommands, acceptanceBehavior,
              baseBranch: loopConfig.gitMainBranch, units: validatorUnits,
              researchFindings,
              diffSummary: diffSummary || undefined,
              validatorWorktree: validatorWorktree
                ? {
                    path: validatorWorktree.worktreePath,
                    mergedBranches: validatorWorktree.mergedUnitIds,
                    conflictedBranches: validatorWorktree.conflictedBranches,
                  }
                : undefined,
            });

            callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
            const handle = await spawner.spawn({
              agentType: validatorType, agentId, missionId: mission.id, milestoneId: milestone.id,
              contractId, cwd: validatorCwd,
              skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/validator.md`,
              contextContent,
              taskPrompt: `Validate milestone "${milestone.title}" as ${validatorType}. Use write_verdict when done.`,
              timeout: config.workerTimeouts.testHeavy,
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);
            handle.dispose();
          }

          // Prune the merged validation worktree after all validators complete.
          // Stryker disable next-line StringLiteral: best-effort cleanup
          if (validatorWorktree) {
            try {
              await worktreeManager.pruneWorktree(validatorWorktree.worktreePath);
            } catch (err) {
              console.warn(
                `[validator] Failed to prune merged worktree ${validatorWorktree.worktreePath}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd packages/backend && npx vitest run __tests__/milestone-loop-validator-e2e.test.ts -t "spawns validator from a merged worktree"`
Expected: PASS

- [ ] **Step 5: Run the full milestone-loop validator e2e suite to verify no regressions**

Run: `cd packages/backend && npx vitest run __tests__/milestone-loop-validator-e2e.test.ts`
Expected: All tests PASS (the new test plus the existing 2)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/orchestrator/milestone-loop.ts packages/backend/__tests__/milestone-loop-validator-e2e.test.ts
git commit -m "fix(orchestrator): spawn validator from merged worktree so reads match the diff"
```

---

### Task 4: Run the full backend test suite to verify no regressions

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd packages/backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run the type checker**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint**

Run: `cd packages/backend && npm run lint 2>&1 | tail -20`
Expected: No lint errors (or only pre-existing unrelated warnings)

---

## Review Pass 1 (self-review)

### Spec coverage

| Original problem | Task |
|---|---|
| Validator spawns with `cwd: loopConfig.repoRoot` (base branch), reads return base-branch content, doesn't match diff, validator concludes code is missing → fail loop | Tasks 1, 3 |
| Validator context doesn't tell the model where its cwd actually is | Task 2 (the skill already says "use read and bash directly" which is still correct; the context section names the merged worktree path explicitly) |
| Conflicted branches leave the worktree mid-merge, blocking later reads | Task 1 (--abort handling) |
| Best-effort fallback if worktree creation fails | Task 3 (try/catch) |
| Stale worktree from prior run | Task 1 (idempotent cleanup) |

### Placeholder scan

No "TBD", "TODO", "implement later", or "add appropriate error handling" without code. Every step has full code blocks.

### Type consistency

- `WorktreeManager.createValidatorWorktree` returns `Promise<CreateValidatorWorktreeResult>` — matches the new interface field
- `CreateValidatorWorktreeResult.worktreePath: string` matches the `worktreePath` field in `milestone-loop.ts` (used as `cwd`)
- `validatorWorktree` in `ValidatorContextInput` is `ValidatorWorktreeInfo | undefined` — the `if (input.validatorWorktree)` check in `buildValidatorContext` is correct
- `mergedBranches` / `conflictedBranches` arrays are `string[]` — `.map().filter()` chain returns `string[]` (filter narrows to defined)
- `Awaited<ReturnType<typeof worktreeManager.createValidatorWorktree>>` — matches the return type of the new method

### Edge cases handled

- **No worker units**: `taskBranches` is `[]` → loop is no-op, returns worktree at base branch with empty `mergedUnitIds` and `conflictedBranches`
- **Single worker branch that conflicts**: caught and recorded in `conflictedBranches`, worktree is clean (merge --abort), validator still spawns and the context tells it to mark the unit as failed
- **Worktree creation itself fails**: caught at the `milestone-loop.ts` boundary, validator falls back to `loopConfig.repoRoot` as cwd, no context injection. The diff in context is the only signal but the validator is no worse off than before this change.
- **Pruning fails**: caught and logged, doesn't block the rest of the milestone loop

### Risks

- **Merging worker branches may produce additional conflicts not present in any individual worker's branch** — this is unlikely (each branch was tested in isolation) but possible. The `--abort` handling ensures the worktree is clean.
- **Test isolation**: The new `createValidatorWorktree` test mocks `execFileAsync` per-test, and existing `WorktreeManager` tests use a fresh `mockExecAsync.mockReset()` in `beforeEach`. Verified in step 5 of Task 1.
- **Idempotent cleanup in `createValidatorWorktree`**: A stale `validation/${milestoneId}` branch from a previous run could prevent `git branch` from succeeding. The cleanup block handles this with `-D` (force delete) inside a try/catch.

---

**Plan reviewed.** Two execution options:

- **Sequential mode** (subagents) — I dispatch a fresh subagent per task, two-stage review (spec then quality). Fast iteration.
- **Direct mode** (no subagents) — Execute tasks in this session with checkpoint reviews. Same quality discipline, no agent delegation.
