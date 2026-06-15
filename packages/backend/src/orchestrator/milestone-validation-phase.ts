import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ValidatorUnitContext } from "../agents/context-builder.js";

const execFileAsync = promisify(execFile);

export async function collectValidatorDiffSummary(
  validatorUnits: ValidatorUnitContext[],
  baseBranch: string,
): Promise<string> {
  const diffParts: string[] = [];
  for (const vu of validatorUnits) {
    if (!vu.taskBranch || !vu.worktreePath) continue;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", vu.worktreePath, "diff", `${baseBranch}...HEAD`, "--"],
        { maxBuffer: 1024 * 1024 },
      );
      if (stdout.trim()) {
        diffParts.push(`--- Unit: ${vu.id} (${vu.taskBranch}) ---\n${stdout}`);
      }
    } catch {
      // Branch may not exist or no diff available — skip
    }
  }
  return diffParts.join("\n\n");
}
