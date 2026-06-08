import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentMission, createMission, getGitHubConnectUrl, saveGitHubConfig, getGitHubConfig, getPinyxConfig, savePinyxConfig, getPinyxModels, getPinyxStatus, exploreRepo, getRepoSummary, getRepoHotspots, getRepoSuggestions, getMutationSummary, runMutationTests, getMutationRunStatus } from "./api";

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

  it("getGitHubConnectUrl returns OAuth authorize URL", async () => {
    const payload = { url: "https://github.com/login/oauth/authorize?client_id=Iv1.abc&scope=repo&state=nonce123" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

    await expect(getGitHubConnectUrl()).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("/api/github/connect", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("saveGitHubConfig posts app credentials", async () => {
    const payload = { appId: "123", clientId: "Iv1.abc", clientSecret: "shh", privateKey: "", callbackUrl: "http://localhost:3000/api/github/callback", frontendUrl: "http://localhost:5173" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });

    await expect(saveGitHubConfig(payload)).resolves.toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/github/config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("getGitHubConfig returns config status", async () => {
    const payload = { configured: true, client_id: "Iv1.abc", callback_url: "http://localhost:3000/callback", has_client_secret: true, has_private_key: false };
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

describe("repo explore API", () => {
  beforeEach(() => mockFetch.mockReset());

  it("exploreRepo calls explore endpoint and returns result", async () => {
    const response = { repoName: "my-repo", status: "completed", summary: { files: 10, symbols: 50 } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await exploreRepo("my-repo");
    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/explore", expect.objectContaining({ method: "POST" }));
  });

  it("exploreRepo throws on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(exploreRepo("bad")).rejects.toThrow("Failed to explore repo: 500");
  });

  it("getRepoSummary fetches repo summary", async () => {
    const summary = { files: 10, symbols: 50, edges: 30, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => summary });

    const result = await getRepoSummary("my-repo");
    expect(result).toEqual(summary);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/summary", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("getRepoHotspots fetches repo hotspots", async () => {
    const hotspots = { files: [{ path: "a.ts", module: "core", complexity: 25, symbols: 5 }] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => hotspots });

    const result = await getRepoHotspots("my-repo");
    expect(result).toEqual(hotspots);
  });

  it("getRepoSuggestions fetches suggestions", async () => {
    const suggestions = { suggestions: [{ id: "complexity-a", category: "complexity", title: "Refactor a" }], analysisVersion: "1.0" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => suggestions });

    const result = await getRepoSuggestions("my-repo");
    expect(result.suggestions).toHaveLength(1);
  });

  // --- Mutation testing ---

  it("getMutationSummary fetches the mutation summary", async () => {
    const summary = {
      strykerConfigured: true,
      configPath: "stryker.config.mjs",
      reportPath: "reports/stryker-report.json",
      score: 87.5,
      generatedAt: "2026-06-01T12:00:00Z",
      counts: { killed: 87, survived: 10, timeout: 2, noCoverage: 1, ignored: 0, total: 100 },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => summary });

    const result = await getMutationSummary("my-repo");
    expect(result).toEqual(summary);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/mutation", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("runMutationTests POSTs and returns the runId", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 202, json: async () => ({ runId: "abc-123", status: "starting", startedAt: "2026-06-01T12:00:00Z" }) });

    const result = await runMutationTests("my-repo");
    expect(result.runId).toBe("abc-123");
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/mutation/run", expect.objectContaining({ method: "POST" }));
  });

  it("getMutationRunStatus fetches the run status", async () => {
    const status = { state: "completed" as const, runId: "abc-123", summary: { strykerConfigured: true, configPath: "stryker.config.mjs", reportPath: null, score: 87.5, generatedAt: null, counts: { killed: 10, survived: 1, timeout: 0, noCoverage: 0, ignored: 0, total: 11 } } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => status });

    const result = await getMutationRunStatus("my-repo", "abc-123");
    expect(result).toEqual(status);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/mutation/abc-123", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("runMutationTests throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Stryker is not configured" }) });
    await expect(runMutationTests("my-repo")).rejects.toThrow("Failed to start mutation run: 400");
  });
});
