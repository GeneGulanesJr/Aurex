// packages/backend/__tests__/overlap.test.ts
import { describe, it, expect } from "vitest";
import { checkPreSpawnOverlap } from "../src/orchestrator/overlap.js";
import type { WorkingUnit } from "@aurex/shared";

function makeUnit(overrides: Partial<WorkingUnit> & { id: string; declaredPaths: string[]; declaredModules: string[] }): WorkingUnit {
  return {
    milestoneId: "ms-1",
    description: `unit ${overrides.id}`,
    status: "planned",
    taskBranch: null,
    worktreePath: null,
    handoff: null,
    ...overrides,
  } as WorkingUnit;
}

describe("checkPreSpawnOverlap", () => {
  it("detects path overlap between new scope and working units", () => {
    const existing = [
      makeUnit({ id: "u1", declaredPaths: ["src/foo.ts"], declaredModules: ["core"], status: "working" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/foo.ts"], declaredModules: ["other"] },
      existing,
    );
    expect(result.overlap).toBe(true);
    expect(result.overlappingUnits).toEqual(["u1"]);
  });

  it("detects module overlap between new scope and spawned units", () => {
    const existing = [
      makeUnit({ id: "u2", declaredPaths: ["src/bar.ts"], declaredModules: ["auth"], status: "spawned" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/baz.ts"], declaredModules: ["auth"] },
      existing,
    );
    expect(result.overlap).toBe(true);
    expect(result.overlappingUnits).toEqual(["u2"]);
  });

  it("returns no overlap when paths and modules are disjoint", () => {
    const existing = [
      makeUnit({ id: "u3", declaredPaths: ["src/a.ts"], declaredModules: ["mod-a"], status: "working" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/b.ts"], declaredModules: ["mod-b"] },
      existing,
    );
    expect(result.overlap).toBe(false);
    expect(result.overlappingUnits).toEqual([]);
  });

  it("ignores units that are not working or spawned", () => {
    const existing = [
      makeUnit({ id: "u4", declaredPaths: ["src/foo.ts"], declaredModules: ["core"], status: "planned" }),
      makeUnit({ id: "u5", declaredPaths: ["src/foo.ts"], declaredModules: ["core"], status: "completed" }),
      makeUnit({ id: "u6", declaredPaths: ["src/foo.ts"], declaredModules: ["core"], status: "failed" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/foo.ts"], declaredModules: ["core"] },
      existing,
    );
    expect(result.overlap).toBe(false);
  });

  it("excludes units by ID when excludeIds is provided", () => {
    const existing = [
      makeUnit({ id: "u7", declaredPaths: ["src/foo.ts"], declaredModules: ["core"], status: "working" }),
      makeUnit({ id: "u8", declaredPaths: ["src/bar.ts"], declaredModules: ["auth"], status: "working" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/foo.ts"], declaredModules: ["core"] },
      existing,
      new Set(["u7"]),
    );
    expect(result.overlap).toBe(false);
  });

  it("does not self-overlap when excludeIds contains the candidate's ID", () => {
    // Simulates the bug scenario: a unit being re-processed would overlap with itself
    const existing = [
      makeUnit({ id: "u-self", declaredPaths: ["src/x.ts"], declaredModules: ["mod-x"], status: "working" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/x.ts"], declaredModules: ["mod-x"] },
      existing,
      new Set(["u-self"]),
    );
    expect(result.overlap).toBe(false);
  });

  it("still detects other overlapping units when excludeIds is used", () => {
    const existing = [
      makeUnit({ id: "u-excluded", declaredPaths: ["src/a.ts"], declaredModules: ["core"], status: "working" }),
      makeUnit({ id: "u-other", declaredPaths: ["src/b.ts"], declaredModules: ["auth"], status: "working" }),
    ];
    const result = checkPreSpawnOverlap(
      { declaredPaths: ["src/b.ts"], declaredModules: ["auth"] },
      existing,
      new Set(["u-excluded"]),
    );
    expect(result.overlap).toBe(true);
    expect(result.overlappingUnits).toEqual(["u-other"]);
  });
});
