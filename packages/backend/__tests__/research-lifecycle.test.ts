import { describe, it, expect } from "vitest";
import { validateResearchTransition, canTransitionFinding } from "../src/enforcement/research-lifecycle";

describe("research lifecycle", () => {
  // ── validateResearchTransition ──────────────────────────────────────

  describe("validateResearchTransition", () => {
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
      expect(validateResearchTransition("superseded", "expired").valid).toBe(true);
      expect(validateResearchTransition("rejected", "expired").valid).toBe(true);
    });

    it("rejects verified → unverified", () => {
      expect(validateResearchTransition("verified", "unverified").valid).toBe(false);
    });

    it("rejects rejected → verified", () => {
      expect(validateResearchTransition("rejected", "verified").valid).toBe(false);
    });

    it("returns valid result with no reason for allowed transitions", () => {
      const result = validateResearchTransition("unverified", "verified");
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    // ── Kills ArrayDeclaration and StringLiteral mutants on L7-9 ──
    // Mutants: superseded:["expired"]→[], superseded:["expired"]→[""],
    // rejected:["expired"]→[], rejected:["expired"]→[""], expired:[]→["Stryker was here"]

    it("superseded can only transition to expired (kills L7 array/string mutants)", () => {
      // If mutant empties the array, superseded→expired becomes invalid.
      // If mutant replaces "expired" with "", includes("expired") returns false.
      expect(validateResearchTransition("superseded", "expired").valid).toBe(true);
      // And nothing else should be valid for superseded
      expect(validateResearchTransition("superseded", "superseded").valid).toBe(false);
      expect(validateResearchTransition("superseded", "unverified").valid).toBe(false);
    });

    it("rejected can only transition to expired (kills L8 array/string mutants)", () => {
      expect(validateResearchTransition("rejected", "expired").valid).toBe(true);
      expect(validateResearchTransition("rejected", "rejected").valid).toBe(false);
      expect(validateResearchTransition("rejected", "verified").valid).toBe(false);
    });

    it("expired has no valid outgoing transitions (kills L9 array mutant)", () => {
      expect(validateResearchTransition("expired", "expired").valid).toBe(false);
      expect(validateResearchTransition("expired", "unverified").valid).toBe(false);
    });

    // ── Kills L22:7 ConditionalExpression → false ──
    it("returns valid=false for unknown state (kills L22 conditional)", () => {
      const result = validateResearchTransition("unknown_state" as any, "verified");
      expect(result.valid).toBe(false);
    });

    // ── Kills L22 NoCoverage block ──
    it("returns reason with 'Unknown lifecycle state' for unknown state", () => {
      const result = validateResearchTransition("unknown_state" as any, "verified");
      expect(result.reason).toContain("Unknown lifecycle state");
      expect(result.reason).toContain("unknown_state");
    });

    // ── Kills L30:81 StringLiteral → "" ──
    it("includes transition details in rejection reason", () => {
      const result = validateResearchTransition("expired", "unverified");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");
      expect(result.reason).toContain("unverified");
    });

    it("lists allowed transitions in reason string", () => {
      const result = validateResearchTransition("unverified", "unverified");
      expect(result.reason).toContain("verified");
      expect(result.reason).toContain("rejected");
      expect(result.reason).toContain("expired");
    });
  });

  // ── canTransitionFinding ────────────────────────────────────────────

  describe("canTransitionFinding", () => {
    it("allows transition with valid standing context", () => {
      const result = canTransitionFinding("unverified", "verified", "worker-1", {
        taskId: "task-1",
        workerSessionId: "sess-1",
      });
      expect(result.valid).toBe(true);
    });

    it("rejects verification without standing context", () => {
      const result = canTransitionFinding("unverified", "verified", "worker-1");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("standing");
    });

    // ── Kills L43:7 ConditionalExpression → true ──
    // Mutant makes `next === "verified" && !standingContext` always true,
    // so ALL transitions would fail with "Verification requires..."
    it("allows non-verified transitions without standing context", () => {
      const result = canTransitionFinding("unverified", "rejected", "worker-1");
      expect(result.valid).toBe(true);
    });

    it("allows expiry transitions without standing context", () => {
      const result = canTransitionFinding("unverified", "expired", "worker-1");
      expect(result.valid).toBe(true);
    });

    it("returns the original transition result for invalid transitions", () => {
      const result = canTransitionFinding("expired", "unverified", "worker-1");
      expect(result.valid).toBe(false);
      // The reason should be from validateResearchTransition, not the
      // standing context check
      expect(result.reason).toContain("Invalid transition");
    });
  });
});
