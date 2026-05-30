# GitHub App Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PAT-based GitHub integration with a GitHub App user-to-server OAuth flow, fully configurable from the frontend.

**Architecture:** The backend stores GitHub App credentials (App ID, Client ID, Client Secret, Private Key, Callback URL, Frontend URL) in LaPis settings. The frontend IntegrationsPanel shows a config form when unconfigured, a Connect button when configured but disconnected, and user info when connected. The OAuth flow uses CSRF state nonces with 10-minute TTL.

**Tech Stack:** Fastify (backend routes), React hooks + inline styles (frontend), Vitest (tests), LaPis settings (storage)

---

### Task 1: Add `exchangeCode` to GitHub Client

**Files:**
- Modify: `packages/backend/src/clients/github-client.ts`
- Test: `packages/backend/__tests__/clients/github-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/clients/github-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mock
const { exchangeCode } = await import("../../src/clients/github-client.js");

describe("github-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("exchangeCode", () => {
    it("exchanges an OAuth code for an access token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "ghu_abc123", token_type: "bearer", scope: "repo" }),
      });

      const result = await exchangeCode("Iv1.clientid", "shh-secret", "code123", "http://localhost:3000/api/github/callback");

      expect(result).toEqual({
        access_token: "ghu_abc123",
        token_type: "bearer",
        scope: "repo",
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
        }),
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        client_id: "Iv1.clientid",
        client_secret: "shh-secret",
        code: "code123",
        redirect_uri: "http://localhost:3000/api/github/callback",
      });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "bad_verification_code" }),
      });

      await expect(
        exchangeCode("id", "secret", "bad-code", "http://localhost:3000/api/github/callback"),
      ).rejects.toThrow("GitHub exchangeCode failed: 403");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/backend/__tests__/clients/github-client.test.ts`
Expected: FAIL — `exchangeCode` is not exported

- [ ] **Step 3: Write minimal implementation**

Add to `packages/backend/src/clients/github-client.ts`, after the `headers` function:

