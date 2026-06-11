import { describe, it, expect, vi } from "vitest";
import { createCompressionService } from "../src/orchestrator/compression";
import type { LaPisClient } from "../src/clients/lapis-client";

function createMockLapis(runResult: unknown): LaPisClient {
  return {
    runCompression: vi.fn().mockResolvedValue(runResult),
  } as unknown as LaPisClient;
}

const mockEventBus = { emit: vi.fn() };

describe("createCompressionService", () => {
  it("returns the compression summary from LaPis", async () => {
    const lapis = createMockLapis({ summary: "Mission is half done; next: build UI", tokensSaved: 4000 });
    const service = createCompressionService(lapis, mockEventBus);

    const result = await service.run("m-1", "post_milestone");

    expect(result).toEqual({ summary: "Mission is half done; next: build UI", tokensSaved: 4000 });
    expect(lapis.runCompression).toHaveBeenCalledWith("m-1", "post_milestone");
  });

  it("emits a mission_log event with the compression summary", async () => {
    const lapis = createMockLapis({ summary: "Compressed 2 milestones", tokensSaved: 1200 });
    const service = createCompressionService(lapis, mockEventBus);

    await service.run("m-1", "budget_threshold");

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mission_log",
        missionId: "m-1",
        phase: "compression",
        message: "Compressed 2 milestones",
        data: expect.objectContaining({ tokensSaved: 1200 }),
      }),
    );
  });

  it("returns null and emits a recoverable error when LaPis returns an error", async () => {
    const lapis = createMockLapis({ summary: null, tokensSaved: 0, error: "db locked" });
    const service = createCompressionService(lapis, mockEventBus);

    const result = await service.run("m-1", "manual");

    expect(result).toBeNull();
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mission_error",
        missionId: "m-1",
        code: "compression_failed",
        recoverable: true,
      }),
    );
  });
});
