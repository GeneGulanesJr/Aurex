// packages/backend/src/orchestrator/worktree.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface WorktreeManager {
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  createBranch(branchName: string, baseBranch: string): Promise<void>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
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
  };
}
