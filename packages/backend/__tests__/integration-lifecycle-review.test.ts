import { describe, it, expect, vi } from "vitest";
import { createIntegrationLifecycle } from "../src/orchestrator/integration-lifecycle";
import type { WorktreeManager } from "../src/orchestrator/worktree";
import type { WorkingUnit } from "@aurex/shared";

function makeWorktree(overrides: Partial<WorktreeManager> = {}): WorktreeManager {
  return {
    getRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
    createWorktree: vi.fn().mockResolvedValue({ worktreePath: "/fake/worktree", taskBranch: "task/test/unit" }),
    createBranch: vi.fn().mockResolvedValue(undefined),
    recreateBranch: vi.fn().mockResolvedValue(undefined),
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
  it("calls abortMerge on conflict before throwing", async () => {
    const worktree = makeWorktree({
      mergeToTarget: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("merge conflict")),
      mergeToTargetWithStrategy: vi.fn().mockRejectedValue(new Error("still conflicting")),
    });

    const lifecycle = createIntegrationLifecycle(worktree);
    await expect(lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [
        makeUnit("unit-1", "task/worker-unit-1/unit-1"),
        makeUnit("unit-2", "task/worker-unit-2/unit-2"),
      ],
    })).rejects.toThrow("Worker branches have merge conflicts: task/worker-unit-2/unit-2");

    expect(worktree.abortMerge).toHaveBeenCalledTimes(2);
    expect(worktree.recreateBranch).toHaveBeenCalledTimes(1);
    expect(worktree.recreateBranch).toHaveBeenCalledWith("integration/mission-1/1-ms-1", "main");
  });

  it("partial conflicts throw and do not create release branch", async () => {
    const worktree = makeWorktree();
    let callCount = 0;
    (worktree.mergeToTarget as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve();
      return Promise.reject(new Error("conflict"));
    });
    (worktree.mergeToTargetWithStrategy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("still conflicting"));

    const lifecycle = createIntegrationLifecycle(worktree);
    await expect(lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [
        makeUnit("unit-1", "task/worker-unit-1/unit-1"),
        makeUnit("unit-2", "task/worker-unit-2/unit-2"),
      ],
    })).rejects.toThrow("Worker branches have merge conflicts: task/worker-unit-2/unit-2");

    expect(worktree.recreateBranch).toHaveBeenCalledTimes(1);
    expect(worktree.recreateBranch).not.toHaveBeenCalledWith("release/mission-1/1-ms-1", expect.anything());
  });

  it("rejects ours fallback merges that would drop worker changes", async () => {
    const worktree = makeWorktree();
    (worktree.mergeToTarget as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("conflict"));
    (worktree.mergeToTargetWithStrategy as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const lifecycle = createIntegrationLifecycle(worktree);
    await expect(lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "task/worker-unit-1/unit-1")],
    })).rejects.toThrow(/drop changes/);

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
    })).rejects.toThrow("Worker branches have merge conflicts: task/worker-unit-1/unit-1");
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
      testCommands: ["; rm -rf /"],
    });

    expect(result.testFailure).toContain("rejected: contains disallowed characters");
  });
});
