import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { getUser, listRepos, exchangeCode } from "../clients/github-client.js";
import { normalizeGitHubCloneUrl, prepareRepoForMission } from "../orchestrator/repo-prep.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
  repoRoot: string;
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

const DEFAULT_GITHUB_APP_ID = "3919010";
const DEFAULT_GITHUB_CLIENT_ID = "Iv23lijYF4sZMcU62MjT";
const DEFAULT_GITHUB_CALLBACK_URL = "http://localhost:3000/api/github/callback";
const DEFAULT_GITHUB_FRONTEND_URL = "http://localhost:8080";

async function resolveGitHubAppConfig(lapis: LaPisClient): Promise<GitHubAppConfig | null> {
  const stored = await lapis.getSetting<GitHubAppConfig>("github_app_config");
  if (stored) return stored;

  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientSecret) return null;

  return {
    app_id: process.env.GITHUB_APP_ID ?? DEFAULT_GITHUB_APP_ID,
    client_id: process.env.GITHUB_CLIENT_ID ?? DEFAULT_GITHUB_CLIENT_ID,
    client_secret: clientSecret,
    private_key: process.env.GITHUB_PRIVATE_KEY ?? "",
    callback_url: process.env.GITHUB_CALLBACK_URL ?? DEFAULT_GITHUB_CALLBACK_URL,
    frontend_url: process.env.GITHUB_FRONTEND_URL ?? DEFAULT_GITHUB_FRONTEND_URL,
    created_at: "environment",
  };
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
  const { lapis, repoRoot } = deps;

  // --- Config CRUD ---

  app.get("/api/github/config", async () => {
    const config = await resolveGitHubAppConfig(lapis);
    if (!config) {
      return {
        configured: false,
        client_id: DEFAULT_GITHUB_CLIENT_ID,
        callback_url: DEFAULT_GITHUB_CALLBACK_URL,
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

  // --- OAuth Flow ---

  app.get("/api/github/connect", async (_request, reply) => {
    const config = await resolveGitHubAppConfig(lapis);
    if (!config) {
      return reply.status(400).send({ error: "GitHub App not configured. Set GITHUB_CLIENT_SECRET." });
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
    const config = await resolveGitHubAppConfig(lapis);
    const frontendUrl = config?.frontend_url ?? DEFAULT_GITHUB_FRONTEND_URL;

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
      const repoName = path.basename(prepared.repoPath);
      await lapis.setSetting(`repo:${repoName}:path`, prepared.repoPath);
      await lapis.setSetting(`repo:${repoName}:fullName`, repo.full_name);
      return {
        fullName: repo.full_name,
        repoPath: prepared.repoPath,
        repoStatus: prepared.repoStatus,
        repoName,
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
