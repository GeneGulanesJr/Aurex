import { describe, it, expect } from "vitest";
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";
import {
  applyWorkingUnitDescriptionFallback,
  applyWorkingUnitScopeFallback,
  enrichWorkingUnitsForExecution,
  mergeRuntimeUnitFields,
  selectWorkerMaxTimeout,
  selectWorkerTimeout,
} from "../src/orchestrator/milestone-unit-context";

function makeMission(): Mission {
  return {
    id: "m-1",
    description: "Mission at /repo/src/app/main.ts",
    status: "running",
    configJson: {
      modelHints: {
        orchestrator: "o",
        worker: "w",
        validator_scrutiny: "v",
        validator_user_testing: "u",
        research: "r",
      },
      workerTimeouts: { simple: 100, build: 200, testHeavy: 300 },
      costCap: 0,
      maxValidatorRetries: 1,
      maxRescopes: 1,
    },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function makeMilestone(): Milestone {
  return {
    id: "ms-1",
    missionId: "m-1",
    title: "Auth",
    description: "Milestone auth description",
    orderIndex: 0,
    status: "planned",
    validationContractId: "c-1",
  };
}

describe("milestone-unit-context", () => {
  it("selects test-heavy timeout for test-related descriptions", () => {
    const unit: WorkingUnit = {
      id: "u-1",
      milestoneId: "ms-1",
      description: "Add vitest coverage",
      declaredPaths: [],
      declaredModules: [],
      status: "planned",
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };
    expect(selectWorkerTimeout(unit, makeMission().configJson.workerTimeouts)).toBe(300);
  });

  it("preserves planner description while filling missing scope only", () => {
    const unit: WorkingUnit = {
      id: "u-1",
      milestoneId: "ms-1",
      description: "Planner-authored description",
      declaredPaths: [],
      declaredModules: [],
      status: "planned",
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };
    const enriched = applyWorkingUnitScopeFallback(unit, makeMission(), makeMilestone(), "/repo");
    expect(enriched.description).toBe("Planner-authored description");
    expect(enriched.declaredPaths.length).toBeGreaterThan(0);
  });

  it("fills empty description from milestone text without overwriting non-empty description", () => {
    const empty: WorkingUnit = {
      id: "u-1",
      milestoneId: "ms-1",
      description: "",
      declaredPaths: ["src/auth.ts"],
      declaredModules: ["auth"],
      status: "planned",
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };
    const filled = applyWorkingUnitDescriptionFallback(empty, makeMission(), makeMilestone());
    expect(filled.description).toBe("Milestone auth description");

    const preserved = applyWorkingUnitDescriptionFallback({
      ...empty,
      description: "Keep me",
    }, makeMission(), makeMilestone());
    expect(preserved.description).toBe("Keep me");
  });

  it("merges runtime fields only when LaPis omitted them", () => {
    const unit: WorkingUnit = {
      id: "u-1",
      milestoneId: "ms-1",
      description: "x",
      declaredPaths: [],
      declaredModules: [],
      status: "completed",
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };
    const merged = mergeRuntimeUnitFields(unit, {
      taskBranch: "task/w/u-1",
      worktreePath: "/wt",
      sessionId: "sess-1",
    });
    expect(merged.taskBranch).toBe("task/w/u-1");
    expect(merged.worktreePath).toBe("/wt");
    expect(merged.sessionId).toBe("sess-1");
  });

  it("filters superseded units during enrichment", () => {
    const units = enrichWorkingUnitsForExecution([
      {
        id: "u-1",
        milestoneId: "ms-1",
        description: "active",
        declaredPaths: ["src/a.ts"],
        declaredModules: ["a"],
        status: "planned",
        taskBranch: "",
        worktreePath: "",
        sessionId: "",
      },
      {
        id: "u-2",
        milestoneId: "ms-1",
        description: "old",
        declaredPaths: [],
        declaredModules: [],
        status: "superseded",
        taskBranch: "",
        worktreePath: "",
        sessionId: "",
      },
    ], makeMission(), makeMilestone(), "/repo");
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("u-1");
  });

  it("extends worker timeout floor for analysis-heavy work", () => {
    expect(selectWorkerMaxTimeout(120_000)).toBeGreaterThanOrEqual(480_000);
  });
});
