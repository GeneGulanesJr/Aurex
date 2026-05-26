import { describe, it, expect } from "vitest";
import { checkPreSpawnOverlap, computePostCommitScope, detectOverlap } from "../src/orchestrator/overlap";
import type { WorkingUnit } from "@aurex/shared";

describe("overlap detection", () => {
  const existingUnits: WorkingUnit[] = [
    {
      id: "unit-1",
      milestoneId: "ms-1",
      description: "Auth feature",
      declaredPaths: ["src/auth/**", "src/middleware/auth.ts"],
      declaredModules: ["auth", "middleware"],
      status: "working",
      taskBranch: "task/worker-a/auth-001",
      worktreePath: "/tmp/wt-a",
      sessionId: "sess-1",
    },
  ];

  describe("pre-spawn", () => {
    it("detects overlap on declared paths", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/auth/login.ts"], declaredModules: ["auth"] },
        existingUnits,
      );
      expect(result.overlap).toBe(true);
      expect(result.overlappingUnits).toContain("unit-1");
    });

    it("allows non-overlapping paths", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/api/routes.ts"], declaredModules: ["api"] },
        existingUnits,
      );
      expect(result.overlap).toBe(false);
    });

    it("detects overlap on declared modules", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/new-feature.ts"], declaredModules: ["auth"] },
        existingUnits,
      );
      expect(result.overlap).toBe(true);
    });
  });

  describe("post-commit", () => {
    it("unions declared scope with git diff files", () => {
      const scope = computePostCommitScope(
        { declaredPaths: ["src/auth/**"], declaredModules: ["auth"] },
        ["src/auth/login.ts", "src/utils/helpers.ts"],
      );
      expect(scope).toContain("src/utils/helpers.ts");
    });

    it("detects drift when git diff goes beyond declared scope", () => {
      const scope = computePostCommitScope(
        { declaredPaths: ["src/auth/**"], declaredModules: ["auth"] },
        ["src/auth/login.ts", "src/api/routes.ts"],
      );
      expect(scope.length).toBeGreaterThan(2);
    });
  });

  describe("detectOverlap", () => {
    it("returns overlapping unit IDs", () => {
      const result = detectOverlap(
        ["src/auth/login.ts", "src/middleware/auth.ts"],
        existingUnits,
      );
      expect(result.overlap).toBe(true);
      expect(result.overlappingUnits).toContain("unit-1");
    });
  });
});
