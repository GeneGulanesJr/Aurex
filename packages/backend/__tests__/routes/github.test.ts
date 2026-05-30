import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubRoutes } from "../../src/routes/github";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(settings: Record<string, unknown> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings[key] = value; }),
    deleteSetting: vi.fn(async (key: string) => { delete settings[key]; }),
  } as unknown as LaPisClient;
}

describe("GitHub integration config routes", () => {
  it("reports unconfigured when no env or saved config exists", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerGitHubRoutes(app, { lapis, clientId: undefined, clientSecret: undefined, callbackUrl: "http://localhost:8080/api/github/callback" });

    const res = await app.inject({ method: "GET", url: "/api/github/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, connected: false, user: null });
  });

  it("saves GitHub OAuth config through frontend-safe config route", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerGitHubRoutes(app, { lapis, clientId: undefined, clientSecret: undefined, callbackUrl: "http://localhost:8080/api/github/callback" });

    const res = await app.inject({
      method: "POST",
      url: "/api/github/config",
      payload: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
        callbackUrl: "http://localhost:8080/api/github/callback",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, clientId: "github-client-id", callbackUrl: "http://localhost:8080/api/github/callback", hasClientSecret: true });
    expect(lapis.setSetting).toHaveBeenCalledWith("github_config", {
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      callbackUrl: "http://localhost:8080/api/github/callback",
    });
  });

  it("returns saved config without exposing the client secret", async () => {
    const app = Fastify();
    const lapis = createMockLapis({
      github_config: {
        clientId: "saved-id",
        clientSecret: "saved-secret",
        callbackUrl: "http://localhost:8080/api/github/callback",
      },
    });
    registerGitHubRoutes(app, { lapis, clientId: undefined, clientSecret: undefined, callbackUrl: "http://localhost:8080/api/github/callback" });

    const res = await app.inject({ method: "GET", url: "/api/github/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, clientId: "saved-id", callbackUrl: "http://localhost:8080/api/github/callback", hasClientSecret: true });
    expect(JSON.stringify(res.json())).not.toContain("saved-secret");
  });

  it("uses saved config to generate the GitHub authorize URL", async () => {
    const app = Fastify();
    const lapis = createMockLapis({
      github_config: {
        clientId: "saved-id",
        clientSecret: "saved-secret",
        callbackUrl: "http://localhost:8080/api/github/callback",
      },
    });
    registerGitHubRoutes(app, { lapis, clientId: undefined, clientSecret: undefined, callbackUrl: "http://localhost:8080/api/github/callback" });

    const res = await app.inject({ method: "GET", url: "/api/github/connect" });

    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("client_id")).toBe("saved-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/api/github/callback");
  });

  it("rejects connect when GitHub config is missing", async () => {
    const app = Fastify();
    const lapis = createMockLapis();
    registerGitHubRoutes(app, { lapis, clientId: undefined, clientSecret: undefined, callbackUrl: "http://localhost:8080/api/github/callback" });

    const res = await app.inject({ method: "GET", url: "/api/github/connect" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "GitHub OAuth is not configured" });
  });
});
