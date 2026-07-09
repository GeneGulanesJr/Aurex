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
    await manager.resolve("cp-1", "approve", "Looks good");
    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith("cp-1", "approve", "Looks good", undefined, undefined);
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

  it("retries when getCheckpoint returns null (LaPis not ready)", async () => {
    // Kills L36:17 ConditionalExpression → false (skips retry)
    // and L36:30 NoCoverage BlockStatement (retry body never covered)
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });

    let pollCount = 0;
    (lapis.getCheckpoint as any).mockImplementation(async () => {
      pollCount++;
      if (pollCount < 2) {
        // First poll: LaPis doesn't have the route yet
        return null;
      }
      return { id: "cp-1", status: "resolved", decision: "rescope" };
    });

    const promise = manager.waitForResolution("cp-1");
    await vi.advanceTimersByTimeAsync(100); // first poll returns null
    await vi.advanceTimersByTimeAsync(100); // second poll returns resolved
    const result = await promise;
    expect(result.status).toBe("resolved");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("retries when getCheckpoint throws", async () => {
    // Kills L35:78 ArrowFunction → () => undefined and L33:15 ConditionalExpression → false
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });

    let pollCount = 0;
    (lapis.getCheckpoint as any).mockImplementation(async () => {
      pollCount++;
      if (pollCount < 2) {
        throw new Error("LaPis offline");
      }
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1");
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.status).toBe("resolved");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("stops polling after resolution (kills L42 BooleanLiteral → false)", async () => {
    // After resolution, stopped=true prevents further polls.
    // If mutant disables stopped=true, polling continues.
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });

    let pollCount = 0;
    (lapis.getCheckpoint as any).mockImplementation(async () => {
      pollCount++;
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1");
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    // If stopped is set properly, polling stops after first resolved response
    expect(pollCount).toBe(1);
  });

  it("rejects when abort fires while getCheckpoint is in flight", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });
    const controller = new AbortController();

    (lapis.getCheckpoint as any).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1", controller.signal);
    const rejection = expect(promise).rejects.toThrow("Mission aborted");
    await vi.advanceTimersByTimeAsync(25);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("resolves when checkpoint resolves before abort", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis, { pollIntervalMs: 100 });
    const controller = new AbortController();

    (lapis.getCheckpoint as any).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: "cp-1", status: "resolved", decision: "approve" };
    });

    const promise = manager.waitForResolution("cp-1", controller.signal);
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;
    expect(result.status).toBe("resolved");
    controller.abort();
  });

  it("returns empty array when getPendingCheckpoints fails (kills L62 ArrowFunction)", async () => {
    // Kills L62:59 ArrowFunction → () => undefined.
    // Mutant returns undefined instead of [].
    const lapis = createMockLapis();
    (lapis.getPendingCheckpoints as any).mockRejectedValue(new Error("db down"));
    const manager = createCheckpointManager(lapis);
    const pending = await manager.getPendingForMission("m-1");
    expect(Array.isArray(pending)).toBe(true);
    expect(pending).toEqual([]);
  });

  it("resolves with all optional parameters", async () => {
    // Kills L47:27 NoCoverage BlockStatement and L48:23 BooleanLiteral → false
    const lapis = createMockLapis();
    const manager = createCheckpointManager(lapis);
    await manager.resolve("cp-1", "rescope", "try again", "too many failures", "split into smaller units");
    expect(lapis.resolveCheckpoint).toHaveBeenCalledWith(
      "cp-1", "rescope", "try again", "too many failures", "split into smaller units"
    );
  });
});
