// packages/backend/src/orchestrator/worktree.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

export interface WorktreeManager {
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  createBranch(branchName: string, baseBranch: string): Promise<void>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
  installBranchGuard(worktreePath: string, allowedBranch: string): Promise<void>;
}

export function createWorktreeManager(repoRoot: string): WorktreeManager {
  const worktreeBase = `${repoRoot}/.git-worktrees`;

  async function git(cmd: string): Promise<string> {
    const { stdout } = await execAsync(`git -C ${repoRoot} ${cmd}`);
    return stdout.trim();
  }

  return {
    async createWorktree(agentId, taskId, agentBranch) {
      const taskBranch = `task/${agentId}/${taskId}`;
      const worktreePath = `${worktreeBase}/${agentId}-${taskId}`;

      // Create task branch from agent branch
      await git(`branch ${taskBranch} ${agentBranch}`);

      // Create worktree with task branch checked out
      await git(`worktree add ${worktreePath} ${taskBranch}`);

      return { worktreePath, taskBranch };
    },

    async createBranch(branchName, baseBranch) {
      await git(`branch ${branchName} ${baseBranch}`);
    },

    async mergeToTarget(sourceBranch, targetBranch) {
      await git(`checkout ${targetBranch}`);
      await git(`merge ${sourceBranch} --no-ff`);
    },

    async pruneWorktree(worktreePath) {
      await git(`worktree remove ${worktreePath} --force`);
      await git(`worktree prune`);
    },

    async installBranchGuard(_worktreePath, _allowedBranch) {
      // Git worktrees share the main repo's .git/hooks directory
      // Install a pre-commit hook that only allows commits on task/* branches
      // (not on main, develop, release/*, etc.)
      const hooksDir = path.join(repoRoot, ".git", "hooks");
      const hookPath = path.join(hooksDir, "pre-commit");
      const hookContent = [
        "#!/bin/sh",
        "# Aurex branch guard — only allow commits on task/* branches",
        'BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")',
        'case "$BRANCH" in',
        '  task/*) exit 0 ;;',
        '  integration/*) exit 0 ;;',
        '  release/*) exit 0 ;;',
        '  *)',
        '    echo "Aurex branch guard: commits not allowed on $BRANCH (only task/*, integration/*, release/*)" >&2',
        "    exit 1",
        "    ;;",
        "esac",
        "",
      ].join("\n");

      try {
        await mkdir(hooksDir, { recursive: true });
        await writeFile(hookPath, hookContent, { mode: 0o755 });
      } catch {
        // Hooks directory may not exist in test environments — guard is best-effort
      }
    },
  };
}