```ts
export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  callbackUrl: string,
): Promise<GitHubTokenResponse> {
  const res = await fetch(`${GITHUB_OAUTH}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  });
  if (!res.ok) throw new Error(`GitHub exchangeCode failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    token_type: data.token_type as string,
    scope: data.scope as string,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/backend/__tests__/clients/github-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/clients/github-client.ts packages/backend/__tests__/clients/github-client.test.ts
git commit -m "feat: add exchangeCode to github-client for OAuth code exchange"
```

---

### Task 2: Rewrite Backend GitHub Routes

**Files:**
- Modify: `packages/backend/src/routes/github.ts`
- Modify: `packages/backend/__tests__/routes/github.test.ts`

This task rewrites the routes file and its tests together. The routes handle config CRUD, OAuth connect/callback, status, repos, and disconnect.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `packages/backend/__tests__/routes/github.test.ts` with:

```ts
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

import { getUser, listRepos, exchangeCode } from "../../src/clients/github-client.js";

const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockListRepos = listRepos as ReturnType<typeof vi.fn>;
const mockExchangeCode = exchangeCode as ReturnType<typeof vi.fn>;

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
  registerGitHubRoutes(app, { lapis });
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/backend/__tests__/routes/github.test.ts`
Expected: FAIL — routes don't have the new endpoints yet

- [ ] **Step 3: Rewrite the routes file**

Replace the entire contents of `packages/backend/src/routes/github.ts` with:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- packages/backend/__tests__/routes/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/github.ts packages/backend/__tests__/routes/github.test.ts
git commit -m "feat: rewrite GitHub routes for GitHub App OAuth flow

Replaces PAT-based connect with config CRUD, OAuth authorize URL
generation, CSRF-protected callback, and token storage."
```

---

### Task 3: Update Frontend API Layer

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Update the GitHub section of api.ts**

Find and replace the GitHub section in `packages/frontend/src/api.ts`. Replace everything from `export interface GitHubStatusResponse` through the end of `disconnectGitHub` with:

```ts
export interface GitHubStatusResponse {
  connected: boolean;
  user: { login: string; avatar_url: string; name: string | null } | null;
}

export interface GitHubRepoResponse {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GitHubConfigResponse {
  configured: boolean;
  client_id: string | null;
  callback_url: string | null;
  has_client_secret: boolean;
  has_private_key: boolean;
}

export interface GitHubConfigPayload {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  callbackUrl: string;
  frontendUrl: string;
}

export async function getGitHubConfig(): Promise<GitHubConfigResponse> {
  const res = await apiFetch("/api/github/config");
  if (!res.ok) throw new Error(`Failed to fetch GitHub config: ${res.status}`);
  return res.json() as Promise<GitHubConfigResponse>;
}

export async function saveGitHubConfig(payload: GitHubConfigPayload): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save GitHub config: ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}

export async function getGitHubConnectUrl(): Promise<{ url: string }> {
  const res = await apiFetch("/api/github/connect");
  if (!res.ok) throw new Error(`Failed to start GitHub OAuth: ${res.status}`);
  return res.json() as Promise<{ url: string }>;
}

export async function getGitHubStatus(): Promise<GitHubStatusResponse> {
  const res = await apiFetch("/api/github/status");
  if (!res.ok) throw new Error(`Failed to fetch GitHub status: ${res.status}`);
  return res.json() as Promise<GitHubStatusResponse>;
}

export async function getGitHubRepos(): Promise<GitHubRepoResponse[]> {
  const res = await apiFetch("/api/github/repos");
  if (!res.ok) throw new Error(`Failed to fetch GitHub repos: ${res.status}`);
  return res.json() as Promise<GitHubRepoResponse[]>;
}

export async function disconnectGitHub(): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/disconnect", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to disconnect GitHub: ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}
```

Remove `connectGitHub(token: string)` entirely — it no longer exists.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors in `useGitHub.ts` and `IntegrationsPanel.tsx` (expected — they still reference the old `connectGitHub`)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat: update frontend API layer for GitHub App config + OAuth"
```

---

### Task 4: Update useGitHub Hook

**Files:**
- Modify: `packages/frontend/src/hooks/useGitHub.ts`

- [ ] **Step 1: Rewrite the hook**

Replace the entire contents of `packages/frontend/src/hooks/useGitHub.ts` with:

```ts
import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  getGitHubConfig,
  getGitHubConnectUrl,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse, GitHubConfigResponse } from "../api";

export interface GitHubState {
  config: GitHubConfigResponse | null;
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  loading: boolean;
  error: string | null;
}

export interface UseGitHubReturn extends GitHubState {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [state, setState] = useState<GitHubState>({
    config: null,
    connected: false,
    user: null,
    repos: [],
    loading: true,
    error: null,
  });

  const refreshRepos = useCallback(async () => {
    try {
      const repos = await getGitHubRepos();
      setState((prev) => ({ ...prev, repos }));
    } catch {
      setState((prev) => ({ ...prev, repos: [] }));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [status, config] = await Promise.all([
        getGitHubStatus(),
        getGitHubConfig(),
      ]);
      setState((prev) => ({
        ...prev,
        config,
        connected: status.connected,
        user: status.user,
        loading: false,
        error: null,
      }));
      if (status.connected) {
        await refreshRepos();
      }
    } catch {
      setState((prev) => ({
        ...prev,
        connected: false,
        loading: false,
        error: "Failed to check GitHub status",
      }));
    }
  }, [refreshRepos]);

  // Initial load + URL param handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubParam = params.get("github");

    if (githubParam) {
      // Clean URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("github");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.toString());

      if (githubParam === "error") {
        const message = params.get("message") || "OAuth failed";
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(async () => {
    try {
      const { url } = await getGitHubConnectUrl();
      window.location.href = url;
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to start GitHub OAuth" }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
        config: null,
        connected: false,
        user: null,
        repos: [],
        loading: false,
        error: null,
      });
      // Reload config since we only disconnected, not de-configured
      const config = await getGitHubConfig();
      setState((prev) => ({ ...prev, config }));
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to disconnect GitHub" }));
    }
  }, []);

  return { ...state, connect, disconnect, refreshRepos };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors only in `IntegrationsPanel.tsx` (it still passes `token` to `connect`)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useGitHub.ts
git commit -m "feat: rewrite useGitHub hook for GitHub App OAuth flow"
```

---

### Task 5: Rewrite IntegrationsPanel GitHub Section

**Files:**
- Modify: `packages/frontend/src/active/IntegrationsPanel.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `packages/frontend/src/active/IntegrationsPanel.tsx` with:

```tsx
import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { saveGitHubConfig } from "../api";
import { getPinyxConfig, getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
}

export function IntegrationsPanel({ open, github, onClose }: IntegrationsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:5173");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxModels, setPinyxModels] = useState<Array<{ id?: string; name?: string }>>([]);
  const [pinyxSaving, setPinyxSaving] = useState(false);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getPinyxConfig().then(setPinyx).catch(() => setPinyxError("Failed to load PiNyx config"));
    getPinyxModels().then((res) => setPinyxModels(res.models)).catch(() => setPinyxModels([]));
  }, [open]);

  // Reset editing state when panel opens
  useEffect(() => {
    if (open) setEditing(false);
  }, [open]);

  if (!open) return null;

  async function handleSaveConfig() {
    if (!appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()) return;
    setSaving(true);
    try {
      await saveGitHubConfig({
        appId: appId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        privateKey: privateKey.trim(),
        callbackUrl: callbackUrl.trim(),
        frontendUrl: frontendUrl.trim(),
      });
      setEditing(false);
      // Trigger status refresh
      await github.refreshRepos();
    } catch {
      // Error will surface via config state
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    await github.connect();
  }

  async function handleSavePinyx() {
    if (!pinyx) return;
    setPinyxSaving(true);
    setPinyxError(null);
    try {
      const saved = await savePinyxConfig(pinyx);
      setPinyx(saved);
      const models = await getPinyxModels().catch(() => ({ models: [] }));
      setPinyxModels(models.models);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save PiNyx config";
      setPinyxError(msg.includes("502") || msg.includes("Failed") ? "PiNyx endpoint is unreachable" : msg);
    } finally {
      setPinyxSaving(false);
    }
  }

  function setHint(key: string, value: string) {
    if (!pinyx) return;
    setPinyx({ ...pinyx, modelHints: { ...pinyx.modelHints, [key]: value } });
  }

  function setProviderField(index: number, field: "id" | "name" | "baseUrl" | "apiKey", value: string) {
    if (!pinyx) return;
    const providers = [...pinyx.providers];
    providers[index] = { ...providers[index], [field]: value };
    setPinyx({ ...pinyx, providers });
  }

  function addProvider() {
    if (!pinyx) return;
    setPinyx({ ...pinyx, providers: [...pinyx.providers, { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "" }] });
  }

  // Derive GitHub section state
  const configured = github.config?.configured ?? false;
  const showConfigForm = !configured || editing;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <section
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "420px",
          height: "100%",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-24px 0 80px rgba(0,0,0,0.35)",
          padding: "16px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase" }}>
              Integrations
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "12px" }}>
              Configure services Aurex can use.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "18px" }}>×</button>
        </div>

        {/* GitHub Section */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>GitHub</h3>
              <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                {showConfigForm
                  ? "Register a GitHub App at github.com/settings/developers"
                  : "Connect via GitHub App OAuth."}
              </p>
            </div>
            <span style={{ color: github.connected ? "var(--success)" : configured ? "var(--accent)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
              {github.connected ? "CONNECTED" : configured ? "CONFIGURED" : "OFFLINE"}
            </span>
          </div>

          {/* Connected: show user */}
          {github.connected && github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          {/* Config form (unconfigured or editing) */}
          {showConfigForm && (
            <>
              <label style={labelStyle}>App ID</label>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456" style={inputStyle} />

              <label style={labelStyle}>Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Iv1.xxxxx" style={inputStyle} />

              <label style={labelStyle}>Client Secret</label>
              <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GitHub App client secret" type="password" style={inputStyle} />

              <label style={labelStyle}>Private Key (.pem)</label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
              />

              <label style={labelStyle}>Callback URL</label>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="http://localhost:3000/api/github/callback" style={inputStyle} />

              <label style={labelStyle}>Frontend URL</label>
              <input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} placeholder="http://localhost:5173" style={inputStyle} />

              <button
                onClick={() => void handleSaveConfig()}
                disabled={saving || !appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()}
                style={buttonStyle(!!appId.trim() && !!clientId.trim() && !!clientSecret.trim() && !!callbackUrl.trim() && !!frontendUrl.trim() && !saving)}
              >
                {saving ? "Saving..." : editing ? "Update Configuration" : "Save Configuration"}
              </button>
            </>
          )}

          {/* Configured but not editing: show summary + actions */}
          {configured && !showConfigForm && (
            <>
              <div style={{ padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px", marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Client ID</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.client_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Callback</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.callback_url}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Secrets</span>
                  <span style={{ color: "var(--success)", fontSize: "11px" }}>✓ Saved</span>
                </div>
              </div>

              {!github.connected && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setEditing(true)} style={outlineButtonStyle(true)}>Edit</button>
                  <button onClick={() => void handleConnect()} style={buttonStyle(true)}>Connect</button>
                </div>
              )}
            </>
          )}

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

          {github.connected && (
            <button onClick={() => void github.disconnect()} style={dangerButtonStyle}>
              Disconnect
            </button>
          )}
        </div>

        {/* PiNyx Section — unchanged */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)", marginTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>PiNyx</h3>
              <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                Configure gateway endpoint, model routing, and provider keys.
              </p>
            </div>
            <span style={{ color: pinyx ? "var(--success)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
              {pinyx ? "CONFIGURED" : "LOADING"}
            </span>
          </div>

          {pinyx && (
            <>
              <label style={labelStyle}>PiNyx Endpoint</label>
              <input value={pinyx.endpoint} onChange={(e) => setPinyx({ ...pinyx, endpoint: e.target.value })} style={inputStyle} />

              <label style={labelStyle}>Model Routing</label>
              {Object.entries(pinyx.modelHints).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>{key}</span>
                  <input list="pinyx-models" value={value} onChange={(e) => setHint(key, e.target.value)} style={inputStyle} />
                </div>
              ))}
              <datalist id="pinyx-models">
                {pinyxModels.map((model, index) => (
                  <option key={`${model.id ?? model.name ?? index}`} value={model.id ?? model.name ?? ""} />
                ))}
              </datalist>

              <label style={labelStyle}>Providers</label>
              {pinyx.providers.map((provider, index) => (
                <div key={`${provider.id}-${index}`} style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "8px", marginBottom: "8px", background: "var(--bg-surface)" }}>
                  <input value={provider.id} onChange={(e) => setProviderField(index, "id", e.target.value)} placeholder="provider id" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.name} onChange={(e) => setProviderField(index, "name", e.target.value)} placeholder="display name" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.baseUrl} onChange={(e) => setProviderField(index, "baseUrl", e.target.value)} placeholder="base URL" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.apiKey ?? ""} onChange={(e) => setProviderField(index, "apiKey", e.target.value)} placeholder={provider.hasApiKey ? "Saved — enter new key to replace" : "API key"} type="password" style={inputStyle} />
                </div>
              ))}
              <button onClick={addProvider} style={outlineButtonStyle(true)}>+ Add Provider</button>

              {pinyxError && <p style={{ color: "var(--error)", fontSize: "12px" }}>{pinyxError}</p>}
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button onClick={handleSavePinyx} disabled={pinyxSaving} style={buttonStyle(!pinyxSaving)}>
                  {pinyxSaving ? "Saving..." : "Save PiNyx"}
                </button>
                <button onClick={() => getPinyxModels().then((res) => setPinyxModels(res.models)).catch(() => setPinyxError("Failed to fetch models"))} style={outlineButtonStyle(true)}>
                  Refresh Models
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  color: "var(--text-muted)",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "1px",
  marginTop: "10px",
  marginBottom: "4px",
  textTransform: "uppercase",
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  padding: "8px",
  fontSize: "12px",
  outline: "none",
  boxSizing: "border-box",
};

const buttonStyle = (enabled: boolean): CSSProperties => ({
  background: enabled ? "var(--accent)" : "var(--bg-elevated)",
  color: enabled ? "var(--bg-deep)" : "var(--text-muted)",
  border: "none",
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: enabled ? "pointer" : "default",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
  marginTop: "8px",
});

const outlineButtonStyle = (enabled: boolean): CSSProperties => ({
  background: "transparent",
  color: enabled ? "var(--accent)" : "var(--text-muted)",
  border: `1px solid ${enabled ? "var(--accent-dim)" : "var(--border)"}`,
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: enabled ? "pointer" : "default",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
  marginTop: "8px",
});

const dangerButtonStyle: CSSProperties = {
  background: "transparent",
  color: "var(--error)",
  border: "1px solid rgba(239, 68, 68, 0.4)",
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: "pointer",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
  marginTop: "8px",
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/active/IntegrationsPanel.tsx
git commit -m "feat: rewrite IntegrationsPanel GitHub section for GitHub App flow

Three states: unconfigured (form), configured (summary + connect),
connected (user info + disconnect)."
```

---

### Task 6: Final Verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Full build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Save memory and final commit**

```bash
git add -A
git commit -m "feat: GitHub App integration complete — replaces PAT-based flow"
```
