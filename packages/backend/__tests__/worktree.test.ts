import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

import { createWorktreeManager } from "../src/orchestrator/worktree";

describe("WorktreeManager", () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("creates a feature worktree with the shared feature branch", async () => {
    const manager = createWorktreeManager("/repo/root");
    const result = await manager.createFeatureWorktree("mission-1", 0, "ms-1", "main");

    expect(result.featureBranch).toBe("feature/mission-1/1");
    expect(result.worktreePath).toBe("/repo/root/.git-worktrees/feature-ms-1");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("branch feature/mission-1/1 main"))).toBe(true);
    expect(calls.some((c) => c.includes("worktree add"))).toBe(true);
  });

  it("resolves and returns baseCommitHash from the feature branch on a fresh start", async () => {
    // Fresh start: the branch is created off main, then rev-parse'd by NAME
    // (feature/...). On a fresh start the feature HEAD == main HEAD.
    let revParseFeatureCount = 0;
    mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("rev-parse") && args.includes("feature/mission-1/1")) {
        revParseFeatureCount++;
        return { stdout: "deadbeefcafebabe\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const manager = createWorktreeManager("/repo/root");
    const result = await manager.createFeatureWorktree("mission-1", 0, "ms-1", "main");

    expect(result.baseCommitHash).toBe("deadbeefcafebabe");
    expect(revParseFeatureCount).toBe(1);
  });

  it("does not run cleanup commands when no stale worktree or branch is registered", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.createFeatureWorktree("mission-1", 0, "ms-1", "main");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("worktree remove /repo/root/.git-worktrees/feature-ms-1 --force"))).toBe(false);
    expect(calls.some((c) => c.includes("branch -D feature/mission-1/1"))).toBe(false);
  });

  it("removes a stale worktree directory but PRESERVES the existing branch on resume", async () => {
    // Resume path: the feature branch already exists (it carries approved
    // unit commits) and must NOT be deleted back to main. Only the stale
    // worktree directory is removed and re-attached.
    const staleWorktreePath = "/repo/root/.git-worktrees/feature-ms-1";
    const existingBranch = "feature/mission-1/1";
    mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("worktree") && args.includes("list") && args.includes("--porcelain")) {
        return { stdout: `worktree ${staleWorktreePath}\nHEAD abcdef\n`, stderr: "" };
      }
      if (args.includes("branch") && args.includes("--list")) {
        return { stdout: `${existingBranch}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const manager = createWorktreeManager("/repo/root");
    await manager.createFeatureWorktree("mission-1", 0, "ms-1", "main");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    // Stale worktree directory IS removed.
    expect(calls.some((c) => c.includes(`worktree remove ${staleWorktreePath} --force`))).toBe(true);
    // The existing branch is NOT deleted and NOT recreated off main — it is
    // preserved and the worktree is re-attached to it directly.
    expect(calls.some((c) => c.includes(`branch -D ${existingBranch}`))).toBe(false);
    expect(calls.some((c) => c.includes(`branch ${existingBranch} main`))).toBe(false);
    expect(calls.some((c) => c.includes(`worktree add ${staleWorktreePath} ${existingBranch}`))).toBe(true);
  });

  it("resolves the current HEAD of a worktree", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    const manager = createWorktreeManager("/repo/root");
    const head = await manager.currentHead("/repo/root/.git-worktrees/feature-ms-1");
    expect(head).toBe("abc123");
  });

  it("hard-resets a worktree to a given commit", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.resetTo("/repo/root/.git-worktrees/feature-ms-1", "abc123");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("reset --hard abc123"))).toBe(true);
  });

  it("is a no-op when resetTo receives an empty sha", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.resetTo("/repo/root/.git-worktrees/feature-ms-1", "");
    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("reset --hard"))).toBe(false);
  });

  it("cuts a release branch off the feature branch without checking it out", async () => {
    const manager = createWorktreeManager("/repo/root");
    const release = await manager.cutReleaseBranch("mission-1", 0, "ms-1", "feature/mission-1/1");

    expect(release).toBe("release/mission-1/1-ms-1");
    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("branch -f release/mission-1/1-ms-1 feature/mission-1/1"))).toBe(true);
    expect(calls.some((c) => c.includes("checkout feature/mission-1/1"))).toBe(false);
  });

  it("recreates a branch via git branch -f", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.recreateBranch("release/mission-1/1-ms-1", "main");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("branch -f release/mission-1/1-ms-1 main"))).toBe(true);
  });

  it("prunes a worktree", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.pruneWorktree("/repo/root/.git-worktrees/feature-ms-1");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("worktree remove"))).toBe(true);
    expect(calls.some((c) => c.includes("worktree prune"))).toBe(true);
  });

  describe("sanitizeGitArg", () => {
    it("rejects arguments with null bytes", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(manager.cutReleaseBranch("evil\x00", 0, "ms-1", "main")).rejects.toThrow("Invalid git argument");
    });

    it("rejects arguments with shell metacharacters", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(manager.cutReleaseBranch("evil;rm -rf /", 0, "ms-1", "main")).rejects.toThrow("Invalid git argument");
    });

    it("rejects arguments with backticks", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(manager.cutReleaseBranch("evil`whoami`", 0, "ms-1", "main")).rejects.toThrow("Invalid git argument");
    });

    it("includes the invalid argument in the error message", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(manager.cutReleaseBranch("evil;cmd", 0, "ms-1", "main")).rejects.toThrow("evil;cmd");
    });

    it("allows safe branch names", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(manager.cutReleaseBranch("feature/my-cool-branch", 0, "ms-1", "main")).resolves.toBe("release/feature/my-cool-branch/1-ms-1");
    });
  });

  describe("installBranchGuard", () => {
    it("writes a pre-commit hook script without throwing", async () => {
      const manager = createWorktreeManager("/repo/root");
      await expect(
        manager.installBranchGuard("/worktree", "feature/mission-1/1"),
      ).resolves.toBeUndefined();
    });
  });
});
