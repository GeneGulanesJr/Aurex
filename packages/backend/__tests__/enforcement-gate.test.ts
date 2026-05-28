import { describe, it, expect } from "vitest";
import { enforceBroadcastTransition, enforceResearchTransition } from "../src/enforcement/enforcement-gate";

describe("enforcement gate", () => {
  describe("enforceBroadcastTransition", () => {
    it("allows valid broadcast transitions", () => {
      const result = enforceBroadcastTransition("active", "superseded", "orchestrator-1", "worker-1");
      expect(result.ok).toBe(true);
    });

    it("rejects invalid broadcast transitions", () => {
      const result = enforceBroadcastTransition("archived", "active", "worker-1", "worker-1");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Invalid transition");
    });

    it("rejects unauthorized actor transitions", () => {
      // worker-2 cannot supersede worker-1's broadcast (not creator, not orchestrator, not human)
      const result = enforceBroadcastTransition("active", "superseded", "worker-2", "worker-1");
      expect(result.ok).toBe(false);
    });
  });

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
