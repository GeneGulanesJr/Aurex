import { describe, it, expect } from "vitest";
import { enforceResearchTransition } from "../src/enforcement/enforcement-gate";

describe("enforcement gate", () => {
  describe("enforceResearchTransition", () => {
    it("allows valid research transitions", () => {
      const result = enforceResearchTransition("unverified", "verified", "orchestrator-1", { taskId: "t1", workerSessionId: "s1" });
      expect(result.ok).toBe(true);
    });

    it("rejects research verification without standing context", () => {
      const result = enforceResearchTransition("unverified", "verified", "worker-1");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("standing context");
    });

    it("rejects invalid research transitions", () => {
      const result = enforceResearchTransition("expired", "verified", "orchestrator-1");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Invalid transition");
    });
  });
});
