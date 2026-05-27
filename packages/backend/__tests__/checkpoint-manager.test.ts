import { describe, it, expect, vi, afterEach } from "vitest";
import { createCheckpointManager } from "../src/orchestrator/checkpoint-manager";
import type { LaPisClient } from "../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    createCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1",
      missionId: "m-1",
      trigger: "rescope_limit",
      milestoneId: "ms-1",
      summary: "test",
      status: "pending",
      createdAt: "2026-01-01",
    }),
    getCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1",
      missionId: "m-1",
      trigger: "rescope_limit",
      milestoneId: "ms-1",
      summary: "test",
      status: "pending",
      createdAt: "2026-01-01",
    }),
    resolveCheckpoint: vi.fn().mockResolvedValue({
      id: "cp-test-1",
      missionId: "m-1",
      trigger: "rescope_limit",
      milestoneId: "ms-1",
      summary: "test",
      status: "resolved",
      decision: "approve",
      createdAt: "2026-01-01",
      resolvedAt: "2026-01-01",
    }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

describe("CheckpointManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a checkpoint in LaPis", async () => {
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis);
    const id = await manager.create({
      missionId: "m-1",
      trigger: "rescope_limit",
      milestoneId: "ms-1",
      summary: "too many rescopes",
    });
    expect(id).toBe("cp-test-1");
    expect(lapis.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "m-1", trigger: "rescope_limit" }),
    );
  });

  it("polls until checkpoint is resolved", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });

    let pollCount = 0;
    (lapis.getCheckpoint as any).mockImplementation(async () => {
      pollCount++;
      if (pollCount < 3) {
        return { id: "cp-1", status: "pending" };
      }
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1");

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result.status).toBe("resolved");
    expect(result.decision).toBe("approve");
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });

  it("resolves a checkpoint", async () => {
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis);
    await manager.resolve("cp-1", "rescope", "Try smaller units");
    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith("cp-1", "rescope", "Try smaller units", undefined);
  });

  it("gets pending checkpoints for a mission", async () => {
    const lapis = createMockLapis();
    (lapis.getPendingCheckpoints as any).mockResolvedValue([
      { id: "cp-1", missionId: "m-1", status: "pending" },
    ]);
    const manager = createCheckpointManager(lapis);
    const pending = await manager.getPendingForMission("m-1");
    expect(pending.length).toBe(1);
    expect(lapis.getPendingCheckpoints).toHaveBeenCalledWith("m-1");
  });
});
