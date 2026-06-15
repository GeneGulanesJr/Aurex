import { describe, it, expect, vi } from "vitest";
import { mergeBranchesWithOursFallback } from "../src/orchestrator/branch-merge-service";

describe("branch-merge-service", () => {
  it("merges branches and retries with ours strategy on conflict", async () => {
    const mergeToTarget = vi.fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(undefined);
    const mergeToTargetWithStrategy = vi.fn().mockResolvedValue(undefined);
    const abortMerge = vi.fn().mockResolvedValue(undefined);

    const result = await mergeBranchesWithOursFallback(
      { mergeToTarget, mergeToTargetWithStrategy, abortMerge },
      ["task/a", "task/b"],
      "integration/m-1",
    );

    expect(result.mergedBranches).toEqual(["task/a", "task/b"]);
    expect(result.conflictedBranches).toEqual([]);
    expect(result.oursFallbackBranches).toEqual(["task/a"]);
    expect(abortMerge).toHaveBeenCalledTimes(1);
    expect(mergeToTargetWithStrategy).toHaveBeenCalledWith("task/a", "integration/m-1", "ours");
  });

  it("records conflicted branches when ours fallback also fails", async () => {
    const mergeToTarget = vi.fn().mockRejectedValue(new Error("conflict"));
    const mergeToTargetWithStrategy = vi.fn().mockRejectedValue(new Error("still conflict"));
    const abortMerge = vi.fn().mockResolvedValue(undefined);

    const result = await mergeBranchesWithOursFallback(
      { mergeToTarget, mergeToTargetWithStrategy, abortMerge },
      ["task/a"],
      "integration/m-1",
    );

    expect(result.mergedBranches).toEqual([]);
    expect(result.conflictedBranches).toEqual(["task/a"]);
    expect(result.oursFallbackBranches).toEqual([]);
  });
});
