import type { WorkingUnit } from "@aurex/shared";
import type { WorktreeManager } from "./worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface IntegrationLifecycleResult {
  integrationBranch: string;
  releaseBranch: string;
  mergedBranches: string[];
  conflictedBranches: string[];
  testFailure?: string;
  [k: string]: unknown;
}

export interface IntegrationLifecycleInput {
  missionId: string;
  milestoneId: string;
  milestoneOrderIndex: number;
  baseBranch: string;
  units: WorkingUnit[];
  testCommands?: string[];
}

export function createIntegrationLifecycle(worktreeManager: WorktreeManager) {
  return {
    async integrate(input: IntegrationLifecycleInput): Promise<IntegrationLifecycleResult> {
      const branchSuffix = `${input.missionId}/${input.milestoneOrderIndex + 1}-${input.milestoneId}`;
      const integrationBranch = `integration/${branchSuffix}`;
      const releaseBranch = `release/${branchSuffix}`;
      const mergedBranches_input = input.units
        .map((unit) => unit.taskBranch)
        .filter((branch): branch is string => branch.trim().length > 0);
      await worktreeManager.createBranch(integrationBranch, input.baseBranch);

      const mergedBranches: string[] = [];
      const conflictedBranches: string[] = [];

      for (const branch of mergedBranches_input) {
        try {
          await worktreeManager.mergeToTarget(branch, integrationBranch);
          mergedBranches.push(branch);
        } catch {
          // Try "ours" strategy to auto-resolve simple conflicts
          try {
            await worktreeManager.mergeToTargetWithStrategy(branch, integrationBranch, "ours");
            mergedBranches.push(branch);
          } catch {
            conflictedBranches.push(branch);
          }
        }
      }

      if (conflictedBranches.length > 0 && conflictedBranches.length === mergedBranches_input.length) {
        throw new Error(`All worker branches have merge conflicts: ${conflictedBranches.join(", ")}`);
      }

      await worktreeManager.createBranch(releaseBranch, integrationBranch);

      // Run contract test commands on the integration branch before finalizing.
      // Best-effort — if tests fail, report the failure in the result.
      let testFailure: string | undefined;
      if (input.testCommands && input.testCommands.length > 0) {
        for (const cmd of input.testCommands) {
          try {
            await execFileAsync("bash", ["-c", cmd], {
              cwd: worktreeManager.getRepoRoot(),
              timeout: 120_000,
              maxBuffer: 1024 * 1024,
            });
          } catch (err: any) {
            testFailure = (testFailure ? testFailure + "\n" : "") +
              `Command '${cmd}' failed: ${err.stderr?.slice(0, 200) || err.message}`;
          }
        }
      }

      return { integrationBranch, releaseBranch, mergedBranches, conflictedBranches, testFailure };
    },
  };
}
