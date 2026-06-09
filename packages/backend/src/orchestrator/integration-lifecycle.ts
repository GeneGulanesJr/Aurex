import type { WorkingUnit } from "@aurex/shared";
import type { WorktreeManager } from "./worktree.js";
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

      await worktreeManager.createBranch(integrationBranch, input.baseBranch);

      const mergedBranches: string[] = [];
      const conflictedBranches: string[] = [];

      for (const branch of inputBranches) {
        try {
          await worktreeManager.mergeToTarget(branch, integrationBranch);
          mergedBranches.push(branch);
        } catch {
          // Abort the failed merge before trying an alternative strategy,
          // otherwise git refuses to start a new merge while one is in progress.
          try {
            await worktreeManager.abortMerge();
          } catch { /* nothing to abort */ }
          try {
            await worktreeManager.mergeToTargetWithStrategy(branch, integrationBranch, "ours");
            mergedBranches.push(branch);
          } catch {
            try {
              await worktreeManager.abortMerge();
            } catch { /* nothing to abort */ }
            conflictedBranches.push(branch);
          }
        }
      }

      if (conflictedBranches.length > 0 && conflictedBranches.length === inputBranches.length) {
        throw new Error(`All worker branches have merge conflicts: ${conflictedBranches.join(", ")}`);
      }

      await worktreeManager.createBranch(releaseBranch, integrationBranch);

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
