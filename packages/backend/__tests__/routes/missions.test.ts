import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/clients/github-client", () => ({
  listRepos: vi.fn(),
}));

import { missionRoutes } from "../../src/routes/missions";
import { listRepos } from "../../src/clients/github-client";
import type { LaPisClient } from "../../src/clients/lapis-client";
import type { MissionRunnerPool } from "../../src/orchestrator/mission-runner-pool";

const mockedListRepos = vi.mocked(listRepos);

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
  beforeEach(() => {
    vi.clearAllMocks();
  });
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

  it("falls back to stub model when PiNyx is unreachable", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockResolvedValue({
        endpoint: "http://unreachable:7331",
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
    const pool = createMockPool();

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    // When PiNyx is unreachable, falls back to stub but still creates the mission
    expect(response.statusCode).toBe(201);
    expect(mockLapis.createMission).toHaveBeenCalledWith(
      "Build auth system",
      expect.objectContaining({
        modelHints: expect.objectContaining({ orchestrator: "kilo/kilo-auto/free" }),
      }),
    );
  });


  it("normalizes and authorizes cloneUrl against the connected GitHub repositories", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === "github_token") return Promise.resolve({ access_token: "gh-token" });
        return Promise.resolve(null);
      }),
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;
    mockedListRepos.mockResolvedValue([
      {
        id: 1,
        full_name: "octocat/hello-world",
        clone_url: "https://github.com/octocat/hello-world.git",
        private: false,
        default_branch: "main",
        updated_at: "2026-06-12T00:00:00Z",
      },
    ] as any);

    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: {
        description: "Build auth system",
        cloneUrl: "https://github.com/octocat/hello-world",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockedListRepos).toHaveBeenCalledWith("gh-token");
    expect(mockLapis.createMission).toHaveBeenCalledWith(
      "Build auth system",
      expect.objectContaining({
        cloneUrl: "https://github.com/octocat/hello-world.git",
      }),
    );
  });

  it("rejects cloneUrl values outside the connected GitHub repositories", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === "github_token") return Promise.resolve({ access_token: "gh-token" });
        return Promise.resolve(null);
      }),
      createMission: vi.fn(),
    } as unknown as LaPisClient;
    mockedListRepos.mockResolvedValue([
      {
        id: 1,
        full_name: "octocat/hello-world",
        clone_url: "https://github.com/octocat/hello-world.git",
        private: false,
        default_branch: "main",
        updated_at: "2026-06-12T00:00:00Z",
      },
    ] as any);

    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: {
        description: "Build auth system",
        cloneUrl: "https://github.com/other/repo.git",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(mockLapis.createMission).not.toHaveBeenCalled();
  });

  it("rejects cloneUrl when GitHub is not connected", async () => {
    const app = Fastify();
    const mockLapis = {
      getSetting: vi.fn().mockResolvedValue(null),
      createMission: vi.fn(),
    } as unknown as LaPisClient;

    app.register(missionRoutes, { lapis: mockLapis, pool: createMockPool() });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: {
        description: "Build auth system",
        cloneUrl: "https://github.com/octocat/hello-world.git",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(mockedListRepos).not.toHaveBeenCalled();
    expect(mockLapis.createMission).not.toHaveBeenCalled();
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

describe("POST /api/missions/:id/abort", () => {
  it("aborts an active mission and marks it aborted in LaPis", async () => {
    const app = Fastify();
    const emitted: unknown[] = [];
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue({ id: "m-run", description: "Stop me", status: "running", configJson: {}, createdAt: "now" }),
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as LaPisClient;
    const pool = createMockPool([{ missionId: "m-run", state: "executing" }]);

    app.register(missionRoutes, {
      lapis: mockLapis,
      pool,
      eventBus: { emit: (event) => emitted.push(event) },
    });

    const response = await app.inject({ method: "POST", url: "/api/missions/m-run/abort" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ aborted: true });
    expect(pool.abort).toHaveBeenCalledWith("m-run");
    expect(mockLapis.updateMissionStatus).toHaveBeenCalledWith("m-run", "aborted");
    expect(emitted).toContainEqual({ type: "mission_status", missionId: "m-run", status: "aborted" });
  });

  it("returns 409 when mission is already terminal", async () => {
    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue({ id: "m-done", description: "Done", status: "completed", configJson: {}, createdAt: "now" }),
      updateMissionStatus: vi.fn(),
    } as unknown as LaPisClient;
    const pool = createMockPool();

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({ method: "POST", url: "/api/missions/m-done/abort" });

    expect(response.statusCode).toBe(409);
    expect(pool.abort).not.toHaveBeenCalled();
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

describe("GET /api/missions/active", () => {
  it("includes aborted missions in sidebar history hydrate", async () => {
    const app = Fastify();
    const mockLapis = {
      listMissions: vi.fn().mockImplementation((query: { status?: string }) => {
        if (query.status === "completed") {
          return Promise.resolve([{ id: "m-done", description: "Done", status: "completed" }]);
        }
        if (query.status === "failed") {
          return Promise.resolve([{ id: "m-fail", description: "Fail", status: "failed" }]);
        }
        if (query.status === "aborted") {
          return Promise.resolve([{ id: "m-stop", description: "Stopped", status: "aborted" }]);
        }
        return Promise.resolve([]);
      }),
    } as unknown as LaPisClient;
    const pool = createMockPool();

    app.register(missionRoutes, { lapis: mockLapis, pool });

    const response = await app.inject({ method: "GET", url: "/api/missions/active?includeHistory=10" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.missions.map((m: { missionId: string; state: string }) => m.state)).toEqual(
      expect.arrayContaining(["completed", "failed", "aborted"]),
    );
    expect(mockLapis.listMissions).toHaveBeenCalledWith({ status: "aborted" });
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
