import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentMission } from "./api";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("frontend api", () => {
  beforeEach(() => mockFetch.mockReset());

  it("hydrates the current mission from the backend", async () => {
    const payload = {
      mission: { id: "m-1", description: "Build", status: "running", configJson: {}, createdAt: "now" },
      milestones: [],
      activeWorkers: [],
      cost: { totalCost: 0, totalTokens: 0, entries: 0 },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getCurrentMission()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/missions/current", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("returns null when there is no active mission", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "No active mission" }) });

    await expect(getCurrentMission()).resolves.toBeNull();
  });
});
