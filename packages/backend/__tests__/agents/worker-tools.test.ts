import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkerTools } from "../../src/agents/worker-tools";
import type { LaPisClient } from "../../src/clients/lapis-client";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return { ...actual, promisify: () => mockExecFile };
});

import { createWorkerTools } from "../../src/agents/worker-tools";

function createMockLapis() {
  return {
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([
      { id: 1, title: "test", content: "found", type: "pattern", scope: "project", topicKey: null },
    ]),
  } as unknown as LaPisClient;
}

describe("worker tools", () => {
  it("creates write_handoff tool with correct name", () => {
    const tools = createWorkerTools(createMockLapis(), "unit-123");
    const handoffTool = tools.find((t) => t.name === "write_handoff");
    expect(handoffTool).toBeDefined();
    expect(handoffTool!.description).toContain("handoff");
  });

  it("creates search_memory tool with correct name", () => {
    const tools = createWorkerTools(createMockLapis(), "unit-123");
    const memTool = tools.find((t) => t.name === "search_memory");
    expect(memTool).toBeDefined();
    expect(memTool!.description).toContain("memory");
  });

  it("write_handoff calls lapis.writeHandoff with unitId", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    await (handoffTool as any).execute("tc-1", {
      featureName: "Login",
      description: "Login endpoint",
      implemented: "POST /login",
      remaining: "Token refresh",
      rationale: "JWT-based auth",
      assumptions: "Users have passwords",
      unresolvedUncertainties: "none",
      errorsEncountered: "none",
      commandsRun: JSON.stringify([{ command: "npm test", exitCode: 0 }]),
      gitCommitHash: "abc123",
    });

    expect(lapis.writeHandoff).toHaveBeenCalledWith("unit-456", expect.objectContaining({
      unitId: "unit-456",
      featureName: "Login",
      gitCommitHash: "abc123",
    }));
  });

  it("write_handoff returns accepted on success", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    const result = await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Ra",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("accepted");
  });

  it("calls onHandoffAccepted after LaPis accepts a handoff", async () => {
    const lapis = createMockLapis();
    const onHandoffAccepted = vi.fn();
    const tools = createWorkerTools(lapis, "unit-456", { onHandoffAccepted });
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Detailed rationale",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    expect(onHandoffAccepted).toHaveBeenCalledTimes(1);
  });

  it("write_handoff returns errors when rejected", async () => {
    const lapis = createMockLapis();
    (lapis.writeHandoff as any).mockResolvedValue({
      accepted: false,
      errors: ["rationale is too short"],
    });
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    const result = await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Refactored X",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("rationale is too short");
  });

  it("search_memory calls lapis.searchMemory", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const memTool = tools.find((t) => t.name === "search_memory")!;

    const result = await (memTool as any).execute("tc-1", { query: "auth pattern" });

    expect(lapis.searchMemory).toHaveBeenCalledWith("auth pattern", undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("found");
  });

  it("search_memory passes limit option", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const memTool = tools.find((t) => t.name === "search_memory")!;

    await (memTool as any).execute("tc-1", { query: "test", limit: 5 });

    expect(lapis.searchMemory).toHaveBeenCalledWith("test", { limit: 5 });
  });

  describe("write_handoff commit verification (worktreePath)", () => {
    const validParams = {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Detailed rationale that is long enough",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "abc123",
    };

    beforeEach(() => {
      mockExecFile.mockReset();
      // Default: both git checks succeed (commit exists and is ancestor of HEAD).
      mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });
    });

    it("accepts when commit hash is valid and reachable from HEAD", async () => {
      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/repo/wt" });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", validParams);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("accepted");
      expect(lapis.writeHandoff).toHaveBeenCalledTimes(1);

      // Both verification git calls ran against the worktree.
      const calls = mockExecFile.mock.calls.map((c: any) => c[1]?.join(" "));
      expect(calls.some((s: string) => s.includes("cat-file -e"))).toBe(true);
      expect(calls.some((s: string) => s.includes("merge-base --is-ancestor"))).toBe(true);
    });

    it("rejects a fabricated hash that is not a real commit object", async () => {
      // Simulate 'git cat-file -e <hash>^{commit}' failing (object does not exist).
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("cat-file")) {
          throw new Error("fatal: Not a valid object name");
        }
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const onHandoffAccepted = vi.fn();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/repo/wt", onHandoffAccepted });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "deadbeef" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("commit verification failed");
      // Crucially: LaPis was never called and the session was not completed.
      expect(lapis.writeHandoff).not.toHaveBeenCalled();
      expect(onHandoffAccepted).not.toHaveBeenCalled();
    });

    it("rejects a hash that exists but is not reachable from branch HEAD", async () => {
      // Simulate the real bug: hash is a valid object (cat-file succeeds) but
      // merge-base --is-ancestor exits 1 (not on this branch — e.g. borrowed
      // from an integration branch). exit code 1 is the real "not ancestor"
      // signal; other errors are treated as "cannot verify".
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("cat-file")) return { stdout: "", stderr: "" };
        if (args.includes("merge-base")) {
          const err = new Error("exit 1");
          (err as { code?: number }).code = 1;
          throw err;
        }
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/repo/wt" });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "8f8e9d7" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("NOT reachable from your branch HEAD");
      expect(lapis.writeHandoff).not.toHaveBeenCalled();
    });

    it("rejects an empty gitCommitHash", async () => {
      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/repo/wt" });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("commit verification failed");
      expect(lapis.writeHandoff).not.toHaveBeenCalled();
      // No git calls needed for the empty-hash short-circuit.
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("rejects when the claimed hash equals the branch base commit (worker produced no new commits)", async () => {
      // The real bug: a worker that never runs `git commit` but calls
      // `git rev-parse HEAD` gets the BASE commit hash. That hash is a valid
      // object AND an ancestor of HEAD (trivially — a commit is its own
      // ancestor), so the existing reachable-from-HEAD check accepts it,
      // producing an accepted handoff with an empty diff downstream.
      // When a baseCommitHash is provided, the guard must reject a claimed
      // hash that is the base or older than the base.
      // `merge-base --is-ancestor <claimed> <base>` exits 0 here (claimed ==
      // base is its own ancestor) => the new check must treat that as a
      // rejection, not an acceptance.
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        // cat-file -e <claimed>^{commit} succeeds (base is a real object)
        if (args.includes("cat-file")) return { stdout: "", stderr: "" };
        // merge-base --is-ancestor <claimed> HEAD => exits 0 (reachable)
        // merge-base --is-ancestor <claimed> <base> => exits 0 (claimed IS base)
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const onHandoffAccepted = vi.fn();
      const tools = createWorkerTools(lapis, "unit-1", {
        worktreePath: "/repo/wt",
        baseCommitHash: "72bbe15",
        onHandoffAccepted,
      });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", {
        ...validParams,
        gitCommitHash: "72bbe15", // same as base — worker never committed
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text.toLowerCase()).toContain("no new commit");
      expect(lapis.writeHandoff).not.toHaveBeenCalled();
      expect(onHandoffAccepted).not.toHaveBeenCalled();
    });

    it("accepts when the claimed hash is a real new commit past the base", async () => {
      // Happy path with base tracking: claimed hash is valid, reachable from
      // HEAD, AND strictly newer than the base (is-ancestor base claimed => 0,
      // is-ancestor claimed base => non-zero). Must be accepted.
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("cat-file")) return { stdout: "", stderr: "" };
        // args from merge-base: [..., "--is-ancestor", A, B]
        const mbIdx = args.indexOf("merge-base");
        if (mbIdx !== -1 && args[mbIdx + 1] === "--is-ancestor") {
          const a = args[args.length - 2];
          const b = args[args.length - 1];
          // claimed (a5b6c7) is newer than base (72bbe15):
          //   is-ancestor base claimed => exit 0 (base is ancestor of claimed)
          //   is-ancestor claimed base => exit 1 (claimed NOT ancestor of base)
          if (a === "72bbe15" && b === "a5b6c7d") return { stdout: "", stderr: "" };
          if (a === "a5b6c7d" && b === "72bbe15") {
            const err = new Error("exit 1");
            (err as { code?: number }).code = 1;
            throw err;
          }
          // is-ancestor claimed HEAD => exit 0 (reachable from HEAD)
          if (a === "a5b6c7d" && b === "HEAD") return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const onHandoffAccepted = vi.fn();
      const tools = createWorkerTools(lapis, "unit-1", {
        worktreePath: "/repo/wt",
        baseCommitHash: "72bbe15",
        onHandoffAccepted,
      });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", {
        ...validParams,
        gitCommitHash: "a5b6c7d",
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("accepted");
      expect(lapis.writeHandoff).toHaveBeenCalledTimes(1);
      expect(onHandoffAccepted).toHaveBeenCalledTimes(1);
    });

    it("skips verification when worktreePath is not provided (backward compatible)", async () => {
      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1"); // no worktreePath
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "abc123" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("accepted");
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("skips verification (allows) when path is not a git repo", async () => {
      // rev-parse --is-inside-work-tree fails => cannot verify, must not block.
      // This keeps the check safe in non-repo cwd (tests, misconfigured paths)
      // and when git is unavailable. We only block on POSITIVE evidence.
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("rev-parse")) throw new Error("fatal: not a git repository");
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/not/a/repo" });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "fakehash" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("accepted");
      expect(lapis.writeHandoff).toHaveBeenCalledTimes(1);
    });

    it("skips verification (allows) on git error code 128 from merge-base", async () => {
      // merge-base exits 128 on a genuine git error (not the exit-1
      // "not ancestor" signal). Treat as "cannot determine" — don't block.
      mockExecFile.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("cat-file")) return { stdout: "", stderr: "" };
        if (args.includes("merge-base")) {
          const err = new Error("fatal: bad revision");
          (err as { code?: number }).code = 128;
          throw err;
        }
        return { stdout: "", stderr: "" };
      });

      const lapis = createMockLapis();
      const tools = createWorkerTools(lapis, "unit-1", { worktreePath: "/repo/wt" });
      const handoffTool = tools.find((t) => t.name === "write_handoff")!;

      const result = await (handoffTool as any).execute("tc-1", { ...validParams, gitCommitHash: "abc123" });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("accepted");
    });
  });
});
