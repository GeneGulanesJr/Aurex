import { describe, it, expect } from "vitest";
import { isBranchAllowed, validateCommitBranch } from "../src/enforcement/branch-guard";

describe("branch-guard", () => {
  it("allows commits to task/* branches", () => {
    expect(isBranchAllowed("task/worker-a/auth-001")).toBe(true);
    expect(isBranchAllowed("task/worker-b/api-001")).toBe(true);
  });

  it("rejects commits to non-task branches", () => {
    expect(isBranchAllowed("main")).toBe(false);
    expect(isBranchAllowed("develop")).toBe(false);
    expect(isBranchAllowed("agent/worker-a/auth")).toBe(false);
    expect(isBranchAllowed("release/milestone-1")).toBe(false);
  });

  it("validateCommitBranch returns result object", () => {
    const result = validateCommitBranch("task/worker-a/auth-001");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("validateCommitBranch gives reason for rejection", () => {
    const result = validateCommitBranch("main");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task/*");
  });
});
