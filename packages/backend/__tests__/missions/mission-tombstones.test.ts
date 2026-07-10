import { describe, it, expect } from "vitest";
import {
  filterDeletedMissions,
} from "../../src/missions/mission-tombstones.js";

describe("mission tombstones", () => {
  it("filters deleted mission ids from mission lists", () => {
    const missions = [
      { missionId: "m-1", state: "completed" },
      { missionId: "m-2", state: "failed" },
      { missionId: "m-3", state: "aborted" },
    ];
    const filtered = filterDeletedMissions(missions, new Set(["m-2"]));
    expect(filtered.map((m) => m.missionId)).toEqual(["m-1", "m-3"]);
  });
});
