import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerGitHubRoutes } from "../../src/routes/github";
import type { LaPisClient } from "../../src/clients/lapis-client";

// Mock github-client to avoid real API calls
vi.mock("../../src/clients/github-client.js", () => ({
  getUser: vi.fn(),
  listRepos: vi.fn(),
  exchangeCode: vi.fn(),
}));

vi.mock("../../src/orchestrator/repo-prep.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/orchestrator/repo-prep.js")>();
  return {
    ...actual,
    prepareRepoForMission: vi.fn(),
  };
});

import { getUser, listRepos, exchangeCode } from "../../src/clients/github-client.js";
import { prepareRepoForMission } from "../../src/orchestrator/repo-prep.js";

const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockListRepos = listRepos as ReturnType<typeof vi.fn>;
const mockExchangeCode = exchangeCode as ReturnType<typeof vi.fn>;
const mockPrepareRepoForMission = prepareRepoForMission as ReturnType<typeof vi.fn>;

interface GitHubAppConfig {
  app_id: string;
  client_id: string;
  client_secret: string;
  private_key: string;
  callback_url: string;
  frontend_url: string;
  created_at: string;
}

function createMockLapis(settings: Record<string, unknown> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings[key] = value; }),
    deleteSetting: vi.fn(async (key: string) => { delete settings[key]; }),
  } as unknown as LaPisClient;
}

function buildApp(settings: Record<string, unknown> = {}) {
  const lapis = createMockLapis(settings);
  const app = Fastify();
  registerGitHubRoutes(app, { lapis, repoRoot: "/workspace" });
  return { app, lapis, settings };
}

