import { describe, it, expect } from "vitest";
import { missionsReducer, initialMissionsState } from "./useMissions";

describe("missionsReducer", () => {
  it("adds a mission with optimistic description on MISSION_CREATED", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "MISSION_CREATED",
      missionId: "m-1",
      description: "Build a login page",
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0]).toEqual({
      missionId: "m-1",
      state: "planning",
      description: "Build a login page",
    });
    expect(state.selectedMissionId).toBe("m-1");
  });

  it("preserves description when WS_MISSION_QUEUED arrives for same mission", () => {
    const withCreated = missionsReducer(initialMissionsState, {
      type: "MISSION_CREATED",
      missionId: "m-1",
      description: "Build a login page",
    });
    const state = missionsReducer(withCreated, {
      type: "WS_MISSION_QUEUED",
      missionId: "m-1",
      queuePosition: 1,
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0].description).toBe("Build a login page");
    expect(state.missions[0].state).toBe("queued");
    expect(state.missions[0].queuePosition).toBe(1);
  });

  it("adds new mission from WS_MISSION_QUEUED when no MISSION_CREATED was dispatched", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "WS_MISSION_QUEUED",
      missionId: "m-1",
      queuePosition: 1,
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0].missionId).toBe("m-1");
    expect(state.missions[0].description).toBeUndefined();
  });

  it("selects first non-completed mission on SET_MISSIONS", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "SET_MISSIONS",
      missions: [
        { missionId: "m-1", state: "completed" },
        { missionId: "m-2", state: "planning" },
        { missionId: "m-3", state: "queued" },
      ],
    });
    expect(state.selectedMissionId).toBe("m-2");
  });

  it("removes a mission on MISSION_DELETED and clears selection when needed", () => {
    const withMissions = missionsReducer(initialMissionsState, {
      type: "SET_MISSIONS",
      missions: [
        { missionId: "m-1", state: "completed" },
        { missionId: "m-2", state: "failed" },
      ],
    });
    const selected = missionsReducer({ ...withMissions, selectedMissionId: "m-2" }, {
      type: "MISSION_DELETED",
      missionId: "m-2",
    });
    expect(selected.missions.map((m) => m.missionId)).toEqual(["m-1"]);
    expect(selected.selectedMissionId).toBe("m-1");
  });
});
