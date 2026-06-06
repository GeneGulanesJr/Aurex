import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerPinyxRoutes } from "../../src/routes/pinyx";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(settings: Record<string, unknown> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings[key] = value; }),
  } as unknown as LaPisClient;
}

const defaultModelHints = {
  orchestrator: "kilo/kilo-auto/free",
  worker: "kilo/kilo-auto/free",
  validator_scrutiny: "kilo/kilo-auto/free",
  validator_user_testing: "kilo/kilo-auto/free",
  research: "kilo/kilo-auto/free",
};

describe("PiNyx integration routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty config when no saved config exists", async () => {
    // Mock fetch to prevent auto-detection from hitting real endpoints
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("mocked"); });

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/config" });

    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ endpoint: "", modelHints: defaultModelHints, providers: [], autoDetected: false });
  });

  it("returns unconfigured status when no saved config", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, endpoint: null });
  });

  it("migrates a legacy saved stub endpoint to real host PiNyx when available", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === "http://host.docker.internal:7331/health") return { ok: true };
      return { ok: false };
    });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis({
      pinyx_config: { endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints, providers: [] },
    });
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ endpoint: "http://host.docker.internal:7331" });
    expect(lapis.setSetting).toHaveBeenCalledWith("pinyx_config", expect.objectContaining({ endpoint: "http://host.docker.internal:7331" }));
  });

  it("returns configured status when config exists", async () => {
    const app = Fastify();
    const lapis = createMockLapis({
      pinyx_config: { endpoint: "http://pinyx.example", modelHints: defaultModelHints, providers: [] },
    });
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, endpoint: "http://pinyx.example" });
  });

  it("saves endpoint, model hints, and providers after validating endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const payload = {
      endpoint: "http://host.docker.internal:7331",
      modelHints: { ...defaultModelHints, worker: "gpt-4o-mini" },
      providers: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" }],
    };
    const res = await app.inject({ method: "POST", url: "/api/pinyx/config", payload });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...payload, providers: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", hasApiKey: true }] });
    expect(lapis.setSetting).toHaveBeenCalledWith("pinyx_config", payload);
  });

  it("syncs keyed providers to PiNyx config after saving", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: {
        endpoint: "http://pinyx.example",
        modelHints: defaultModelHints,
        providers: [{ id: "zai", name: "Z.AI Coding", baseUrl: "https://api.z.ai/api/coding/paas/v4", apiKey: "zai-key" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith("http://pinyx.example/api/config", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        gateway: { host: "0.0.0.0", port: 7331 },
        providers: {
          zai: { api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4", apiKey: "zai-key", models: [] },
        },
      }),
    }));
  });

  it("auto-detects endpoint when saving config with no endpoint", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === "http://host.docker.internal:7331/health") return { ok: true };
      if (url === "http://host.docker.internal:7331/v1/models") return { ok: true, json: async () => ({ data: [] }) };
      if (url === "http://host.docker.internal:7331/api/config") return { ok: true, json: async () => ({ ok: true }) };
      return { ok: false };
    });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: { endpoint: "", modelHints: defaultModelHints, providers: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ endpoint: "http://host.docker.internal:7331" });
    expect(lapis.setSetting).toHaveBeenCalledWith("pinyx_config", expect.objectContaining({ endpoint: "http://host.docker.internal:7331" }));
  });

  it("rejects save when endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: { endpoint: "http://bad-host:7331", modelHints: defaultModelHints, providers: [] },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "Cannot reach PiNyx endpoint" });
    expect(lapis.setSetting).not.toHaveBeenCalled();
  });

  it("preserves existing provider API key when frontend sends no replacement", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", mockFetch);

    const settings = {
      pinyx_config: {
        endpoint: "http://pinyx.example",
        modelHints: defaultModelHints,
        providers: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "saved-key" }],
      },
    };
    const app = Fastify();
    const lapis = createMockLapis(settings);
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: {
        endpoint: "http://pinyx.example",
        modelHints: defaultModelHints,
        providers: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(lapis.setSetting).toHaveBeenCalledWith("pinyx_config", expect.objectContaining({
      providers: [expect.objectContaining({ apiKey: "saved-key" })],
    }));
  });

  it("does not expose saved provider API keys", async () => {
    const app = Fastify();
    const lapis = createMockLapis({
      pinyx_config: {
        endpoint: "http://host.docker.internal:7331",
        modelHints: defaultModelHints,
        providers: [{ id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "secret" }],
      },
    });
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers[0]).toEqual({ id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", hasApiKey: true });
    expect(JSON.stringify(res.json())).not.toContain("secret");
  });

  it("returns no models when no provider API key is configured", async () => {
    const app = Fastify();
    const lapis = createMockLapis({ pinyx_config: { endpoint: "http://pinyx.example", modelHints: defaultModelHints, providers: [] } });
    registerPinyxRoutes(app, { lapis });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "fake-stub-model" }] }) });
    vi.stubGlobal("fetch", mockFetch);

    const res = await app.inject({ method: "GET", url: "/api/pinyx/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches models from configured PiNyx endpoint when a provider key exists", async () => {
    const app = Fastify();
    const lapis = createMockLapis({
      pinyx_config: {
        endpoint: "http://pinyx.example",
        modelHints: defaultModelHints,
        providers: [{ id: "zai", name: "Z.AI Coding", baseUrl: "https://api.z.ai/api/coding/paas/v4", apiKey: "zai-key" }],
      },
    });
    registerPinyxRoutes(app, { lapis });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "glm-4.7" }] }) });
    vi.stubGlobal("fetch", mockFetch);

    const res = await app.inject({ method: "GET", url: "/api/pinyx/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [{ id: "glm-4.7" }] });
    expect(mockFetch).toHaveBeenCalledWith("http://pinyx.example/api/config", expect.objectContaining({ method: "PUT" }));
    expect(mockFetch).toHaveBeenCalledWith("http://pinyx.example/v1/models", expect.objectContaining({ method: "GET" }));
  });

  it("rejects models fetch when PiNyx not configured", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/models" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "PiNyx is not configured" });
  });

  it("accepts a MiniMax provider and tags it openai-completions", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: {
        endpoint: "http://pinyx.example:7331",
        modelHints: defaultModelHints,
        providers: [
          { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", apiKey: "sk-test" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers).toEqual([
      expect.objectContaining({ id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", hasApiKey: true }),
    ]);
    expect(lapis.setSetting).toHaveBeenCalledWith("pinyx_config", expect.objectContaining({
      providers: [expect.objectContaining({ id: "minimax", apiKey: "sk-test" })],
    }));

    // Verify PiNyx receives openai-completions for minimax
    const putCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" && url.endsWith("/api/config") && (init as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const putBody = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(putBody.providers.minimax).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "sk-test",
    });
  });
});
