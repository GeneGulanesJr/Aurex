// packages/backend/src/enforcement/branch-guard.ts

export interface BranchCheckResult {
  allowed: boolean;
  reason?: string;
}

export function isBranchAllowed(branch: string): boolean {
  return branch.startsWith("task/");
}

export function validateCommitBranch(branch: string): BranchCheckResult {
  if (isBranchAllowed(branch)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Commits are only allowed on task/* branches. Current branch: "${branch}"`,
  };
}
