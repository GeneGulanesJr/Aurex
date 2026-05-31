import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { missionRoutes } from "../../src/routes/missions";
import type { LaPisClient } from "../../src/clients/lapis-client";
import type { MissionRunnerPool } from "../../src/orchestrator/mission-runner-pool";

function createMockPool(activeMissions: Array<{ missionId: string; state: string; queuePosition?: number }> = []): MissionRunnerPool {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    getStatus: vi.fn().mockImplementation((id: string) => {
      const found = activeMissions.find((m) => m.missionId === id);
      return found ?? null;
    }),
    getActiveMissions: vi.fn().mockReturnValue(activeMissions),
    waitForCompletion: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /api/missions", () => {
  it("creates a mission and returns missionId", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockResolvedValue(null),
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;
    const pool = createMockPool();

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.missionId).toBe("m-1");
    expect(body.status).toBe("planning");
    expect(pool.submit).toHaveBeenCalledWith("m-1");
  });

  it("uses saved PiNyx model hints from integration settings when creating missions", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockResolvedValue({
        modelHints: {
          worker: "gpt-4o-mini",
          orchestrator: "claude-sonnet-4",
        },
      }),
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, {
      lapis: mockLapis,
      pool: createMockPool(),
    });

    await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(mockLapis.createMission).toHaveBeenCalledWith(
      "Build auth system",
      expect.objectContaining({
        modelHints: expect.objectContaining({
          worker: "gpt-4o-mini",
          orchestrator: "claude-sonnet-4",
        }),
      }),
    );
  });

  it("creates missions with configured concrete PiNyx model hints", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockResolvedValue({
        endpoint: "http://pinyx:7331",
        modelHints: {
          orchestrator: "kilo/kilo-auto/free",
          worker: "kilo/kilo-auto/free",
          validator_scrutiny: "kilo/kilo-auto/free",
          validator_user_testing: "kilo/kilo-auto/free",
          research: "kilo/kilo-auto/free",
        },
      }),
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, {
      lapis: mockLapis,
      pool: createMockPool(),
      missionConfig: {
        workerTimeouts: { simple: 1, build: 2, testHeavy: 3 },
        costCap: 10,
        maxValidatorRetries: 1,
        maxRescopes: 1,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(mockLapis.createMission).toHaveBeenCalledWith(
      "Build auth system",
      expect.objectContaining({
        modelHints: expect.objectContaining({ orchestrator: "kilo/kilo-auto/free" }),
      }),
    );
  });

  it("rejects missing description", async () => {
    const app = Fastify();
    const mockLapis = {} as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/missions/:id/restart", () => {
  it("resets a failed mission to planning and submits it to the runner pool", async () => {
    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue({ id: "m-failed", description: "Retry me", status: "failed", configJson: {}, createdAt: "now" }),
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as LaPisClient;
    const pool = createMockPool();

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({ method: "POST", url: "/api/missions/m-failed/restart" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ restarted: true, missionId: "m-failed", status: "planning" });
    expect(mockLapis.updateMissionStatus).toHaveBeenCalledWith("m-failed", "planning");
    expect(pool.submit).toHaveBeenCalledWith("m-failed");
  });

  it("rejects restart while mission is already active", async () => {
    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue({ id: "m-active", description: "Already running", status: "running", configJson: {}, createdAt: "now" }),
      updateMissionStatus: vi.fn(),
    } as unknown as LaPisClient;
    const pool = createMockPool([{ missionId: "m-active", state: "executing" }]);

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({ method: "POST", url: "/api/missions/m-active/restart" });

    expect(response.statusCode).toBe(409);
    expect(pool.submit).not.toHaveBeenCalled();
  });
});

describe("GET /api/missions/current", () => {
  it("returns 404 when no active mission", async () => {
    const app = Fastify();
    const mockLapis = {} as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/current",
    });

    expect(response.statusCode).toBe(404);
  });

  it("hydrates current mission with milestones and active workers", async () => {
    const mission = { id: "m1", description: "Ship feature", status: "running", configJson: {} } as any;
    const milestones = [
      { id: "ms1", missionId: "m1", title: "Build", description: "Build", orderIndex: 0, status: "in_progress", validationContractId: "c1" },
    ];
    const units = [
      { id: "u1", milestoneId: "ms1", description: "Active", status: "running", declaredPaths: [], declaredModules: [] },
      { id: "u2", milestoneId: "ms1", description: "Done", status: "completed", declaredPaths: [], declaredModules: [] },
    ];

    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue(mission),
      getMilestonesForMission: vi.fn().mockResolvedValue(milestones),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
      getMissionCost: vi.fn().mockResolvedValue({ totalCost: 1.23, totalTokens: 500, entries: 1 }),
    } as unknown as LaPisClient;
    const pool = createMockPool([{ missionId: "m1", state: "executing" }]);

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({ method: "GET", url: "/api/missions/current" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.milestones).toHaveLength(1);
    expect(body.activeWorkers.map((u: any) => u.id)).toEqual(["u1"]);
  });
});

describe("GET /api/missions/:id", () => {
  it("hydrates mission details with milestones and active workers", async () => {
    const mission = { id: "m1", description: "Ship feature", status: "running", configJson: {} } as any;
    const milestones = [
      { id: "ms1", missionId: "m1", title: "Build", description: "Build", orderIndex: 0, status: "in_progress", validationContractId: "c1" },
    ];
    const units = [
      { id: "u1", milestoneId: "ms1", description: "Active", status: "running", declaredPaths: [], declaredModules: [] },
      { id: "u2", milestoneId: "ms1", description: "Done", status: "completed", declaredPaths: [], declaredModules: [] },
    ];

    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue(mission),
      getMilestonesForMission: vi.fn().mockResolvedValue(milestones),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
      getMissionCost: vi.fn().mockResolvedValue({ totalCost: 1.23, totalTokens: 500, entries: 1 }),
    } as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({ method: "GET", url: "/api/missions/m1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.milestones).toHaveLength(1);
    expect(body.activeWorkers.map((u: any) => u.id)).toEqual(["u1"]);
    expect(body.mission.id).toBe("m1");
  });

  it("returns 404 for unknown mission", async () => {
    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockRejectedValue(new Error("not found")),
      getMilestonesForMission: vi.fn().mockRejectedValue(new Error("not found")),
      getMissionCost: vi.fn().mockRejectedValue(new Error("not found")),
    } as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({ method: "GET", url: "/api/missions/unknown" });

    expect(response.statusCode).toBe(404);
  });
});
