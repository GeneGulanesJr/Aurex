import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentMission, createMission, getGitHubConfig, saveGitHubConfig, getPinyxConfig, savePinyxConfig, getPinyxModels } from "./api";

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

  it("getGitHubConfig reads frontend-safe GitHub OAuth config", async () => {
    const payload = { configured: true, clientId: "cid", callbackUrl: "http://localhost:8080/api/github/callback", hasClientSecret: true };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getGitHubConfig()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/github/config", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("reads PiNyx integration config", async () => {
    const payload = { endpoint: "http://pinyx-stub:7331", modelHints: { worker: "gpt-4o-mini" }, providers: [] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getPinyxConfig()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/pinyx/config", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("saves PiNyx integration config", async () => {
    const payload = { endpoint: "http://host.docker.internal:7331", modelHints: { worker: "gpt-4o-mini" }, providers: [] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(savePinyxConfig(payload)).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/pinyx/config",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
  });

  it("gets PiNyx models", async () => {
    const payload = { models: [{ id: "gpt-4o-mini" }] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getPinyxModels()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/pinyx/models", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("saveGitHubConfig posts client id, secret, and callback url", async () => {
    const payload = { configured: true, clientId: "cid", callbackUrl: "http://localhost:8080/api/github/callback", hasClientSecret: true };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(saveGitHubConfig({ clientId: "cid", clientSecret: "secret", callbackUrl: "http://localhost:8080/api/github/callback" })).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/config",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ clientId: "cid", clientSecret: "secret", callbackUrl: "http://localhost:8080/api/github/callback" }),
      }),
    );
  });
});
