import { describe, it, expect } from "vitest";
import { missionReducer, initialMissionState } from "./useMission";
import type { MilestoneStatus, AgentType, AgentStatus, CheckpointDecision } from "@aurex/shared";

const seedState = {
  ...initialMissionState,
  mission: { id: "m1", description: "Test", status: "running", configJson: {} } as any,
  milestones: [
    { id: "ms1", missionId: "m1", title: "Build", description: "Build", orderIndex: 0, status: "in_progress", validationContractId: "c1" },
    { id: "ms2", missionId: "m1", title: "Test", description: "Test", orderIndex: 1, status: "planned", validationContractId: "c2" },
  ],
  activeWorkers: [
    { id: "worker-u1", milestoneId: "ms1", description: "Worker 1", status: "running", declaredPaths: [], declaredModules: [] },
  ],
};

describe("missionReducer", () => {
  it("updates milestone progress from websocket events", () => {
    const state = missionReducer(seedState as any, {
      type: "MILESTONE_PROGRESS",
      milestoneId: "ms1",
      status: "validating" as MilestoneStatus,
      completedUnits: 2,
      totalUnits: 3,
    });
    expect(state.milestones.find((m) => m.id === "ms1")?.status).toBe("validating");
    expect(state.milestones.find((m) => m.id === "ms2")?.status).toBe("planned");
  });

  it("upserts active worker status from websocket events (new agent)", () => {
    const state = missionReducer(seedState as any, {
      type: "AGENT_STATUS",
      agentId: "worker-u2",
      agentType: "worker" as AgentType,
      status: "working" as AgentStatus,
      milestoneId: "ms1",
    });
    expect(state.activeWorkers.some((w) => w.id === "worker-u2")).toBe(true);
    expect(state.activeWorkers.find((w) => w.id === "worker-u2")?.status).toBe("working");
  });

  it("removes terminal workers from activeWorkers on agent_status", () => {
    const state = missionReducer(seedState as any, {
      type: "AGENT_STATUS",
      agentId: "worker-u1",
      agentType: "worker" as AgentType,
      status: "completed" as AgentStatus,
      milestoneId: "ms1",
    });
    expect(state.activeWorkers.find((w) => w.id === "worker-u1")).toBeUndefined();
    expect(state.activeWorkers).toHaveLength(0);
  });

  it("updates mission status on mission_completed", () => {
    const state = missionReducer(seedState as any, {
      type: "MISSION_COMPLETED",
      finalState: "completed",
    });
    expect(state.mission?.status).toBe("completed");
  });

  it("updates mission status to failed on mission_completed with failed state", () => {
    const state = missionReducer(seedState as any, {
      type: "MISSION_COMPLETED",
      finalState: "failed",
    });
    expect(state.mission?.status).toBe("failed");
  });

  it("clears transient errors and logs when setting a different mission", () => {
    const stateWithTransientData = {
      ...seedState,
      errors: [{ code: "mission_crash", message: "Old mission failed", recoverable: false, timestamp: 1 }],
      logs: [{ phase: "planning", message: "Old mission log", timestamp: 1 }],
    };

    const state = missionReducer(stateWithTransientData as any, {
      type: "SET_MISSION",
      mission: { id: "m2", description: "Next", status: "planning", configJson: {} } as any,
      milestones: [],
      workers: [],
      cost: { totalCost: 0, totalTokens: 0, entries: 0 },
    });

    expect(state.errors).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });

  it("resets to initial state", () => {
    const state = missionReducer(seedState as any, { type: "RESET" });
    expect(state.mission).toBeNull();
    expect(state.milestones).toHaveLength(0);
  });

  it("updates mission status from mission_status websocket event", () => {
    const state = missionReducer(seedState as any, {
      type: "MISSION_STATUS",
      status: "failed",
    });
    expect(state.mission?.status).toBe("failed");
  });

  it("ignores mission_status when no mission is loaded", () => {
    const state = missionReducer(initialMissionState, {
      type: "MISSION_STATUS",
      status: "failed",
    });
    expect(state).toEqual(initialMissionState);
  });

  it("replaces milestones list from milestones_set websocket event", () => {
    const newMilestones = [
      { id: "ms3", missionId: "m1", title: "Rescoped", description: "Rescoped", orderIndex: 0, status: "in_progress" as MilestoneStatus, validationContractId: "c3" },
    ];
    const state = missionReducer(seedState as any, {
      type: "MILESTONES_SET",
      milestones: newMilestones as any,
    });
    expect(state.milestones).toHaveLength(1);
    expect(state.milestones[0]?.id).toBe("ms3");
  });
});

const escalationEvent = {
  type: "escalation",
  missionId: "m1",
  checkpointId: "cp1",
  trigger: { kind: "milestone_complete" },
} as any;

const escalatedState = {
  ...seedState,
  escalation: escalationEvent,
} as any;

describe("missionReducer — checkpoint submission lifecycle", () => {
  it("CHECKPOINT_SUBMITTING records pending decision and marks submitting, keeps escalation visible", () => {
    const s = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve" as CheckpointDecision,
    });
    expect(s.escalation).not.toBeNull();
    expect(s.pendingCheckpoint?.decision).toBe("approve");
    expect(s.pendingCheckpoint?.status).toBe("submitting");
    expect(s.pendingCheckpoint?.checkpointId).toBe("cp1");
  });

  it("CHECKPOINT_ACKED clears escalation and pending on accepted ack", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve" as CheckpointDecision,
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "cp1",
      accepted: true,
    });
    expect(s.escalation).toBeNull();
    expect(s.pendingCheckpoint).toBeNull();
    expect(s.pendingCheckpointError).toBeNull();
  });

  it("CHECKPOINT_ACKED restores escalation with error on rejected ack", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve" as CheckpointDecision,
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "cp1",
      accepted: false,
      error: "checkpoint not found",
    });
    expect(s.escalation).not.toBeNull();
    expect(s.pendingCheckpoint).toBeNull();
    expect(s.pendingCheckpointError).toBe("checkpoint not found");
  });

  it("CHECKPOINT_ACKED for a different checkpointId is ignored", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve" as CheckpointDecision,
    });
    const s = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "other-cp",
      accepted: true,
    });
    expect(s.pendingCheckpoint?.status).toBe("submitting");
  });

  it("CLEAR_PENDING_CHECKPOINT_ERROR clears only the error", () => {
    const submitting = missionReducer(escalatedState as any, {
      type: "CHECKPOINT_SUBMITTING",
      decision: "approve" as CheckpointDecision,
    });
    const rejected = missionReducer(submitting as any, {
      type: "CHECKPOINT_ACKED",
      checkpointId: "cp1",
      accepted: false,
      error: "x",
    });
    const cleared = missionReducer(rejected as any, {
      type: "CLEAR_PENDING_CHECKPOINT_ERROR",
    });
    expect(cleared.pendingCheckpointError).toBeNull();
    expect(cleared.escalation).not.toBeNull();
  });
});
