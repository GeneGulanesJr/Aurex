import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { checkpointRoutes, resolveCheckpointDecision, createCheckpointDedupTracker } from "../../src/routes/checkpoints";

function createMockLapis() {
  return {
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-uuid-1", missionId: "m-1", status: "pending" }),
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

  it("404s when the checkpoint belongs to a different mission", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    (lapis.getCheckpoint as any).mockResolvedValue({ id: "cp-x", missionId: "other-mission", status: "pending" });

    app.register(checkpointRoutes, { lapis: lapis as any });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-x", decision: "approve" },
    });

    expect(response.statusCode).toBe(404);
    expect(lapis.resolveCheckpoint).not.toHaveBeenCalled();
  });

  it("404s when the checkpoint does not exist", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    (lapis.getCheckpoint as any).mockRejectedValue(new Error("not found"));

    app.register(checkpointRoutes, { lapis: lapis as any });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: { checkpointId: "cp-missing", decision: "approve" },
    });

    expect(response.statusCode).toBe(404);
    expect(lapis.resolveCheckpoint).not.toHaveBeenCalled();
  });
});

// #84 regression: the shared resolver is the contract core used by BOTH the REST
// route and the WebSocket checkpoint_decision handler. The WS handler mocks the
// resolver in ws/websocket-routes.test.ts, so the ownership + dedup contract
// must be pinned here at the shared function level.
describe("resolveCheckpointDecision (shared by REST + WS, #84 regression)", () => {
  it("rejects when the checkpoint belongs to a different mission", async () => {
    const lapis = createMockLapis();
    (lapis.getCheckpoint as any).mockResolvedValue({ id: "cp-x", missionId: "other-mission", status: "pending" });

    const result = await resolveCheckpointDecision(lapis as any, createCheckpointDedupTracker(), {
      missionId: "m-1",
      checkpointId: "cp-x",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "checkpoint does not belong to this mission" });
    expect(lapis.resolveCheckpoint).not.toHaveBeenCalled();
  });

  it("dedups: a second resolve of the same checkpoint returns duplicate and calls LaPis exactly once", async () => {
    const lapis = createMockLapis();
    const dedup = createCheckpointDedupTracker();

    const input = { missionId: "m-1", checkpointId: "cp-uuid-1", decision: "approve" as const };

    const first = await resolveCheckpointDecision(lapis as any, dedup, input);
    const second = await resolveCheckpointDecision(lapis as any, dedup, input);

    expect(first).toEqual({ ok: true, duplicate: false });
    expect(second).toEqual({ ok: true, duplicate: true });
    // The dedup tracker must prevent LaPis from being mutated twice.
    expect(lapis.resolveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing checkpointId or decision with 400", async () => {
    const lapis = createMockLapis();

    const result = await resolveCheckpointDecision(lapis as any, createCheckpointDedupTracker(), {
      missionId: "m-1",
      checkpointId: "",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, status: 400, error: "checkpointId and decision are required" });
    expect(lapis.resolveCheckpoint).not.toHaveBeenCalled();
  });
});
