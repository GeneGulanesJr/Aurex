import { describe, it, expect, vi } from "vitest";
import { createCompressionService } from "../src/orchestrator/compression";

describe("CompressionService", () => {
  it("runs compression and reports success", async () => {
    const lapis = { runCompression: vi.fn().mockResolvedValue({ compressed: true }) } as any;
    const emit = vi.fn();
    const compression = createCompressionService(lapis, { emit });

    await compression.run("m1", "post_milestone");

    expect(lapis.runCompression).toHaveBeenCalledWith("m1", "post_milestone");
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not throw when compression endpoint fails", async () => {
    const emit = vi.fn();
    const lapis = { runCompression: vi.fn().mockRejectedValue(new Error("offline")) } as any;
    const compression = createCompressionService(lapis, { emit });

    await expect(compression.run("m1", "budget_threshold")).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ agentId: "compression-m1" }));
  });
});
