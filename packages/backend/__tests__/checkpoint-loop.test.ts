import { describe, expect, it, vi } from "vitest";
import { runCheckpointLoop } from "../src/orchestrator/checkpoint-loop";
import type { CheckpointManager } from "../src/orchestrator/checkpoint-manager";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";

function makeMission(): Mission {
  return {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: {
        orchestrator: "reasoning",
        worker: "code",
        validator_scrutiny: "reasoning",
        validator_user_testing: "browser",
        research: "fast",
      },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };
}

const milestone: Milestone = {
  id: "ms-1",
  missionId: "m-1",
  title: "Auth",
  description: "Implement auth",
  orderIndex: 0,
  status: "planned",
  validationContractId: "c-1",
};

describe("checkpoint loop", () => {
  it("continues a failed checkpoint without rescope by queueing failed units for another work attempt", async () => {
    const mission = makeMission();
    const units: WorkingUnit[] = [
      {
        id: "u-pass",
        milestoneId: "ms-1",
        description: "Passing unit",
        declaredPaths: ["src/pass.ts"],
        declaredModules: ["pass"],
        status: "completed",
        taskBranch: "task/pass",
        worktreePath: "/tmp/pass",
        sessionId: "s-pass",
      },
      {
        id: "u-fail",
        milestoneId: "ms-1",
        description: "Failed unit",
        declaredPaths: ["src/fail.ts"],
        declaredModules: ["fail"],
        status: "completed",
        taskBranch: "task/fail",
        worktreePath: "/tmp/fail",
        sessionId: "s-fail",
      },
    ];
    const loop = {
      run: vi.fn()
        .mockResolvedValueOnce({ status: "checkpoint_needed", trigger: "rescope_limit", milestoneId: "ms-1", summary: "validator failed" })
        .mockResolvedValueOnce({ status: "completed" }),
    };
    const checkpointManager: CheckpointManager = {
      create: vi.fn().mockResolvedValue("cp-1"),
      waitForResolution: vi.fn().mockResolvedValue({
        id: "cp-1",
        missionId: "m-1",
        trigger: "rescope_limit",
        milestoneId: "ms-1",
        summary: "validator failed",
        status: "resolved",
        decision: "approve",
        guidance: "retry the failing auth work without changing scope",
        createdAt: "2026-01-01",
      }),
      resolve: vi.fn(),
      getPendingForMission: vi.fn().mockResolvedValue([]),
    };
    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      createCheckpoint: vi.fn(),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
      getVerdicts: vi.fn().mockResolvedValue([
        {
          id: "v-1",
          milestoneId: "ms-1",
          contractId: "c-1",
          validatorType: "validator_scrutiny",
          sessionId: "vs-1",
          verdict: "fail",
          findings: "u-fail needs more work",
          failedUnitIds: ["u-fail"],
          timestamp: "2026-01-01",
        },
      ]),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      getMission: vi.fn().mockResolvedValue(mission),
    } as unknown as LaPisClient;
    const eventBus = { emit: vi.fn() };

    const result = await runCheckpointLoop(loop, {
      missionId: "m-1",
      mission,
      milestones: [milestone],
      costCapApproved: false,
    }, {
      checkpointManager,
      lapis,
      pinyx: {} as PinyxClient,
      eventBus: eventBus as any,
      setStatus: vi.fn(),
    });

    expect(result.status).toBe("completed");
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("u-fail", "planned");
    expect(lapis.updateWorkingUnitStatus).not.toHaveBeenCalledWith("u-pass", "planned");
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith("ms-1", "in_progress");
    expect(loop.run).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_log",
      phase: "checkpoint",
      data: expect.objectContaining({ retriedUnitIds: ["u-fail"] }),
    }));
  });

  it("does not auto-retry a validation_failed checkpoint when getVerdicts returns no signal", async () => {
    // getVerdicts returns an empty array. The checkpoint-loop must NOT
    // silently reset all completed units to 'planned' just because there
    // is no failedUnitIds signal. The user must explicitly choose Rescope
    // or Abort from the checkpoint UI to make progress.
    const mission = makeMission();
    const units: WorkingUnit[] = [
      {
        id: "u-pass",
        milestoneId: "ms-1",
        description: "Passing unit",
        declaredPaths: ["src/pass.ts"],
        declaredModules: ["pass"],
        status: "completed",
        taskBranch: "task/pass",
        worktreePath: "/tmp/pass",
        sessionId: "s-pass",
      },
    ];
    const loop = {
      run: vi.fn()
        .mockResolvedValueOnce({ status: "checkpoint_needed", trigger: "validation_failed", milestoneId: "ms-1", summary: "validator failed" })
        .mockResolvedValueOnce({ status: "completed" }),
    };
    const checkpointManager: CheckpointManager = {
      create: vi.fn().mockResolvedValue("cp-1"),
      waitForResolution: vi.fn().mockResolvedValue({
        id: "cp-1",
        missionId: "m-1",
        trigger: "validation_failed",
        milestoneId: "ms-1",
        summary: "validator failed",
        status: "resolved",
        decision: "approve",
        guidance: "continue with the current scope",
        createdAt: "2026-01-01",
      }),
      resolve: vi.fn(),
      getPendingForMission: vi.fn().mockResolvedValue([]),
    };
    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      createCheckpoint: vi.fn(),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
      getVerdicts: vi.fn().mockResolvedValue([]),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      getMission: vi.fn().mockResolvedValue(mission),
    } as unknown as LaPisClient;
    const eventBus = { emit: vi.fn() };

    const result = await runCheckpointLoop(loop, {
      missionId: "m-1",
      mission,
      milestones: [milestone],
      costCapApproved: false,
    }, {
      checkpointManager,
      lapis,
      pinyx: {} as PinyxClient,
      eventBus: eventBus as any,
      setStatus: vi.fn(),
    });

    expect(result.status).toBe("completed");
    // CRITICAL: no completed unit should have been reset to 'planned'
    // when there is no signal to determine which units to retry.
    expect(lapis.updateWorkingUnitStatus).not.toHaveBeenCalled();
    // The milestone status should not have been flipped to in_progress
    // either — that would imply we silently committed to re-running.
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalled();
    // A "no verdicts" log should be emitted so operators can see what
    // happened instead of a silent no-op.
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_log",
      phase: "checkpoint",
      data: expect.objectContaining({ retriedUnitIds: [] }),
    }));
  });

  it("does not auto-retry an unclassifiable_error checkpoint even when verdicts are present", async () => {
    // unclassifiable_error signals a runtime/compliance failure (validator
    // produced no verdict, integration aborted, etc.). Silently re-running
    // the milestone is unsafe because the failure mode won't change without
    // a re-plan. Only Rescope or Abort are valid recovery paths.
    const mission = makeMission();
    const units: WorkingUnit[] = [
      {
        id: "u-fail",
        milestoneId: "ms-1",
        description: "Failed unit",
        declaredPaths: ["src/fail.ts"],
        declaredModules: ["fail"],
        status: "completed",
        taskBranch: "task/fail",
        worktreePath: "/tmp/fail",
        sessionId: "s-fail",
      },
    ];
    const loop = {
      run: vi.fn()
        .mockResolvedValueOnce({ status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId: "ms-1", summary: "validator produced no verdict" })
        .mockResolvedValueOnce({ status: "completed" }),
    };
    const checkpointManager: CheckpointManager = {
      create: vi.fn().mockResolvedValue("cp-1"),
      waitForResolution: vi.fn().mockResolvedValue({
        id: "cp-1",
        missionId: "m-1",
        trigger: "unclassifiable_error",
        milestoneId: "ms-1",
        summary: "validator produced no verdict",
        status: "resolved",
        decision: "approve",
        guidance: "try again",
        createdAt: "2026-01-01",
      }),
      resolve: vi.fn(),
      getPendingForMission: vi.fn().mockResolvedValue([]),
    };
    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      createCheckpoint: vi.fn(),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
      getVerdicts: vi.fn().mockResolvedValue([
        {
          id: "v-1",
          milestoneId: "ms-1",
          contractId: "c-1",
          validatorType: "validator_scrutiny",
          sessionId: "vs-1",
          verdict: "fail",
          findings: "needs more work",
          failedUnitIds: ["u-fail"],
          timestamp: "2026-01-01",
        },
      ]),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      getMission: vi.fn().mockResolvedValue(mission),
    } as unknown as LaPisClient;
    const eventBus = { emit: vi.fn() };

    await runCheckpointLoop(loop, {
      missionId: "m-1",
      mission,
      milestones: [milestone],
      costCapApproved: false,
    }, {
      checkpointManager,
      lapis,
      pinyx: {} as PinyxClient,
      eventBus: eventBus as any,
      setStatus: vi.fn(),
    });

    // The retry branch should not have run for unclassifiable_error.
    expect(lapis.updateWorkingUnitStatus).not.toHaveBeenCalled();
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalled();
  });
});
