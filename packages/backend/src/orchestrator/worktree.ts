// packages/backend/src/orchestrator/worktree.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface WorktreeManager {
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  createBranch(branchName: string, baseBranch: string): Promise<void>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
  installBranchGuard(worktreePath: string, allowedBranch: string): Promise<void>;
}

function sanitizeGitArg(arg: string): void {
  if (arg.includes("\x00") || /[\n\r;'`$\\!"#&|<>(){}]/.test(arg)) {
    throw new Error(`Invalid git argument: ${arg}`);
  }
}

export function createWorktreeManager(repoRoot: string): WorktreeManager {
  const worktreeBase = `${repoRoot}/.git-worktrees`;

  async function git(...args: string[]): Promise<string> {
    for (const arg of args) sanitizeGitArg(arg);
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args]);
    return stdout.trim();
  }

  return {
    async createWorktree(agentId, taskId, agentBranch) {
      const taskBranch = `task/${agentId}/${taskId}`;
      const worktreePath = `${worktreeBase}/${agentId}-${taskId}`;

      await git("branch", taskBranch, agentBranch);
      await git("worktree", "add", worktreePath, taskBranch);

      return { worktreePath, taskBranch };
    },

    async createBranch(branchName, baseBranch) {
      await git("branch", branchName, baseBranch);
    },

    async mergeToTarget(sourceBranch, targetBranch) {
      await git("checkout", targetBranch);
      await git("merge", sourceBranch, "--no-ff");
    },

    async pruneWorktree(worktreePath) {
      await git("worktree", "remove", worktreePath, "--force");
      await git("worktree", "prune");
    },

    async installBranchGuard(_worktreePath, allowedBranch) {
      const hooksDir = path.join(repoRoot, ".git", "hooks");
      const hookPath = path.join(hooksDir, "pre-commit");
      const allowedPatterns = [allowedBranch, "integration/*", "release/*"];
      const caseStatements = allowedPatterns
        .map((p) => `  ${p}) exit 0 ;;`)
        .join("\n");
      const hookContent = [
        "#!/bin/sh",
        "# Aurex branch guard — only allow commits on permitted branches",
        'BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")',
        'case "$BRANCH" in',
        caseStatements,
        "  *)",
        '    echo "Aurex branch guard: commits not allowed on $BRANCH (only ' + allowedPatterns.join(", ") + ')" >&2',
        "    exit 1",
        "    ;;",
        "esac",
        "",
      ].join("\n");

      try {
        await mkdir(hooksDir, { recursive: true });
        await writeFile(hookPath, hookContent, { mode: 0o755 });
      } catch (err) {
        console.warn(
          `[worktree] Failed to install branch guard hook at ${hookPath}:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}
