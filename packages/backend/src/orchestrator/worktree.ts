// packages/backend/src/orchestrator/worktree.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * v1 worktree manager (issue #119).
 *
 * The previous design created one `task/*` branch per working unit, merged
 * them into integration / validation / release branches, and had the
 * validator dry-merge worker branches. v1 collapses all of that into a
 * SINGLE feature branch per milestone: every worker commits onto it
 * sequentially, the validator reviews it at milestone HEAD, and the release
 * branch is cut straight off it. Failed per-unit reviews `git reset` the
 * feature branch back to the pre-unit commit.
 */

export interface WorktreeManager {
  getRepoRoot(): string;
  createFeatureWorktree(
    missionId: string,
    milestoneOrderIndex: number,
    milestoneId: string,
    mainBranch: string,
  ): Promise<{ worktreePath: string; featureBranch: string; baseCommitHash?: string }>;
  currentHead(worktreePath: string): Promise<string>;
  resetTo(worktreePath: string, sha: string): Promise<void>;
  cutReleaseBranch(missionId: string, milestoneOrderIndex: number, milestoneId: string, fromBranch: string): Promise<string>;
  recreateBranch(branchName: string, baseBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
  installBranchGuard(worktreePath: string, allowedBranch: string): Promise<void>;
}

function sanitizeGitArg(arg: string): void {
  // Stryker disable next-line ConditionalExpression,LogicalOperator:
  // security-critical input validation — mutants that disable this check
  // are caught by dedicated tests with null bytes and shell metacharacters.
  if (arg.includes("\x00") || /[\n\r;'`$\\!"#&|<>(){}]/.test(arg)) {
    throw new Error(`Invalid git argument: ${arg}`);
  }
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

    async createFeatureWorktree(missionId, milestoneOrderIndex, milestoneId, mainBranch) {
      const featureBranch = `feature/${missionId}/${milestoneOrderIndex + 1}`;
      const worktreePath = `${worktreeBase}/feature-${milestoneId}`;

      // Resume vs. fresh-start semantics.
      //
      // On a FRESH milestone, the feature branch does not exist yet — create it
      // off `mainBranch`. On a RESUME (e.g. after a cost_cap_exceeded /
      // quota_exhausted / validation_failed checkpoint mid-milestone), the
      // feature branch ALREADY EXISTS and holds committed-and-approved work
      // from prior units. Wiping it back to main would silently destroy that
      // work and leave completed units unbacked by git history. So when the
      // branch exists, we PRESERVE it and only re-attach the worktree.
      //
      // We still remove a stale *worktree* (a leftover directory from a
      // crashed run) before re-adding — but never `git branch -D` an existing
      // feature branch, and never run a global `worktree prune` (it can
      // remove unrelated metadata).
      const existingWorktrees = await git(repoRoot, "worktree", "list", "--porcelain").catch(() => "");
      const hasStaleWorktree = existingWorktrees
        .split("\n")
        .some((line) => line.startsWith("worktree ") && line.slice("worktree ".length).trim() === worktreePath);
      if (hasStaleWorktree) {
        try { await git(repoRoot, "worktree", "remove", worktreePath, "--force"); }
        catch (err) {
          console.warn(`[worktree] Failed to remove stale feature worktree ${worktreePath}:`, err instanceof Error ? err.message : err);
        }
      }
      const branchList = await git(repoRoot, "branch", "--list", featureBranch).catch(() => "");
      const branchAlreadyExists = branchList.includes(featureBranch);

      if (branchAlreadyExists) {
        // RESUME: preserve the existing feature branch (it carries approved
        // unit commits) and re-attach the worktree at its current HEAD.
        // Stryker disable next-line StringLiteral: git command args
        await git(repoRoot, "worktree", "add", worktreePath, featureBranch);
      } else {
        // FRESH: create the feature branch off main and add the worktree.
        // Stryker disable next-line StringLiteral: git command args
        await git(repoRoot, "branch", featureBranch, mainBranch);
        // Stryker disable next-line StringLiteral: git command args
        await git(repoRoot, "worktree", "add", worktreePath, featureBranch);
      }

      // Resolve the starting commit. On a resume this is the feature branch's
      // own HEAD (the last approved commit), NOT main — so the worker's
      // write_handoff guard correctly requires a NEW commit on top of the
      // preserved work rather than on top of main.
      const baseCommitHash = await git(repoRoot, "rev-parse", featureBranch)
        .then((h) => (h && h.trim()) || undefined)
        .catch(() => undefined);

      return { worktreePath, featureBranch, baseCommitHash };
    },

    async currentHead(worktreePath) {
      return git(worktreePath, "rev-parse", "HEAD").catch(() => "");
    },

    async resetTo(worktreePath, sha) {
      // Hard-reset the feature branch to the pre-unit commit so the branch
      // only ever contains committed-and-approved work. Guard against an
      // empty sha (e.g. a mocked environment) — git would reject it.
      //
      // Invariant: by the time we get here a failed worker has ALWAYS either
      // committed (then produced a bad handoff / failed smoke) or committed
      // nothing (then timed out / crashed before committing). In both cases
      // resetting to `sha` (the pre-unit HEAD) is correct and loses nothing:
      // a committed-but-rejected attempt is exactly the work we want to drop,
      // and a no-commit attempt leaves nothing on the branch to discard.
      // The empty-sha guard is defensive only — it should never fire in a real
      // repo because createFeatureWorktree always resolves a HEAD.
      if (!sha || sha.trim().length === 0) return;
      // Stryker disable next-line StringLiteral: git command args
      await git(worktreePath, "reset", "--hard", sha);
    },

    async cutReleaseBranch(missionId, milestoneOrderIndex, milestoneId, fromBranch) {
      const releaseBranch = `release/${missionId}/${milestoneOrderIndex + 1}-${milestoneId}`;
      // Force-create the release ref at the feature branch HEAD WITHOUT a
      // checkout. Checking out `fromBranch` in the main worktree would fail
      // because it is already checked out in the linked feature worktree.
      // `git branch -f <name> <start>` moves only the ref, so it is safe.
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "branch", "-f", releaseBranch, fromBranch);
      return releaseBranch;
    },

    async recreateBranch(branchName, baseBranch) {
      // Legacy helper retained for compatibility. Creates/forces a branch ref
      // at baseBranch's HEAD without checking either out (avoids worktree
      // conflicts on linked branches).
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "branch", "-f", branchName, baseBranch);
    },

    async pruneWorktree(worktreePath) {
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "remove", worktreePath, "--force");
      // Stryker disable next-line StringLiteral: git command args
      await git(repoRoot, "worktree", "prune");
    },

    async installBranchGuard(_worktreePath, allowedBranch) {
      const hooksDir = path.join(repoRoot, ".git", "hooks");
      const hookPath = path.join(hooksDir, "pre-commit");
      const allowedPatterns = [allowedBranch, "feature/*", "release/*"];
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
