// packages/backend/src/routes/github.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { getUser, listRepos } from "../clients/github-client.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
}

interface GitHubTokenSetting {
  access_token: string;
  created_at: string;
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRouteDeps) {
  const { lapis } = deps;

  app.get("/api/github/status", async () => {
    const [tokenData, userData] = await Promise.all([
      lapis.getSetting<GitHubTokenSetting>("github_token"),
      lapis.getSetting("github_user"),
    ]);
    if (!tokenData?.access_token) {
      return { connected: false, user: null };
    }
    return { connected: true, user: userData ?? null };
  });

  app.post("/api/github/connect", async (request, reply) => {
    const { token } = request.body as { token?: string };
    if (!token || typeof token !== "string") {
      return reply.status(400).send({ error: "token is required" });
    }
    try {
      const user = await getUser(token);
      await Promise.all([
        lapis.setSetting("github_token", { access_token: token, created_at: new Date().toISOString() }),
        lapis.setSetting("github_user", user),
      ]);
      return { connected: true, user };
    } catch {
      return reply.status(401).send({ error: "Invalid GitHub token" });
    }
  });

  app.post("/api/github/disconnect", async () => {
    await Promise.all([
      lapis.deleteSetting("github_token"),
      lapis.deleteSetting("github_user"),
    ]);
    return { success: true };
  });

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
}
