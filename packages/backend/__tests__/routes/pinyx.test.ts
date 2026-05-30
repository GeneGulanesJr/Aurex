import { describe, it, expect, vi } from "vitest";
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
  orchestrator: "reasoning-strong",
  worker: "code-fast",
  validator_scrutiny: "reasoning",
  validator_user_testing: "computer-use",
  research: "fast-cheap",
};

describe("PiNyx integration routes", () => {
  it("returns default PiNyx config when no saved config exists", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis, endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints, providers: [] });
  });

  it("saves endpoint, model hints, and providers", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis, endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints });

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

  it("preserves existing provider API key when frontend sends no replacement", async () => {
    const app = Fastify();
    const settings = {
      pinyx_config: {
        endpoint: "http://pinyx.example",
        modelHints: defaultModelHints,
        providers: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "saved-key" }],
      },
    };
    const lapis = createMockLapis(settings);
    registerPinyxRoutes(app, { lapis, endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints });

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
    registerPinyxRoutes(app, { lapis, endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints });

    const res = await app.inject({ method: "GET", url: "/api/pinyx/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers[0]).toEqual({ id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", hasApiKey: true });
    expect(JSON.stringify(res.json())).not.toContain("secret");
  });

  it("fetches models from configured PiNyx endpoint", async () => {
    const app = Fastify();
    const lapis = createMockLapis({ pinyx_config: { endpoint: "http://pinyx.example", modelHints: defaultModelHints, providers: [] } });
    registerPinyxRoutes(app, { lapis, endpoint: "http://pinyx-stub:7331", modelHints: defaultModelHints });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "gpt-4o-mini" }] }) });
    vi.stubGlobal("fetch", mockFetch);

    const res = await app.inject({ method: "GET", url: "/api/pinyx/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [{ id: "gpt-4o-mini" }] });
    expect(mockFetch).toHaveBeenCalledWith("http://pinyx.example/v1/models", expect.objectContaining({ method: "GET" }));
    vi.unstubAllGlobals();
  });
});
