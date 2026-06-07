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

  it("selects the highest version from multiple existing contracts", () => {
    // Kills L24:34 ArrowFunction mutant: () => undefined
    // With 2+ elements, reduce MUST call the callback. Mutant returns
    // undefined, causing latest.supersededBy to throw TypeError.
    const existing = [
      { id: "c-1", version: 1, supersededBy: "c-2", supersedes: null, rescopeEventId: "r-1" },
      { id: "c-2", version: 2, supersededBy: "c-3", supersedes: "c-1", rescopeEventId: "r-2" },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(true);
  });

  it("rejects when highest version is not superseded (multiple contracts)", () => {
    // Kills L24:45 NoCoverage mutants: >= and <= off-by-one
    // With versions [1, 3, 2], the reduce must pick version 3.
    // If >= picks first (version 1) or <= picks last (version 2),
    // the wrong contract is checked.
    const existing = [
      { id: "c-1", version: 1, supersededBy: "c-2", supersedes: null, rescopeEventId: "r-1" },
      { id: "c-3", version: 3, supersededBy: null, supersedes: "c-2", rescopeEventId: null },
      { id: "c-2", version: 2, supersededBy: "c-3", supersedes: "c-1", rescopeEventId: "r-2" },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("c-3");
    expect(result.reason).toContain("v3");
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
