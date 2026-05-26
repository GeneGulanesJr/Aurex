import { describe, it, expect } from "vitest";
import { validateHandoff } from "../src/enforcement/handoff-validator";
import type { Handoff } from "@aurex/shared";

describe("validateHandoff", () => {
  const validHandoff: Handoff = {
    unitId: "unit-1",
    featureName: "Auth",
    description: "Implemented login",
    implemented: "JWT tokens",
    remaining: "Refresh tokens",
    rationale: "Chose JWT for statelessness per contract requirement for stateless auth",
    assumptions: "Token expiry is 1 hour",
    unresolvedUncertainties: "none",
    errorsEncountered: "none",
    commandsRun: [{ command: "npm test", exitCode: 0 }],
    gitCommitHash: "abc123",
  };

  it("accepts a valid handoff", () => {
    const result = validateHandoff(validHandoff);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects handoff with copy-paste rationale", () => {
    const handoff = { ...validHandoff, rationale: "Refactored X" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("rationale"));
  });

  it("rejects handoff with absent unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("unresolvedUncertainties"));
  });

  it("accepts 'none' as valid unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "none" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff with empty gitCommitHash", () => {
    const handoff = { ...validHandoff, gitCommitHash: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
  });

  it("rejects handoff with missing required fields", () => {
    const handoff = { ...validHandoff, description: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
  });
});
