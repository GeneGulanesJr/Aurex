import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerGitHubRoutes } from "../../src/routes/github";
import type { LaPisClient } from "../../src/clients/lapis-client";

// Mock github-client to avoid real API calls
vi.mock("../../src/clients/github-client.js", () => ({
  getUser: vi.fn(),
  listRepos: vi.fn(),
}));

vi.mock("../../src/orchestrator/repo-prep.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/orchestrator/repo-prep.js")>();
  return {
    ...actual,
    prepareRepoForMission: vi.fn(),
  };
});

import { getUser, listRepos } from "../../src/clients/github-client.js";
import { prepareRepoForMission } from "../../src/orchestrator/repo-prep.js";

const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockListRepos = listRepos as ReturnType<typeof vi.fn>;
const mockPrepareRepoForMission = prepareRepoForMission as ReturnType<typeof vi.fn>;

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

describe("GitHub PAT integration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/github/connect", () => {
    it("validates token, stores token and user", async () => {
      const user = { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: "Octocat" };
      mockGetUser.mockResolvedValueOnce(user);

      const { app, settings } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: { token: "ghp_abc123" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, user });
      expect(mockGetUser).toHaveBeenCalledWith("ghp_abc123");
      expect(settings.github_token).toEqual({
        access_token: "ghp_abc123",
        created_at: expect.any(String),
      });
      expect(settings.github_user).toEqual(user);
    });

    it("rejects missing token", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Token is required" });
    });

    it("rejects empty token", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: { token: "   " },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Token is required" });
    });

    it("returns 401 for invalid token", async () => {
      mockGetUser.mockRejectedValueOnce(new Error("GitHub getUser failed: 401"));

      const { app, settings } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/github/connect",
        payload: { token: "bad-token" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Invalid GitHub token: GitHub getUser failed: 401" });
      expect(settings.github_token).toBeUndefined();
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
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
        github_user: user,
      });

      const res = await app.inject({ method: "GET", url: "/api/github/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: true, user });
    });
  });

  describe("POST /api/github/disconnect", () => {
    it("clears stored token and user", async () => {
      const { app, lapis, settings } = buildApp({
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
        github_user: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1", name: null },
      });

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

      const { app } = buildApp({
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({ method: "GET", url: "/api/github/repos" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(repos);
      expect(mockListRepos).toHaveBeenCalledWith("ghp_abc123");
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
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
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
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
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
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
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
        github_token: { access_token: "ghp_abc123", created_at: "2026-01-01T00:00:00Z" },
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
