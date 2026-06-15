import type { WorktreeManager } from "./worktree.js";

export interface OrderedBranchMergeResult {
  mergedBranches: string[];
  conflictedBranches: string[];
  /** Branches that only merged after -X ours (incoming changes may have been dropped). */
  oursFallbackBranches: string[];
}

type MergeManager = Pick<WorktreeManager, "mergeToTarget" | "mergeToTargetWithStrategy" | "abortMerge">;

export async function mergeBranchesWithOursFallback(
  worktreeManager: MergeManager,
  branches: string[],
  targetBranch: string,
): Promise<OrderedBranchMergeResult> {
  const mergedBranches: string[] = [];
  const conflictedBranches: string[] = [];
  const oursFallbackBranches: string[] = [];

  for (const branch of branches) {
    try {
      await worktreeManager.mergeToTarget(branch, targetBranch);
      mergedBranches.push(branch);
    } catch {
      try {
        await worktreeManager.abortMerge();
      } catch { /* nothing to abort */ }
      try {
        await worktreeManager.mergeToTargetWithStrategy(branch, targetBranch, "ours");
        mergedBranches.push(branch);
        oursFallbackBranches.push(branch);
      } catch {
        try {
          await worktreeManager.abortMerge();
        } catch { /* nothing to abort */ }
        conflictedBranches.push(branch);
      }
    }
  }

  return { mergedBranches, conflictedBranches, oursFallbackBranches };
}
