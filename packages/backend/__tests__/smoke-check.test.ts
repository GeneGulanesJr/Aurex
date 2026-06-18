import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runSmokeCheck } from "../src/orchestrator/smoke-check";

// We mock the execFile / promisify pair so we can script per-command outcomes
// without actually spawning bash. The smoke check catches exec errors, so a
// rejected mock surfaces as a smoke failure recorded in `failures`.
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));
vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecAsync }));

describe("runSmokeCheck", () => {
  it("returns pass=true when no commands are configured", async () => {
    const result = await runSmokeCheck({ worktreePath: "/wt" });
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("returns pass=true when all configured commands succeed", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    const result = await runSmokeCheck({
      worktreePath: "/wt",
      testCommand: "npm test",
      typecheckCommand: "tsc --noEmit",
      lintCommand: "npm run lint",
    });
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("records failures for commands that exit non-zero and continues running subsequent checks", async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd === "bash") {
        return Promise.reject(Object.assign(new Error("typecheck errors"), { stderr: "src/x.ts:1:1 error" }));
      }
      return { stdout: "", stderr: "" };
    });
    const result = await runSmokeCheck({
      worktreePath: "/wt",
      typecheckCommand: "tsc --noEmit",
      testCommand: "npm test",
    });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("typecheck"))).toBe(true);
    expect(result.failures.some((f) => f.includes("npm test"))).toBe(false); // succeeded
  });

  it("rejects commands with shell metacharacters and does not execute them", async () => {
    mockExecAsync.mockClear();
    const result = await runSmokeCheck({
      worktreePath: "/wt",
      testCommand: "npm test; rm -rf /",
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain("rejected unsafe command");
    // The unsafe command must never reach exec.
    expect(mockExecAsync.mock.calls.length).toBe(0);
  });
});
