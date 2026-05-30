import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentMission, createMission } from "./api";

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

  it("createMission throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "description is required" }),
    });

    await expect(createMission("")).rejects.toThrow("Failed to create mission: 400");
  });

  it("createMission returns missionId on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ missionId: "m-1", status: "queued" }),
    });

    const result = await createMission("Build a login page");
    expect(result).toEqual({ missionId: "m-1", status: "queued" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/missions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ description: "Build a login page" }),
      }),
    );
  });
});