describe("GitHub App integration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/config", () => {
    it("returns unconfigured when no app config stored", async () => {
      const { app } = buildApp();

      const res = await app.inject({ method: "GET", url: "/api/github/config" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        configured: false,
        client_id: null,
        callback_url: null,
        has_client_secret: false,
        has_private_key: false,
      });
    });

    it("returns configured status without secrets", async () => {
      const config: GitHubAppConfig = {
        app_id: "12345",
        client_id: "Iv1.abc",
        client_secret: "shh-secret",
        private_key: "-----BEGIN RSA-----\n...\n-----END RSA-----",
        callback_url: "http://localhost:3000/api/github/callback",
        frontend_url: "http://localhost:5173",
        created_at: "2026-01-01T00:00:00Z",
      };
      const { app } = buildApp({ github_app_config: config });

      const res = await app.inject({ method: "GET", url: "/api/github/config" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({
        configured: true,
        client_id: "Iv1.abc",
        callback_url: "http://localhost:3000/api/github/callback",
        has_client_secret: true,
        has_private_key: true,
      });
      // Ensure no secrets leaked
      expect(JSON.stringify(body)).not.toContain("shh-secret");
      expect(JSON.stringify(body)).not.toContain("BEGIN RSA");
    });
  });

  describe("POST /api/github/config", () => {
    it("saves app config to LaPis settings", async () => {
      const { app, settings } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/config",
        payload: {
          appId: "12345",
          clientId: "Iv1.abc",
          clientSecret: "shh-secret",
          privateKey: "-----BEGIN RSA-----\n...\n-----END RSA-----",
          callbackUrl: "http://localhost:3000/api/github/callback",
          frontendUrl: "http://localhost:5173",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(settings.github_app_config).toEqual({
        app_id: "12345",
        client_id: "Iv1.abc",
        client_secret: "shh-secret",
        private_key: "-----BEGIN RSA-----\n...\n-----END RSA-----",
        callback_url: "http://localhost:3000/api/github/callback",
        frontend_url: "http://localhost:5173",
        created_at: expect.any(String),
      });
    });

    it("rejects missing required fields", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/config",
        payload: { appId: "12345" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "appId, clientId, clientSecret, callbackUrl, and frontendUrl are required" });
    });
  });

  describe("GET /api/github/connect", () => {
    it("returns GitHub authorize URL with state nonce", async () => {
      const config: GitHubAppConfig = {
        app_id: "12345",
        client_id: "Iv1.abc",
        client_secret: "shh-secret",
        private_key: "",
        callback_url: "http://localhost:3000/api/github/callback",
        frontend_url: "http://localhost:5173",
        created_at: "2026-01-01T00:00:00Z",
      };
      const { app } = buildApp({ github_app_config: config });

      const res = await app.inject({ method: "GET", url: "/api/github/connect" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toContain("https://github.com/login/oauth/authorize");
      expect(body.url).toContain("client_id=Iv1.abc");
      expect(body.url).toContain("scope=repo");
      expect(body.url).toContain("state=");
      expect(body.url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fgithub%2Fcallback");
    });

    it("returns 400 when app is not configured", async () => {
      const { app } = buildApp();

      const res = await app.inject({ method: "GET", url: "/api/github/connect" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "GitHub App not configured" });
    });
  });

  describe("GET /api/github/callback", () => {
    const config: GitHubAppConfig = {
      app_id: "12345",
      client_id: "Iv1.abc",
      client_secret: "shh-secret",
      private_key: "",
      callback_url: "http://localhost:3000/api/github/callback",
      frontend_url: "http://localhost:5173",
      created_at: "2026-01-01T00:00:00Z",
    };

    it("exchanges code, stores token and user, redirects to frontend", async () => {
      const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
      mockExchangeCode.mockResolvedValueOnce({
        access_token: "ghu_token123",
        token_type: "bearer",
        scope: "repo",
      });
      mockGetUser.mockResolvedValueOnce(user);

      const { app, settings } = buildApp({ github_app_config: config });

      // First, get a valid state nonce by calling connect
      const connectRes = await app.inject({ method: "GET", url: "/api/github/connect" });
      const connectUrl = new URL(connectRes.json().url);
      const state = connectUrl.searchParams.get("state")!;

      // Now call callback with the same state
      const res = await app.inject({
        method: "GET",
        url: `/api/github/callback?code=code123&state=${state}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5173/?github=connected");
      expect(mockExchangeCode).toHaveBeenCalledWith("Iv1.abc", "shh-secret", "code123", "http://localhost:3000/api/github/callback");
      expect(mockGetUser).toHaveBeenCalledWith("ghu_token123");
      expect(settings.github_token).toEqual({
        access_token: "ghu_token123",
        token_type: "bearer",
        scope: "repo",
        created_at: expect.any(String),
      });
      expect(settings.github_user).toEqual(user);
    });

    it("rejects invalid state nonce", async () => {
      const { app } = buildApp({ github_app_config: config });

      const res = await app.inject({
        method: "GET",
        url: "/api/github/callback?code=code123&state=invalid-nonce",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("github=error");
    });

    it("redirects to frontend on exchange failure", async () => {
      mockExchangeCode.mockRejectedValueOnce(new Error("exchange failed"));

      const { app } = buildApp({ github_app_config: config });

      // Get valid state
      const connectRes = await app.inject({ method: "GET", url: "/api/github/connect" });
      const state = new URL(connectRes.json().url).searchParams.get("state")!;

      const res = await app.inject({
        method: "GET",
        url: `/api/github/callback?code=bad-code&state=${state}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("github=error");
    });
  });

  describe("GET /api/github/status", () => {
    it("returns disconnected when no token stored", async () => {
      const { app } = buildApp();

      const res = await app.inject({ method: "GET", url: "/api/github/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: false, user: null });
    });

    it("returns connected with user when token exists", async () => {
      const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
        github_user: user,
      });

      const res = await app.inject({ method: "GET", url: "/api/github/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: true, user });
    });
  });

  describe("POST /api/github/disconnect", () => {
    it("clears stored token and user but keeps app config", async () => {
      const config: GitHubAppConfig = {
        app_id: "12345",
        client_id: "Iv1.abc",
        client_secret: "shh",
        private_key: "",
        callback_url: "http://localhost:3000/api/github/callback",
        frontend_url: "http://localhost:5173",
        created_at: "2026-01-01T00:00:00Z",
      };
      const { app, lapis, settings } = buildApp({
        github_app_config: config,
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
        github_user: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: null },
      });

      const res = await app.inject({ method: "POST", url: "/api/github/disconnect" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(lapis.deleteSetting).toHaveBeenCalledWith("github_token");
      expect(lapis.deleteSetting).toHaveBeenCalledWith("github_user");
      expect(settings.github_app_config).toBeDefined();
    });
  });

  describe("GET /api/github/repos", () => {
    it("returns repos when connected", async () => {
      const repos = [{ id: 1, full_name: "octocat/hello-world", clone_url: "https://github.com/octocat/hello-world.git", private: false, default_branch: "main", updated_at: "2026-01-01T00:00:00Z" }];
      mockListRepos.mockResolvedValueOnce(repos);

      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(repos);
      expect(mockListRepos).toHaveBeenCalledWith("ghu_abc123");
    });

    it("returns 401 when not connected", async () => {
      const { app } = buildApp();

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "GitHub not connected" });
    });

    it("returns 502 when GitHub API fails", async () => {
      mockListRepos.mockRejectedValueOnce(new Error("GitHub listRepos failed: 500"));

      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: "Failed to fetch repos from GitHub" });
    });
  });

  describe("POST /api/github/repos/prepare", () => {
    const repos = [
      { id: 1, full_name: "octocat/hello-world", clone_url: "https://github.com/octocat/hello-world.git", private: false, default_branch: "main", updated_at: "2026-01-01T00:00:00Z" },
    ];

    it("returns 401 when GitHub is not connected", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/repos/prepare",
        payload: { cloneUrl: "https://github.com/octocat/hello-world.git" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "GitHub is not connected" });
    });

    it("rejects invalid clone URLs", async () => {
      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/repos/prepare",
        payload: { cloneUrl: "https://evil.example/octocat/hello-world.git" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid GitHub clone URL" });
    });

    it("rejects repos not available to the GitHub connection", async () => {
      mockListRepos.mockResolvedValueOnce(repos);
      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/repos/prepare",
        payload: { cloneUrl: "https://github.com/other/repo.git" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Repository is not available to this GitHub connection" });
    });

    it("prepares a repo and returns repo + indexing status", async () => {
      mockListRepos.mockResolvedValueOnce(repos);
      mockPrepareRepoForMission.mockResolvedValueOnce({ repoPath: "/workspace/repos/octocat-hello-world", repoStatus: "cloned" });
      const { app } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/repos/prepare",
        payload: { cloneUrl: "https://github.com/octocat/hello-world.git" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        fullName: "octocat/hello-world",
        repoPath: "/workspace/repos/octocat-hello-world",
        repoStatus: "cloned",
        indexed: false,
        indexingStatus: "unavailable",
      });
      expect(mockPrepareRepoForMission).toHaveBeenCalledWith({
        lapis: expect.any(Object),
        parentRepoRoot: "/workspace",
        cloneUrl: "https://github.com/octocat/hello-world.git",
      });
    });
  });
});
