import { describe, it, expect } from "vitest";
import { validateResearchTransition, canTransitionFinding } from "../src/enforcement/research-lifecycle";

describe("research lifecycle", () => {
  it("allows unverified → verified", () => {
    expect(validateResearchTransition("unverified", "verified").valid).toBe(true);
  });

  it("allows unverified → rejected", () => {
    expect(validateResearchTransition("unverified", "rejected").valid).toBe(true);
  });

  it("allows verified → superseded", () => {
    expect(validateResearchTransition("verified", "superseded").valid).toBe(true);
  });

  it("allows any → expired (auto-expiry)", () => {
    expect(validateResearchTransition("unverified", "expired").valid).toBe(true);
    expect(validateResearchTransition("verified", "expired").valid).toBe(true);
  });

  it("rejects verified → unverified", () => {
    expect(validateResearchTransition("verified", "unverified").valid).toBe(false);
  });

  it("rejects rejected → verified", () => {
    expect(validateResearchTransition("rejected", "verified").valid).toBe(false);
  });

  it("canTransitionFinding requires standing context for verification", () => {
    const result = canTransitionFinding("unverified", "verified", "worker-1", { taskId: "task-1", workerSessionId: "sess-1" });
    expect(result.valid).toBe(true);
  });

  it("rejects verification without standing context", () => {
    const result = canTransitionFinding("unverified", "verified", "worker-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("standing");
  });
});
