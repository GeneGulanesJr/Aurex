import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { missionRoutes } from "../../src/routes/missions";
import type { LaPisClient } from "../../src/clients/lapis-client";

describe("POST /api/missions", () => {
  it("creates a mission and returns missionId", async () => {
    const app = Fastify();
    const mockLapis = {
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, { lapis: mockLapis });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.missionId).toBe("m-1");
    expect(body.status).toBe("planning");
  });

  it("rejects missing description", async () => {
    const app = Fastify();
    const mockLapis = {} as unknown as LaPisClient;
    app.register(missionRoutes, { lapis: mockLapis });

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
    app.register(missionRoutes, { lapis: mockLapis });

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/current",
    });

    expect(response.statusCode).toBe(404);
  });
});
