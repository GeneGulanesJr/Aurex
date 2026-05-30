import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerGitHubRoutes } from "../../src/routes/github";
import type { LaPisClient } from "../../src/clients/lapis-client";

// Mock github-client to avoid real API calls
vi.mock("../../src/clients/github-client.js", () => ({
  getUser: vi.fn(),
  listRepos: vi.fn(),
}));

import { getUser, listRepos } from "../../src/clients/github-client.js";

const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockListRepos = listRepos as ReturnType<typeof vi.fn>;

function createMockLapis(settings: Record<string, unknown> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings[key] = value; }),
    deleteSetting: vi.fn(async (key: string) => { delete settings[key]; }),
  } as unknown as LaPisClient;
}

describe("GitHub PAT integration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/status", () => {
    it("returns disconnected when no token stored", async () => {
      const app = Fastify();
      const lapis = createMockLapis();
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "GET", url: "/api/github/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: false, user: null });
    });

    it("returns connected with user when token exists", async () => {
      const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
      const app = Fastify();
      const lapis = createMockLapis({
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
        github_user: user,
      });
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "GET", url: "/api/github/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: true, user });
    });
  });

  describe("POST /api/github/connect", () => {
    it("validates token and stores user", async () => {
      const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
      mockGetUser.mockResolvedValueOnce(user);

      const app = Fastify();
      const settings: Record<string, unknown> = {};
      const lapis = createMockLapis(settings);
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: { token: "ghp_abc123" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: true, user });
      expect(lapis.setSetting).toHaveBeenCalledWith("github_token", expect.objectContaining({ access_token: "ghp_abc123" }));
      expect(lapis.setSetting).toHaveBeenCalledWith("github_user", user);
    });

    it("rejects missing token", async () => {
      const app = Fastify();
      const lapis = createMockLapis();
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "token is required" });
    });

    it("rejects invalid token", async () => {
      mockGetUser.mockRejectedValueOnce(new Error("GitHub getUser failed: 401"));

      const app = Fastify();
      const lapis = createMockLapis();
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: { token: "invalid-token" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Invalid GitHub token" });
      expect(lapis.setSetting).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/github/disconnect", () => {
    it("clears stored token and user", async () => {
      const app = Fastify();
      const settings: Record<string, unknown> = {
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
        github_user: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: null },
      };
      const lapis = createMockLapis(settings);
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "POST", url: "/api/github/disconnect" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(lapis.deleteSetting).toHaveBeenCalledWith("github_token");
      expect(lapis.deleteSetting).toHaveBeenCalledWith("github_user");
    });
  });

  describe("GET /api/github/repos", () => {
    it("returns repos when connected", async () => {
      const repos = [{ id: 1, full_name: "octocat/hello-world", clone_url: "https://github.com/octocat/hello-world.git", private: false, default_branch: "main", updated_at: "2026-01-01T00:00:00Z" }];
      mockListRepos.mockResolvedValueOnce(repos);

      const app = Fastify();
      const lapis = createMockLapis({
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
      });
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(repos);
      expect(mockListRepos).toHaveBeenCalledWith("ghp_abc123");
    });

    it("returns 401 when not connected", async () => {
      const app = Fastify();
      const lapis = createMockLapis();
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "GitHub not connected" });
    });

    it("returns 502 when GitHub API fails", async () => {
      mockListRepos.mockRejectedValueOnce(new Error("GitHub listRepos failed: 500"));

      const app = Fastify();
      const lapis = createMockLapis({
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
      });
      registerGitHubRoutes(app, { lapis });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: "Failed to fetch repos from GitHub" });
    });
  });
});
