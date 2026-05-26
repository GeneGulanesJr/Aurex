import { describe, it, expect } from "vitest";
import { validateContractAppend, validateSupersede } from "../src/enforcement/contract-immutability";

describe("contract immutability", () => {
  it("allows creating a new contract (no existing)", () => {
    const result = validateContractAppend([], { milestoneId: "ms-1", content: { criteria: ["test passes"], testCommands: ["npm test"], acceptanceBehavior: "All tests pass" } });
    expect(result.valid).toBe(true);
  });

  it("allows creating v2 when v1 is superseded", () => {
    const existing = [
      { id: "c-1", version: 1, supersededBy: "c-2", supersedes: null, rescopeEventId: "r-1" },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(true);
  });

  it("rejects creating v2 when v1 is not superseded", () => {
    const existing = [
      { id: "c-1", version: 1, supersededBy: null, supersedes: null, rescopeEventId: null },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("supersede");
  });

  it("validates supersede requires rescope event", () => {
    const result = validateSupersede("c-1", { rescopeEventId: null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rescope");
  });

  it("allows supersede with rescope event", () => {
    const result = validateSupersede("c-1", { rescopeEventId: "r-1" });
    expect(result.valid).toBe(true);
  });
});
