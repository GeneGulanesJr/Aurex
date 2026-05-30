import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { getUser, listRepos, exchangeCode } from "../clients/github-client.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
}

interface GitHubAppConfig {
  app_id: string;
  client_id: string;
  client_secret: string;
  private_key: string;
  callback_url: string;
  frontend_url: string;
  created_at: string;
}

interface GitHubTokenSetting {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: string;
}

interface GitHubUserSetting {
  login: string;
  avatar_url: string;
  name: string | null;
}

// CSRF state nonces — in-memory, 10-minute TTL
const NONCE_TTL = 10 * 60 * 1000;
const nonces = new Map<string, { createdAt: number }>();

function cleanExpiredNonces() {
  const now = Date.now();
  for (const [key, { createdAt }] of nonces) {
    if (now - createdAt > NONCE_TTL) nonces.delete(key);
  }
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRouteDeps) {
  const { lapis } = deps;

  // --- Config CRUD ---

  app.get("/api/github/config", async () => {
    const config = await lapis.getSetting<GitHubAppConfig>("github_app_config");
    if (!config) {
      return {
        configured: false,
        client_id: null,
        callback_url: null,
        has_client_secret: false,
        has_private_key: false,
      };
    }
    return {
      configured: true,
      client_id: config.client_id,
      callback_url: config.callback_url,
      has_client_secret: !!config.client_secret,
      has_private_key: !!config.private_key,
    };
  });

  app.post("/api/github/config", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const { appId, clientId, clientSecret, privateKey, callbackUrl, frontendUrl } = body;

    if (!appId || !clientId || !clientSecret || !callbackUrl || !frontendUrl) {
      return reply.status(400).send({ error: "appId, clientId, clientSecret, callbackUrl, and frontendUrl are required" });
    }

    await lapis.setSetting("github_app_config", {
      app_id: appId,
      client_id: clientId,
      client_secret: clientSecret,
      private_key: privateKey ?? "",
      callback_url: callbackUrl,
      frontend_url: frontendUrl,
      created_at: new Date().toISOString(),
    });

    return { success: true };
  });

  // --- OAuth Flow ---

  app.get("/api/github/connect", async (_request, reply) => {
    const config = await lapis.getSetting<GitHubAppConfig>("github_app_config");
    if (!config) {
      return reply.status(400).send({ error: "GitHub App not configured" });
    }

    cleanExpiredNonces();
    const state = crypto.randomUUID();
    nonces.set(state, { createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: config.client_id,
      redirect_uri: config.callback_url,
      scope: "repo",
      state,
    });

    return { url: `https://github.com/login/oauth/authorize?${params.toString()}` };
  });

  app.get("/api/github/callback", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { code, state } = query;

    // Get config for secrets + frontend URL
    const config = await lapis.getSetting<GitHubAppConfig>("github_app_config");
    const frontendUrl = config?.frontend_url ?? "http://localhost:5173";

    // Validate CSRF nonce
    cleanExpiredNonces();
    const nonce = nonces.get(state);
    if (!nonce) {
      return reply.redirect(`${frontendUrl}/?github=error&message=invalid_state`);
    }
    nonces.delete(state);

    if (!config) {
      return reply.redirect(`${frontendUrl}/?github=error&message=not_configured`);
    }

    try {
      // Exchange code for token
      const tokenResponse = await exchangeCode(config.client_id, config.client_secret, code, config.callback_url);

      // Fetch user info
      const user = await getUser(tokenResponse.access_token);

      // Store token and user
      await Promise.all([
        lapis.setSetting("github_token", {
          access_token: tokenResponse.access_token,
          token_type: tokenResponse.token_type,
          scope: tokenResponse.scope,
          created_at: new Date().toISOString(),
        }),
        lapis.setSetting("github_user", user),
      ]);

      return reply.redirect(`${frontendUrl}/?github=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] callback error:", message);
      return reply.redirect(`${frontendUrl}/?github=error&message=${encodeURIComponent(message)}`);
    }
  });

  // --- Status / Repos / Disconnect ---

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
