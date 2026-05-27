import type { WorkingUnit } from "@aurex/shared";
import type { WorktreeManager } from "./worktree";

export interface IntegrationLifecycleResult {
  integrationBranch: string;
  releaseBranch: string;
  mergedBranches: string[];
}

export interface IntegrationLifecycleInput {
  missionId: string;
  milestoneId: string;
  milestoneOrderIndex: number;
  baseBranch: string;
  units: WorkingUnit[];
}

export function createIntegrationLifecycle(worktreeManager: WorktreeManager) {
  return {
    async integrate(input: IntegrationLifecycleInput): Promise<IntegrationLifecycleResult> {
      const branchSuffix = `${input.missionId}/${input.milestoneOrderIndex + 1}-${input.milestoneId}`;
      const integrationBranch = `integration/${branchSuffix}`;
      const releaseBranch = `release/${branchSuffix}`;
      const mergedBranches = input.units
        .map((unit) => unit.taskBranch)
        .filter((branch): branch is string => branch.trim().length > 0);

      await worktreeManager.createBranch(integrationBranch, input.baseBranch);

      for (const branch of mergedBranches) {
        await worktreeManager.mergeToTarget(branch, integrationBranch);
      }

      await worktreeManager.createBranch(releaseBranch, integrationBranch);

      return { integrationBranch, releaseBranch, mergedBranches };
    },
  };
}
