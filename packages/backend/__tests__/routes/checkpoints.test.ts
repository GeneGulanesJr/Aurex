import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { checkpointRoutes } from "../../src/routes/checkpoints";

function createMockLapis() {
  return {
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-uuid-1", status: "resolved" }),
  };
}

describe("POST /api/missions/:id/checkpoints", () => {
  it("accepts checkpoint with dedup", async () => {
    const app = Fastify();
    const lapis = createMockLapis();

    app.register(checkpointRoutes, { lapis: lapis as any });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-uuid-1", decision: "approve" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);
    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith("cp-uuid-1", "approve", undefined, undefined, undefined);
  });

  it("returns duplicate for re-submission", async () => {
    const app = Fastify();
    const lapis = createMockLapis();

    app.register(checkpointRoutes, { lapis: lapis as any });

    // First submission
    await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-uuid-1", decision: "approve" },
    });

    // Duplicate
    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-uuid-1", decision: "approve" },
    });

    expect(response.json().duplicate).toBe(true);
  });

  it("forwards rescopeGuidance to LaPis alongside the other optional fields", async () => {
    const app = Fastify();
    const lapis = createMockLapis();

    app.register(checkpointRoutes, { lapis: lapis as any });

    await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: {
        checkpointId: "cp-uuid-rg",
        decision: "approve",
        rescopeGuidance: "Use a different module structure",
        reason: "patchable issues",
      },
    });

    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith(
      "cp-uuid-rg",
      "approve",
      undefined,
      "patchable issues",
      "Use a different module structure",
    );
  });

  it("rejects missing checkpointId or decision", async () => {
    const app = Fastify();
    const lapis = createMockLapis();

    app.register(checkpointRoutes, { lapis: lapis as any });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-uuid-3" },
    });

    expect(response.statusCode).toBe(400);
  });
});
