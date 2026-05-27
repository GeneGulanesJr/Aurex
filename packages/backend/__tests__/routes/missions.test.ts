import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { missionRoutes } from "../../src/routes/missions";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockRunner(activeMissionId: string | null = null) {
  return {
    start: vi.fn(),
    abort: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ state: activeMissionId ? "executing" : "idle", missionId: activeMissionId }),
    getActiveMissionId: vi.fn().mockReturnValue(activeMissionId),
    waitForCompletion: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /api/missions", () => {
  it("creates a mission and returns missionId", async () => {
    const app = Fastify();
    const mockLapis = {
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;
    const runner = createMockRunner();

    app.register(missionRoutes, { lapis: mockLapis, runner });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.missionId).toBe("m-1");
    expect(body.status).toBe("planning");
    expect(runner.start).toHaveBeenCalledWith("m-1");
  });

  it("creates missions with configured concrete PiNyx model hints", async () => {
    const app = Fastify();
    const mockLapis = {
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, {
      lapis: mockLapis,
      runner: createMockRunner(),
      missionConfig: {
        modelHints: {
          orchestrator: "kilo/kilo-auto/free",
          worker: "kilo/kilo-auto/free",
          validator_scrutiny: "kilo/kilo-auto/free",
          validator_user_testing: "kilo/kilo-auto/free",
          research: "kilo/kilo-auto/free",
        },
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
    app.register(missionRoutes, { lapis: mockLapis, runner: createMockRunner() });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/missions/current", () => {
  it("returns 404 when no active mission", async () => {
    const app = Fastify();
    const mockLapis = {} as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis, runner: createMockRunner() });

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/current",
    });

    expect(response.statusCode).toBe(404);
  });
});
