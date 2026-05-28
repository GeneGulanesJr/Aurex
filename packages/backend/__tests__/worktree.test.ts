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

  it("creates a worktree with correct branch", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "/repo/root/.git-worktrees/worker-a-auth-001\n", stderr: "" });
    const manager = createWorktreeManager("/repo/root");
    const result = await manager.createWorktree("worker-a", "auth-001", "agent/worker-a/auth");

    expect(result.taskBranch).toBe("task/worker-a/auth-001");
    expect(result.worktreePath).toBe("/repo/root/.git-worktrees/worker-a-auth-001");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("branch task/worker-a/auth-001"))).toBe(true);
    expect(calls.some((c) => c.includes("worktree add"))).toBe(true);
  });

  it("merges task branch to develop", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.mergeToTarget("task/worker-a/auth-001", "develop");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("checkout develop"))).toBe(true);
    expect(calls.some((c) => c.includes("merge task/worker-a/auth-001"))).toBe(true);
  });

  it("creates a branch from a base branch", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.createBranch("release/milestone-1", "develop");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("branch release/milestone-1 develop"))).toBe(true);
  });

  it("prunes a worktree", async () => {
    const manager = createWorktreeManager("/repo/root");
    await manager.pruneWorktree("/repo/root/.git-worktrees/worker-a-auth-001");

    const calls = mockExecAsync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes("worktree remove"))).toBe(true);
    expect(calls.some((c) => c.includes("worktree prune"))).toBe(true);
  });
});
