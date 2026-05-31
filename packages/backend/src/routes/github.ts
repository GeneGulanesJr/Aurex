import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { getUser, listRepos } from "../clients/github-client.js";
import { normalizeGitHubCloneUrl, prepareRepoForMission } from "../orchestrator/repo-prep.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
  repoRoot: string;
}

interface GitHubTokenSetting {
  access_token: string;
  created_at: string;
}

interface GitHubUserSetting {
  login: string;
  avatar_url: string;
  name: string | null;
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRouteDeps) {
  const { lapis, repoRoot } = deps;

  // --- Connect (PAT) ---

  app.post("/api/github/connect", async (request, reply) => {
    const body = request.body as { token?: string };
    if (!body.token?.trim()) {
      return reply.status(400).send({ error: "Token is required" });
    }

    const token = body.token.trim();

    // Validate token by fetching user info
    let user: { login: string; avatar_url: string; name: string | null };
    try {
      user = await getUser(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      return reply.status(401).send({ error: `Invalid GitHub token: ${message}` });
    }

    // Store token and user
    await Promise.all([
      lapis.setSetting("github_token", {
        access_token: token,
        created_at: new Date().toISOString(),
      }),
      lapis.setSetting("github_user", user),
    ]);

    return { success: true, user };
  });

  // --- Status / Disconnect ---

  app.get("/api/github/status", async () => {
    const [tokenData, userData] = await Promise.all([
      lapis.getSetting<GitHubTokenSetting>("github_token"),
      lapis.getSetting<GitHubUserSetting>("github_user"),
    ]);
    if (!tokenData?.access_token) {
      return { connected: false, user: null };
    }
    return { connected: true, user: userData ?? null };
  });

  app.post("/api/github/disconnect", async () => {
    await Promise.all([
      lapis.deleteSetting("github_token"),
      lapis.deleteSetting("github_user"),
    ]);
    return { success: true };
  });

  // --- Repos ---

  app.get("/api/github/repos", async (_request, reply) => {
    const tokenData = await lapis.getSetting<GitHubTokenSetting>("github_token");
    if (!tokenData?.access_token) {
      return reply.status(401).send({ error: "GitHub not connected" });
    }
    try {
      return await listRepos(tokenData.access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] listRepos error:", message);
      return reply.status(502).send({ error: "Failed to fetch repos from GitHub" });
    }
  });

  // --- Repo Prepare ---

  app.post("/api/github/repos/prepare", async (request, reply) => {
    const tokenData = await lapis.getSetting<GitHubTokenSetting>("github_token");
    if (!tokenData?.access_token) {
      return reply.status(401).send({ error: "GitHub is not connected" });
    }

    const body = request.body as { cloneUrl?: string };
    if (!body.cloneUrl) {
      return reply.status(400).send({ error: "cloneUrl is required" });
    }

    let normalizedCloneUrl: string;
    try {
      normalizedCloneUrl = normalizeGitHubCloneUrl(body.cloneUrl);
    } catch {
      return reply.status(400).send({ error: "Invalid GitHub clone URL" });
    }

    let repos;
    try {
      repos = await listRepos(tokenData.access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] listRepos error:", message);
      return reply.status(502).send({ error: "Failed to fetch repos from GitHub" });
    }

    const repo = repos.find((candidate) => normalizeGitHubCloneUrl(candidate.clone_url) === normalizedCloneUrl);
    if (!repo) {
      return reply.status(403).send({ error: "Repository is not available to this GitHub connection" });
    }

    try {
      const prepared = await prepareRepoForMission({ lapis, parentRepoRoot: repoRoot, cloneUrl: normalizedCloneUrl });
      return {
        fullName: repo.full_name,
        repoPath: prepared.repoPath,
        repoStatus: prepared.repoStatus,
        indexed: false,
        indexingStatus: "unavailable" as const,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] prepare repo error:", message);
      return reply.status(502).send({ error: "Could not prepare repository" });
    }
  });
}
