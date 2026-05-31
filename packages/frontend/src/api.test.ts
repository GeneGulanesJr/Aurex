import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentMission, createMission, connectGitHub, getPinyxConfig, savePinyxConfig, getPinyxModels, getPinyxStatus } from "./api";

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

  it("connectGitHub posts PAT token", async () => {
    const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, user }) });

    await expect(connectGitHub("ghp_abc123")).resolves.toEqual({ success: true, user });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "ghp_abc123" }),
      }),
    );
  });

  it("connectGitHub throws on invalid token", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Invalid GitHub token" }) });

    await expect(connectGitHub("bad-token")).rejects.toThrow("Invalid GitHub token");
  });

  it("reads PiNyx integration config", async () => {
    const payload = { endpoint: "http://pinyx-stub:7331", modelHints: { worker: "gpt-4o-mini" }, providers: [] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getPinyxConfig()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/pinyx/config", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("reads PiNyx status", async () => {
    const payload = { configured: true, endpoint: "http://pinyx:7331" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getPinyxStatus()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/pinyx/status", expect.objectContaining({ headers: expect.any(Object) }));
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


});
