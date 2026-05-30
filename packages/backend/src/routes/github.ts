// packages/backend/src/routes/github.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { exchangeCode, getUser, listRepos, revokeToken } from "../clients/github-client.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

interface GitHubTokenSetting {
  access_token: string;
  created_at: string;
}

const NONCE_TTL = 10 * 60 * 1000;
const nonces = new Map<string, number>();

function cleanExpiredNonces() {
  const now = Date.now();
  for (const [key, createdAt] of nonces) {
    if (now - createdAt > NONCE_TTL) nonces.delete(key);
  }
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRouteDeps) {
  const { lapis, clientId, clientSecret, callbackUrl } = deps;

  app.get("/api/github/status", async () => {
    const [tokenData, userData] = await Promise.all([
      lapis.getSetting<GitHubTokenSetting>("github_token"),
      lapis.getSetting("github_user"),
    ]);
    if (!tokenData?.access_token) {
      return { configured: true, connected: false, user: null };
    }
    return { configured: true, connected: true, user: userData ?? null };
  });

  app.get("/api/github/connect", async () => {
    cleanExpiredNonces();
    const state = crypto.randomUUID();
    nonces.set(state, Date.now());
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "repo",
      state,
      redirect_uri: callbackUrl,
    });
    return { url: `https://github.com/login/oauth/authorize?${params.toString()}` };
  });

  app.get("/api/github/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    if (!code || !state) {
      return reply.redirect("/?github_error=missing_params");
    }

    const createdAt = nonces.get(state);
    nonces.delete(state);
    if (!createdAt || Date.now() - createdAt > NONCE_TTL) {
      return reply.redirect("/?github_error=expired");
    }

    try {
      const token = await exchangeCode(clientId, clientSecret, code, callbackUrl);
      const user = await getUser(token);
      await Promise.all([
        lapis.setSetting("github_token", { access_token: token, created_at: new Date().toISOString() }),
        lapis.setSetting("github_user", user),
      ]);
      return reply.redirect("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] callback error:", message);
      return reply.redirect("/?github_error=exchange_failed");
    }
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

  app.post("/api/github/disconnect", async () => {
    const tokenData = await lapis.getSetting<GitHubTokenSetting>("github_token");
    if (tokenData?.access_token) {
      try {
        await revokeToken(clientId, clientSecret, tokenData.access_token);
      } catch (err) {
        console.error("[github] revoke error (continuing):", err);
      }
    }
    await Promise.all([
      lapis.deleteSetting("github_token"),
      lapis.deleteSetting("github_user"),
    ]);
    return { success: true };
  });
}
