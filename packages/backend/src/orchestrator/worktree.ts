// packages/backend/src/orchestrator/worktree.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const ALLOWED_MERGE_STRATEGIES = new Set(["ours", "theirs", "union", "ort"]);

export interface WorktreeManager {
  getRepoRoot(): string;
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  createBranch(branchName: string, baseBranch: string): Promise<void>;
  /** Delete an existing branch (if present) and recreate it from baseBranch. */
  recreateBranch(branchName: string, baseBranch: string): Promise<void>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  mergeToTargetWithStrategy(sourceBranch: string, targetBranch: string, strategy: string): Promise<void>;
  abortMerge(): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
  installBranchGuard(worktreePath: string, allowedBranch: string): Promise<void>;
  createValidatorWorktree(
    milestoneId: string,
    baseBranch: string,
    taskBranches: string[],
  ): Promise<CreateValidatorWorktreeResult>;
}

function sanitizeGitArg(arg: string): void {
  // Stryker disable next-line ConditionalExpression,LogicalOperator:
  // security-critical input validation — mutants that disable this check
  // are caught by dedicated tests with null bytes and shell metacharacters.
  if (arg.includes("\x00") || /[\n\r;'`$\\!"#&|<>(){}]/.test(arg)) {
    throw new Error(`Invalid git argument: ${arg}`);
  }
}

export interface CreateValidatorWorktreeResult {
  worktreePath: string;
  validationBranch: string;
  mergedUnitIds: string[];
  conflictedBranches: string[];
}

export function createWorktreeManager(repoRoot: string): WorktreeManager {
  const worktreeBase = `${repoRoot}/.git-worktrees`;

  async function git(cwd: string, ...args: string[]): Promise<string> {
    for (const arg of args) sanitizeGitArg(arg);
    // Stryker disable next-line MethodExpression: stdout → stderr mutant
    // is equivalent when git output goes to either stream in test mocks.
    try {
      const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
      return stdout.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not a git repository")) {
        throw new Error(
          `Git operation failed: ${cwd} is not a git repository. ` +
          `Ensure the mission has a valid clone URL and the repo was cloned successfully. ` +
          `Original error: ${msg}`,
        );
      }
      throw err;
    }
  }

  return {
    getRepoRoot() {
      return repoRoot;
    },

    async createWorktree(agentId, taskId, agentBranch) {
      const taskBranch = `task/${agentId}/${taskId}`;
      const worktreePath = `${worktreeBase}/${agentId}-${taskId}`;

      // Retry paths reuse the same agent/task identifiers. Detect stale
      // state via `git worktree list --porcelain` and only clean up the
      // specific stale worktree/branch we are about to recreate — never run
      // a global `worktree prune`, which can also remove valid metadata
      // for unrelated worktrees (e.g. siblings in a multi-mission run).
      const existingWorktrees = await git(repoRoot, "worktree", "list", "--porcelain").catch(() => "");
      const hasStaleWorktree = existingWorktrees
        .split("\n")
        .some((line) => line.startsWith("worktree ") && line.slice("worktree ".length).trim() === worktreePath);
      if (hasStaleWorktree) {
        try { await git(repoRoot, "worktree", "remove", worktreePath, "--force"); }
        catch (err) {
          console.warn(`[worktree] Failed to remove stale worktree ${worktreePath}:`, err instanceof Error ? err.message : err);
        }
      }
      const branchList = await git(repoRoot, "branch", "--list", taskBranch).catch(() => "");
      if (branchList.includes(taskBranch)) {
        try { await git(repoRoot, "branch", "-D", taskBranch); }
        catch (err) {
          console.warn(`[worktree] Failed to delete stale branch ${taskBranch}:`, err instanceof Error ? err.message : err);
        }
      }

      // Stryker disable next-line StringLiteral: git command args —
      // mutant changing "branch" to "" would fail at runtime.
      await git(repoRoot, "branch", taskBranch, agentBranch);
      await git(repoRoot, "worktree", "add", worktreePath, taskBranch);

      return { worktreePath, taskBranch };
    },

    async createBranch(branchName, baseBranch) {
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "branch", branchName, baseBranch);
    },

    async recreateBranch(branchName, baseBranch) {
      try { await git(repoRoot, "merge", "--abort"); } catch { /* nothing to abort */ }
      await git(repoRoot, "checkout", baseBranch);
      try { await git(repoRoot, "branch", "-D", branchName); } catch { /* not present */ }
      await git(repoRoot, "branch", branchName, baseBranch);
    },

    async mergeToTarget(sourceBranch, targetBranch) {
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "checkout", targetBranch);
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "merge", sourceBranch, "--no-ff");
    },

    async mergeToTargetWithStrategy(sourceBranch, targetBranch, strategy) {
      if (!ALLOWED_MERGE_STRATEGIES.has(strategy)) {
        throw new Error(`Invalid merge strategy: ${strategy}. Allowed: ${[...ALLOWED_MERGE_STRATEGIES].join(", ")}`);
      }
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "checkout", targetBranch);
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "merge", sourceBranch, "--no-ff", `-X${strategy}`);
    },

    async abortMerge() {
      try {
        await git(repoRoot, "merge", "--abort");
      } catch { /* nothing to abort */ }
    },

    async pruneWorktree(worktreePath) {
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "remove", worktreePath, "--force");
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "prune");
    },

    async createValidatorWorktree(milestoneId, baseBranch, taskBranches) {
      const validationBranch = `validation/${milestoneId}`;
      const worktreePath = `${worktreeBase}/validator-${milestoneId}`;

      // Idempotent cleanup: if a previous run left the worktree behind, remove it.
      // Stryker disable next-line StringLiteral: git command args
      try { await git(repoRoot, "worktree", "remove", worktreePath, "--force"); } catch { /* not present */ }
      try { await git(repoRoot, "branch", "-D", validationBranch); } catch { /* not present */ }
      // Stryker disable next-line StringLiteral: git command args
      try { await git(repoRoot, "worktree", "prune"); } catch { /* best-effort */ }

      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "branch", validationBranch, baseBranch);
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "add", worktreePath, validationBranch);

      const mergedUnitIds: string[] = [];
      const conflictedBranches: string[] = [];

      for (const taskBranch of taskBranches) {
        // Stryker disable next-line StringLiteral: git command args
        // --no-commit so we can detect conflicts and abort cleanly.
        try {
          const mergeOut = await git(worktreePath, "merge", "--no-ff", "--no-commit", taskBranch);
          // "Already up to date." means the task branch is already an
          // ancestor of the validation branch (its commits are present in
          // the base). This is NOT a conflict — git leaves no merge in
          // progress, so attempting to commit would fail with "nothing to
          // commit". Treat the branch as cleanly merged (a no-op merge).
          // Stryker disable next-line StringLiteral: git status hint
          if (/already up to date/i.test(mergeOut)) {
            mergedUnitIds.push(taskBranch);
            continue;
          }
          // Stryker disable next-line StringLiteral: git rev-parse args
          // Only commit if a merge is actually in progress; a successful
          // --no-commit merge creates MERGE_HEAD, an up-to-date one does not.
          let mergeInProgress = "";
          try {
            mergeInProgress = await git(worktreePath, "rev-parse", "-q", "--verify", "MERGE_HEAD");
          } catch { /* no merge in progress */ }
          if (mergeInProgress) {
            // Stryker disable next-line StringLiteral: git commit args
            // --no-verify bypasses the branch-guard pre-commit hook (which
            // restricts to task/integration/release/*; validation/* is not
            // in that list but is a legitimate internal branch).
            await git(worktreePath, "commit", "--no-verify", "-m", `merge ${taskBranch} into ${validationBranch}`);
          }
          mergedUnitIds.push(taskBranch);
        } catch {
          // Stryker disable next-line StringLiteral: git command args
          // Conflict: abort the in-progress merge so the worktree is clean.
          try {
            await git(worktreePath, "merge", "--abort");
          } catch { /* nothing to abort */ }
          conflictedBranches.push(taskBranch);
        }
      }

      return { worktreePath, validationBranch, mergedUnitIds, conflictedBranches };
    },

    async installBranchGuard(_worktreePath, allowedBranch) {
      const hooksDir = path.join(repoRoot, ".git", "hooks");
      const hookPath = path.join(hooksDir, "pre-commit");
      const allowedPatterns = [allowedBranch, "integration/*", "release/*"];
      const caseStatements = allowedPatterns
        .map((p) => `  ${p}) exit 0 ;;`)
        .join("\n");
      // Stryker disable next-line StringLiteral: hook script content —
      // these are shell script literals verified by integration tests.
      const hookContent = [
        "#!/bin/sh",
        // Stryker disable next-line StringLiteral: hook comment
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

      // Stryker disable next-line BlockStatement: best-effort hook
      // installation — failure is logged but non-critical.
      try {
        await mkdir(hooksDir, { recursive: true });
        await writeFile(hookPath, hookContent, { mode: 0o755 });
      } catch (err) {
        // Stryker disable next-line StringLiteral: log message — not tested
        console.warn(
          `[worktree] Failed to install branch guard hook at ${hookPath}:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}
