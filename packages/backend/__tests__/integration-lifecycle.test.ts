import { describe, it, expect, vi } from "vitest";
import { createIntegrationLifecycle } from "../src/orchestrator/integration-lifecycle";
import type { WorktreeManager } from "../src/orchestrator/worktree";
import type { WorkingUnit } from "@aurex/shared";

describe("integration lifecycle", () => {
  it("collects worker task branches, merges them into integration, and creates release branch", async () => {
    const worktree = {
      getRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
      createBranch: vi.fn().mockResolvedValue(undefined),
      recreateBranch: vi.fn().mockResolvedValue(undefined),
      mergeToTarget: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorktreeManager;

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

    expect(result).toEqual({
      integrationBranch: "integration/mission-1/1-ms-1",
      releaseBranch: "release/mission-1/1-ms-1",
      mergedBranches: ["task/worker-unit-1/unit-1", "task/worker-unit-2/unit-2"],
      conflictedBranches: [],
    });
    expect(worktree.recreateBranch).toHaveBeenNthCalledWith(1, "integration/mission-1/1-ms-1", "main");
    expect(worktree.mergeToTarget).toHaveBeenNthCalledWith(1, "task/worker-unit-1/unit-1", "integration/mission-1/1-ms-1");
    expect(worktree.mergeToTarget).toHaveBeenNthCalledWith(2, "task/worker-unit-2/unit-2", "integration/mission-1/1-ms-1");
    expect(worktree.recreateBranch).toHaveBeenNthCalledWith(2, "release/mission-1/1-ms-1", "integration/mission-1/1-ms-1");
  });

  it("ignores completed units without task branch data", async () => {
    const worktree = {
      getRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
      createBranch: vi.fn().mockResolvedValue(undefined),
      recreateBranch: vi.fn().mockResolvedValue(undefined),
      mergeToTarget: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorktreeManager;

    const lifecycle = createIntegrationLifecycle(worktree);
    const result = await lifecycle.integrate({
      missionId: "mission-1",
      milestoneId: "ms-1",
      milestoneOrderIndex: 0,
      baseBranch: "main",
      units: [makeUnit("unit-1", "")],
    });

    expect(result.mergedBranches).toEqual([]);
    expect(worktree.mergeToTarget).not.toHaveBeenCalled();
  });

  it("rejects integration when ours fallback would drop worker changes", async () => {
    const worktree = {
      getRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
      recreateBranch: vi.fn().mockResolvedValue(undefined),
      mergeToTarget: vi.fn()
        .mockRejectedValueOnce(new Error("conflict"))
        .mockResolvedValueOnce(undefined),
      mergeToTargetWithStrategy: vi.fn().mockResolvedValue(undefined),
      abortMerge: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorktreeManager;

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
    })).rejects.toThrow(/drop changes/);
  });
});

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
