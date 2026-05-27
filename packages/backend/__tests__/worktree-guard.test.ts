import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorktreeManager } from "../src/orchestrator/worktree";

describe("worktree manager — branch guard hooks", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "aurex-worktree-guard-"));
    // Initialize a real git repo
    await git(repoRoot, "init", "-b", "main");
    await git(repoRoot, "config", "user.email", "aurex@test.com");
    await git(repoRoot, "config", "user.name", "Aurex Test");
    await writeFile(path.join(repoRoot, "README.md"), "test\n");
    await git(repoRoot, "add", ".");
    await git(repoRoot, "commit", "-m", "init");
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("installs pre-commit hook in new worktree", async () => {
    const manager = createWorktreeManager(repoRoot);

    const { worktreePath, taskBranch } = await manager.createWorktree(
      "worker-1", "u-1", "main",
    );

    // Install branch guard hooks
    await manager.installBranchGuard(worktreePath, taskBranch);

    // Check that the pre-commit hook exists and allows task/* branches
    const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
    const hookContent = await readFile(hookPath, "utf-8");
    expect(hookContent).toContain("task/*");
    expect(hookContent).toContain("branch guard");

    // Clean up worktree
    await manager.pruneWorktree(worktreePath);
  });

  it("pre-commit hook rejects commits on main", async () => {
    const manager = createWorktreeManager(repoRoot);

    const { worktreePath, taskBranch } = await manager.createWorktree(
      "worker-2", "u-2", "main",
    );

    await manager.installBranchGuard(worktreePath, taskBranch);

    // Try to commit on main branch
    await git(repoRoot, "checkout", "main");
    await writeFile(path.join(repoRoot, "test.txt"), "data\n");

    let commitFailed = false;
    try {
      await git(repoRoot, "add", ".");
      await git(repoRoot, "commit", "-m", "should fail");
    } catch {
      commitFailed = true;
    }

    expect(commitFailed).toBe(true);

    await manager.pruneWorktree(worktreePath);
  });

  it("pre-commit hook allows commits on task/* branches", async () => {
    const manager = createWorktreeManager(repoRoot);

    const { worktreePath, taskBranch } = await manager.createWorktree(
      "worker-3", "u-3", "main",
    );

    await manager.installBranchGuard(worktreePath, taskBranch);

    // The worktree should already be on a task/* branch
    await writeFile(path.join(worktreePath, "test.txt"), "data\n");
    await git(worktreePath, "add", ".");
    await git(worktreePath, "commit", "-m", "should succeed");

    // Verify the commit was created
    const log = await git(worktreePath, "log", "--oneline", "-1");
    expect(log).toContain("should succeed");

    await manager.pruneWorktree(worktreePath);
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}
