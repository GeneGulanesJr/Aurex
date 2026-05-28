import { describe, it, expect } from "vitest";
import { missionReducer, initialMissionState } from "./useMission";
import type { MilestoneStatus, AgentType, AgentStatus } from "@aurex/shared";

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

  it("upserts active worker status from websocket events (existing agent)", () => {
    const state = missionReducer(seedState as any, {
      type: "AGENT_STATUS",
      agentId: "worker-u1",
      agentType: "worker" as AgentType,
      status: "completed" as AgentStatus,
      milestoneId: "ms1",
    });
    expect(state.activeWorkers.find((w) => w.id === "worker-u1")?.status).toBe("completed");
    expect(state.activeWorkers).toHaveLength(1);
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

  it("resets to initial state", () => {
    const state = missionReducer(seedState as any, { type: "RESET" });
    expect(state.mission).toBeNull();
    expect(state.milestones).toHaveLength(0);
  });
});
