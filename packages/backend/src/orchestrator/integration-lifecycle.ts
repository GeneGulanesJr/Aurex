import type { WorkingUnit } from "@aurex/shared";
import type { WorktreeManager } from "./worktree.js";
import { mergeBranchesWithOursFallback } from "./branch-merge-service.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_TEST_COMMAND_PATTERN = /^[a-zA-Z0-9_./-]+(?: [a-zA-Z0-9_./=:"-]+)*$/;

function isSafeTestCommand(cmd: string): boolean {
  return ALLOWED_TEST_COMMAND_PATTERN.test(cmd) && !cmd.includes("..");
}

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
  /**
   * A branch that already contains a clean merge of every worker task branch
   * (typically the validator's `validation/<milestone>` branch). When
   * provided, integration bases the integration branch on it and skips
   * re-merging worker branches — avoiding redundant work and divergent
   * conflict outcomes between the validator and integration merge paths.
   */
  preMergedBaseBranch?: string;
}

export function createIntegrationLifecycle(worktreeManager: WorktreeManager) {
  return {
    async integrate(input: IntegrationLifecycleInput): Promise<IntegrationLifecycleResult> {
      const branchSuffix = `${input.missionId}/${input.milestoneOrderIndex + 1}-${input.milestoneId}`;
      const integrationBranch = `integration/${branchSuffix}`;
      const releaseBranch = `release/${branchSuffix}`;
      const inputBranches = input.units
        .map((unit) => unit.taskBranch)
        .filter((branch): branch is string => branch.trim().length > 0);

      // When the validator phase already merged all worker branches into a
      // single validation branch (the precondition for reaching integration),
      // reuse it as the integration base instead of re-merging every worker
      // branch from baseBranch. Re-merging duplicates work and — critically —
      // can conflict differently because the validator and this loop use
      // different merge code paths. A conflict "resolved" by the validator's
      // sequential retry must not re-emerge here.
      const preMergedBase = input.preMergedBaseBranch;
      let mergedBranches: string[];
      let conflictedBranches: string[] = [];
      let oursFallbackBranches: string[] = [];

      if (preMergedBase && preMergedBase.trim().length > 0) {
        // The validation branch already contains every worker's changes.
        // Build the integration branch directly on top of it; no per-branch
        // merges needed.
        await worktreeManager.recreateBranch(integrationBranch, preMergedBase);
        mergedBranches = [...inputBranches];
      } else {
        await worktreeManager.recreateBranch(integrationBranch, input.baseBranch);
        const merged = await mergeBranchesWithOursFallback(
          worktreeManager,
          inputBranches,
          integrationBranch,
        );
        mergedBranches = merged.mergedBranches;
        conflictedBranches = merged.conflictedBranches;
        oursFallbackBranches = merged.oursFallbackBranches;
      }

      if (conflictedBranches.length > 0) {
        throw new Error(`Worker branches have merge conflicts: ${conflictedBranches.join(", ")}`);
      }
      if (oursFallbackBranches.length > 0) {
        throw new Error(
          `Worker branches required conflict resolution that would drop changes: ${oursFallbackBranches.join(", ")}`,
        );
      }

      await worktreeManager.recreateBranch(releaseBranch, integrationBranch);

      let testFailure: string | undefined;
      if (input.testCommands && input.testCommands.length > 0) {
        for (const cmd of input.testCommands) {
          if (!isSafeTestCommand(cmd)) {
            testFailure = (testFailure ? testFailure + "\n" : "") +
              `Command '${cmd.slice(0, 100)}' rejected: contains disallowed characters`;
            continue;
          }
          try {
            await execFileAsync("bash", ["-c", cmd], {
              cwd: worktreeManager.getRepoRoot(),
              timeout: 120_000,
              maxBuffer: 1024 * 1024,
            });
          } catch (err: unknown) {
            const stderr = (err instanceof Error && "stderr" in err)
              ? String((err as { stderr: string }).stderr).slice(0, 200)
              : "";
            const message = err instanceof Error ? err.message : String(err);
            testFailure = (testFailure ? testFailure + "\n" : "") +
              `Command '${cmd}' failed: ${stderr || message}`;
          }
        }
      }

      return { integrationBranch, releaseBranch, mergedBranches, conflictedBranches, testFailure };
    },
  };
}
