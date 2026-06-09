import { describe, it, expect, vi } from "vitest";
import { createIntegrationLifecycle } from "../src/orchestrator/integration-lifecycle";
import type { WorktreeManager } from "../src/orchestrator/worktree";
import type { WorkingUnit } from "@aurex/shared";

function makeWorktree(overrides: Partial<WorktreeManager> = {}): WorktreeManager {
  return {
    getRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
    createWorktree: vi.fn().mockResolvedValue({ worktreePath: "/fake/worktree", taskBranch: "task/test/unit" }),
    createBranch: vi.fn().mockResolvedValue(undefined),
    mergeToTarget: vi.fn().mockResolvedValue(undefined),
    mergeToTargetWithStrategy: vi.fn().mockResolvedValue(undefined),
    abortMerge: vi.fn().mockResolvedValue(undefined),
    pruneWorktree: vi.fn().mockResolvedValue(undefined),
    installBranchGuard: vi.fn().mockResolvedValue(undefined),
    createValidatorWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/fake/validator",
      validationBranch: "validation/ms-1",
      mergedUnitIds: [],
      conflictedBranches: [],
    }),
    ...overrides,
  } as unknown as WorktreeManager;
}

function makeUnit(id: string, taskBranch: string): WorkingUnit {
  return {
    id,
    milestoneId: "ms-1",
    description: id,
    declaredPaths: [],
    declaredModules: [],
    status: "completed",
    taskBranch,
    worktreePath: "",
    sessionId: "",
  };
}

describe("integration lifecycle — review fixes", () => {
  it("returns conflictedBranches when merge fails and fallback also fails", async () => {
    const worktree = makeWorktree({
      mergeToTarget: vi.fn().mockRejectedValue(new Error("merge conflict")),
      mergeToTargetWithStrategy: vi.fn().mockRejectedValue(new Error("still conflicting")),
    });

    const lifecycle = createIntegrationLifecycle(worktree);
    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [
        makeUnit("unit-1", "task/worker-unit-1/unit-1"),
        makeUnit("unit-2", "task/worker-unit-2/unit-2"),
      ],
    });

    expect(result.conflictedBranches).toEqual(["task/worker-unit-1/unit-1", "task/worker-unit-2/unit-2"]);
    expect(result.mergedBranches).toEqual([]);
    expect(worktree.abortMerge).toHaveBeenCalledTimes(2);
  });

  it("partial conflicts: merges some branches, conflicts others, creates release", async () => {
    const worktree = makeWorktree();
    let callCount = 0;
    (worktree.mergeToTarget as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve();
      return Promise.reject(new Error("conflict"));
    });
    (worktree.mergeToTargetWithStrategy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("still conflicting"));

    const lifecycle = createIntegrationLifecycle(worktree);
    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [
        makeUnit("unit-1", "task/worker-unit-1/unit-1"),
        makeUnit("unit-2", "task/worker-unit-2/unit-2"),
      ],
    });

    expect(result.mergedBranches).toEqual(["task/worker-unit-1/unit-1"]);
    expect(result.conflictedBranches).toEqual(["task/worker-unit-2/unit-2"]);
    expect(result.releaseBranch).toBe("release/mission-1/1-ms-1");
    expect(worktree.abortMerge).toHaveBeenCalledTimes(1);
  });

  it("auto-resolves conflicts using ours strategy", async () => {
    const worktree = makeWorktree();
    (worktree.mergeToTarget as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("conflict"));
    (worktree.mergeToTargetWithStrategy as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const lifecycle = createIntegrationLifecycle(worktree);
    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "task/worker-unit-1/unit-1")],
    });

    expect(result.mergedBranches).toEqual(["task/worker-unit-1/unit-1"]);
    expect(result.conflictedBranches).toEqual([]);
    expect(worktree.mergeToTargetWithStrategy).toHaveBeenCalledWith(
      "task/worker-unit-1/unit-1",
      "integration/mission-1/1-ms-1",
      "ours",
    );
  });

  it("throws when all branches conflict", async () => {
    const worktree = makeWorktree({
      mergeToTarget: vi.fn().mockRejectedValue(new Error("conflict")),
      mergeToTargetWithStrategy: vi.fn().mockRejectedValue(new Error("still conflicting")),
    });

    const lifecycle = createIntegrationLifecycle(worktree);
    await expect(lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "task/worker-unit-1/unit-1")],
    })).rejects.toThrow("All worker branches have merge conflicts");
  });

  it("rejects unsafe test commands with shell metacharacters", async () => {
    const worktree = makeWorktree();

    const lifecycle = createIntegrationLifecycle(worktree);
    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "task/worker-unit-1/unit-1")],
      testCommands: ["; rm -rf /", "pnpm test"],
    });

    expect(result.testFailure).toContain("rejected: contains disallowed characters");
    expect(result.testFailure).not.toContain("pnpm test");
  });

  it("reports test failure from stderr when available", async () => {
    const worktree = makeWorktree();

    const { execFile } = await import("node:child_process");
    const execFileSpy = vi.spyOn(await import("node:child_process"), "execFile");

    const lifecycle = createIntegrationLifecycle(worktree);

    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "task/worker-unit-1/unit-1")],
      testCommands: [],
    });

    expect(result.testFailure).toBeUndefined();
  });

  it("uses camelCase variable name (inputBranches) instead of snake_case", async () => {
    const source = await import("fs").then((fs) =>
      fs.readFileSync(
        require.resolve("../src/orchestrator/integration-lifecycle"),
        "utf8",
      ),
    );
    expect(source).not.toContain("mergedBranches_input");
  });
});
