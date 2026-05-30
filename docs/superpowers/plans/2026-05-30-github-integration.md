# GitHub Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub OAuth integration so users can connect their GitHub account, browse repos, and create missions against them from the Aurex UI.

**Architecture:** Standard OAuth 2.0 web flow. Backend proxies all GitHub API calls. Token stored in LaPis via a new settings KV endpoint. Frontend gets a repo picker in the NewMissionForm. No new npm dependencies.

**Tech Stack:** GitHub REST API (native fetch), Fastify routes, React hooks, DESIGN.md CSS custom properties

**Spec:** `docs/superpowers/specs/2026-05-30-github-integration-design.md`

---

## Task 1: LaPis Settings Routes

**Files:**
- This task modifies the **LaPis repo** (`github.com/GeneGulanesJr/LaPis`), NOT Aurex
- Modify: `schema.sql` — add `settings` table
- Create: `src/http/handlers/settings.js` — GET/PUT/DELETE handler
- Modify: `src/http/server.js` — register settings routes

- [ ] **Step 1: Add settings table to schema.sql**

In `schema.sql`, add before the final comment:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 2: Create settings handler**

Create `src/http/handlers/settings.js`:

```js
function getSetting(sqlJson) {
  return async (req, res, { params }) => {
    const rows = sqlJson('SELECT value FROM settings WHERE key = ?', [params.key]);
    if (!rows.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not_found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: params.key, value: JSON.parse(rows[0].value) }));
  };
}

function setSetting(sqlRun) {
  return async (req, res, { params, body }) => {
    if (!body || body.value === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'value is required' }));
    }
    sqlRun(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [params.key, JSON.stringify(body.value)]
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: params.key, value: body.value }));
  };
}

function deleteSetting(sqlRun) {
  return async (req, res, { params }) => {
    sqlRun('DELETE FROM settings WHERE key = ?', [params.key]);
    res.writeHead(204);
    res.end();
  };
}

module.exports = { getSetting, setSetting, deleteSetting };
```

- [ ] **Step 3: Register routes in server.js**

In `src/http/server.js`, inside `buildRoutes(deps)`, add after the `checkpoints` require:

```js
const settings = require('./handlers/settings');
```

And add to the routes array, after the checkpoints routes:

```js
// Settings (KV store)
{ method: 'GET', pattern: '/settings/:key', handler: settings.getSetting(deps.sqlJson) },
{ method: 'PUT', pattern: '/settings/:key', handler: settings.setSetting(deps.sqlRun) },
{ method: 'DELETE', pattern: '/settings/:key', handler: settings.deleteSetting(deps.sqlRun) },
```

- [ ] **Step 4: Update Dockerfile.lapis in Aurex**

The Aurex `Dockerfile.lapis` clones LaPis at build time. The settings routes will be included once the LaPis changes are pushed. No change needed to Dockerfile — it uses `git clone` with `--depth 1`.

- [ ] **Step 5: Commit (in LaPis repo)**

```bash
git add schema.sql src/http/handlers/settings.js src/http/server.js
git commit -m "feat: add settings KV store (GET/PUT/DELETE /settings/:key)"
```

---

## Task 2: Shared Types — GitHubRepo, GitHubStatus

**Files:**
- Modify: `packages/shared/src/types.ts` — add types at end of file
- Modify: `packages/shared/src/index.ts` — no change needed (already re-exports types)

- [ ] **Step 1: Add types**

Append to end of `packages/shared/src/types.ts`:

```ts
export interface GitHubRepo {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  user: { login: string; avatar_url: string; name: string } | null;
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add GitHubRepo and GitHubStatus types"
```

---

## Task 3: Backend GitHub Client

**Files:**
- Create: `packages/backend/src/clients/github-client.ts`

- [ ] **Step 1: Write the client**

Create `packages/backend/src/clients/github-client.ts`:

```ts
// packages/backend/src/clients/github-client.ts

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com";

const headers = (token?: string): Record<string, string> => {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Aurex",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(`${GITHUB_OAUTH}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "User-Agent": "Aurex" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; error?: string };
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error}`);
  if (!data.access_token) throw new Error("No access_token in GitHub response");
  return data.access_token;
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub getUser failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    login: data.login as string,
    avatar_url: data.avatar_url as string,
    name: (data.name as string) ?? null,
  };
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=100`,
    { headers: headers(token) },
  );
  if (!res.ok) throw new Error(`GitHub listRepos failed: ${res.status}`);
  const data = await res.json() as Array<Record<string, unknown>>;
  return data.map((r) => ({
    id: r.id as number,
    full_name: r.full_name as string,
    clone_url: r.clone_url as string,
    private: r.private as boolean,
    default_branch: r.default_branch as string,
    updated_at: r.updated_at as string,
  }));
}

export async function revokeToken(
  clientId: string,
  clientSecret: string,
  token: string,
): Promise<void> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${GITHUB_API}/applications/${clientId}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Aurex",
    },
    body: JSON.stringify({ access_token: token }),
  });
  if (!res.ok && res.status !== 404) {
    // 404 means token already revoked, that's fine
    throw new Error(`GitHub revokeToken failed: ${res.status}`);
  }
}
```

- [ ] **Step 2: Write tests**

Create `packages/backend/__tests__/github-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exchangeCode, getUser, listRepos, revokeToken } from "../src/clients/github-client.js";

describe("github-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("exchangeCode", () => {
    it("exchanges code for access token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "ghp_test123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const token = await exchangeCode("cid", "csec", "code123", "http://localhost/callback");
      expect(token).toBe("ghp_test123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on OAuth error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "bad_verification_code" }),
      }));
      await expect(exchangeCode("cid", "csec", "bad", "http://localhost/callback"))
        .rejects.toThrow("GitHub OAuth error: bad_verification_code");
    });

    it("throws on HTTP error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
      await expect(exchangeCode("cid", "csec", "code", "http://localhost/callback"))
        .rejects.toThrow("GitHub token exchange failed: 422");
    });
  });

  describe("getUser", () => {
    it("returns user profile", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" }),
      }));
      const user = await getUser("token");
      expect(user).toEqual({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" });
    });

    it("returns null name when not set", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "testuser", avatar_url: "https://avatar.url", name: null }),
      }));
      const user = await getUser("token");
      expect(user.name).toBeNull();
    });

    it("throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      await expect(getUser("bad")).rejects.toThrow("GitHub getUser failed: 401");
    });
  });

  describe("listRepos", () => {
    it("returns mapped repos", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 1, full_name: "owner/repo", clone_url: "https://github.com/owner/repo.git",
          private: true, default_branch: "main", updated_at: "2026-01-01T00:00:00Z",
        }]),
      }));
      const repos = await listRepos("token");
      expect(repos).toHaveLength(1);
      expect(repos[0].full_name).toBe("owner/repo");
    });

    it("throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
      await expect(listRepos("bad")).rejects.toThrow("GitHub listRepos failed: 403");
    });
  });

  describe("revokeToken", () => {
    it("sends DELETE with Basic auth", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      vi.stubGlobal("fetch", mockFetch);
      await revokeToken("cid", "csec", "token");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/cid/token",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({ Authorization: expect.stringContaining("Basic") }),
        }),
      );
    });

    it("ignores 404 (already revoked)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(revokeToken("cid", "csec", "token")).resolves.toBeUndefined();
    });

    it("throws on other errors", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      await expect(revokeToken("cid", "csec", "token")).rejects.toThrow("GitHub revokeToken failed: 500");
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/backend/__tests__/github-client.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/clients/github-client.ts packages/backend/__tests__/github-client.test.ts
git commit -m "feat(backend): add GitHub API client with exchange, getUser, listRepos, revokeToken"
```

---

## Task 4: Backend LaPis Client — Settings Methods

**Files:**
- Modify: `packages/backend/src/clients/lapis-client.ts` — add 3 methods

- [ ] **Step 1: Add settings methods to LaPisClient interface and implementation**

Find the last method in the `createLaPisClient` return object (should be `ping`) and add after it:

```ts
    getSetting(key: string) {
      return get<any | null>(`/settings/${key}`).catch(() => null);
    },

    setSetting(key: string, value: any) {
      return post(`/settings/${key}`, { value });
    },

    deleteSetting(key: string) {
      return fetch(`${base}/settings/${key}`, { method: "DELETE" }).then(() => undefined);
    },
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/clients/lapis-client.ts
git commit -m "feat(backend): add getSetting/setSetting/deleteSetting to LaPis client"
```

---

## Task 5: Backend Config — GitHub Env Vars

**Files:**
- Modify: `packages/backend/src/config.ts` — add GitHub vars

- [ ] **Step 1: Add GitHub config fields**

In the `AppConfig` interface, add:

```ts
  githubClientId?: string;
  githubClientSecret?: string;
  githubCallbackUrl: string;
```

In the `loadConfig()` function, add before the return:

```ts
  const githubClientId = env("GITHUB_CLIENT_ID", "");
  const githubClientSecret = env("GITHUB_CLIENT_SECRET", "");
  const githubCallbackUrl = env("GITHUB_CALLBACK_URL", "http://localhost:8080/api/github/callback");
```

And add to the return object:

```ts
    githubClientId: githubClientId || undefined,
    githubClientSecret: githubClientSecret || undefined,
    githubCallbackUrl,
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "feat(backend): add GitHub OAuth env vars to config"
```

---

## Task 6: Backend GitHub Routes

**Files:**
- Create: `packages/backend/src/routes/github.ts`
- Modify: `packages/backend/src/server.ts` — register routes

- [ ] **Step 1: Create GitHub routes**

Create `packages/backend/src/routes/github.ts`:

```ts
// packages/backend/src/routes/github.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import { exchangeCode, getUser, listRepos, revokeToken } from "../clients/github-client.js";

interface GitHubRouteDeps {
  lapis: LaPisClient;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  apiKey: string | null;
}

const NONCE_TTL = 10 * 60 * 1000; // 10 minutes
const nonces = new Map<string, number>();

function cleanExpiredNonces() {
  const now = Date.now();
  for (const [key, createdAt] of nonces) {
    if (now - createdAt > NONCE_TTL) nonces.delete(key);
  }
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRouteDeps) {
  const { lapis, clientId, clientSecret, callbackUrl } = deps;

  // GET /api/github/status
  app.get("/api/github/status", async () => {
    const [tokenData, userData] = await Promise.all([
      lapis.getSetting("github_token"),
      lapis.getSetting("github_user"),
    ]);
    if (!tokenData?.access_token) {
      return { configured: true, connected: false, user: null };
    }
    return {
      configured: true,
      connected: true,
      user: userData ?? null,
    };
  });

  // GET /api/github/connect
  app.get("/api/github/connect", async (_request, reply) => {
    cleanExpiredNonces();
    const state = crypto.randomUUID();
    nonces.set(state, Date.now());
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&state=${state}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
    return { url, state };
  });

  // GET /api/github/callback
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

  // GET /api/github/repos
  app.get("/api/github/repos", async (_request, reply) => {
    const tokenData = await lapis.getSetting("github_token");
    if (!tokenData?.access_token) {
      return reply.status(401).send({ error: "GitHub not connected" });
    }
    try {
      const repos = await listRepos(tokenData.access_token);
      return repos;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] listRepos error:", message);
      return reply.status(502).send({ error: "Failed to fetch repos from GitHub" });
    }
  });

  // POST /api/github/disconnect
  app.post("/api/github/disconnect", async (_request, reply) => {
    const tokenData = await lapis.getSetting("github_token");
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
```

- [ ] **Step 2: Register routes in server.ts**

In `packages/backend/src/server.ts`, after the existing route registrations and before the `app.listen` call, add:

```ts
  // GitHub OAuth (optional — only if configured)
  if (config.githubClientId && config.githubClientSecret) {
    const { registerGitHubRoutes } = await import("./routes/github.js");
    registerGitHubRoutes(app, {
      lapis,
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      callbackUrl: config.githubCallbackUrl,
      apiKey: config.apiKey,
    });
  }
```

- [ ] **Step 3: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/github.ts packages/backend/src/server.ts
git commit -m "feat(backend): GitHub OAuth routes — connect, callback, repos, disconnect"
```

---

## Task 7: Backend — Accept cloneUrl in Mission Creation

**Files:**
- Modify: `packages/backend/src/routes/missions.ts` — accept `cloneUrl` field
- Modify: `packages/backend/src/clients/lapis-client.ts` — store cloneUrl in mission config (already part of configJson)

- [ ] **Step 1: Update mission creation route**

In `packages/backend/src/routes/missions.ts`, change the `POST /api/missions` handler:

Replace:
```ts
    const { description } = request.body as { description: string };
```
With:
```ts
    const { description, cloneUrl } = request.body as { description: string; cloneUrl?: string };
```

And update the config merge:
```ts
    const missionConfig = cloneUrl
      ? { ...defaultMissionConfig, cloneUrl }
      : defaultMissionConfig;
    const mission = await lapis.createMission(description, missionConfig);
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/missions.ts
git commit -m "feat(backend): accept optional cloneUrl in POST /api/missions"
```

---

## Task 8: Frontend API — GitHub Endpoints

**Files:**
- Modify: `packages/frontend/src/api.ts` — add GitHub API functions

- [ ] **Step 1: Add GitHub API functions**

Append to `packages/frontend/src/api.ts`:

```ts
// GitHub integration
export interface GitHubStatusResponse {
  configured: boolean;
  connected: boolean;
  user: { login: string; avatar_url: string; name: string } | null;
}

export interface GitHubRepoResponse {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export async function getGitHubStatus(): Promise<GitHubStatusResponse> {
  const res = await apiFetch("/api/github/status");
  return res.json();
}

export async function getGitHubConnectUrl(): Promise<{ url: string }> {
  const res = await apiFetch("/api/github/connect");
  return res.json();
}

export async function getGitHubRepos(): Promise<GitHubRepoResponse[]> {
  const res = await apiFetch("/api/github/repos");
  return res.json();
}

export async function disconnectGitHub(): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/disconnect", { method: "POST" });
  return res.json();
}
```

- [ ] **Step 2: Update createMission to accept cloneUrl**

Find the existing `createMission` function and update it:

```ts
export async function createMission(description: string, cloneUrl?: string): Promise<{ missionId: string; status: string }> {
  const body: Record<string, string> = { description };
  if (cloneUrl) body.cloneUrl = cloneUrl;
  const res = await apiFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): add GitHub API functions + cloneUrl in createMission"
```

---

## Task 9: Frontend useGitHub Hook

**Files:**
- Create: `packages/frontend/src/hooks/useGitHub.ts`

- [ ] **Step 1: Create the hook**

Create `packages/frontend/src/hooks/useGitHub.ts`:

```ts
import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  getGitHubConnectUrl,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse } from "../api";

export interface GitHubState {
  configured: boolean;
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  loading: boolean;
  error: string | null;
}

export function useGitHub() {
  const [state, setState] = useState<GitHubState>({
    configured: false,
    connected: false,
    user: null,
    repos: [],
    loading: true,
    error: null,
  });

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getGitHubStatus();
      setState((prev) => ({
        ...prev,
        configured: status.configured,
        connected: status.connected,
        user: status.user,
        loading: false,
        error: null,
      }));
      return status;
    } catch {
      setState((prev) => ({
        ...prev,
        configured: false,
        connected: false,
        loading: false,
        error: "Failed to check GitHub status",
      }));
      return { configured: false, connected: false } as GitHubStatusResponse;
    }
  }, []);

  const refreshRepos = useCallback(async () => {
    try {
      const repos = await getGitHubRepos();
      setState((prev) => ({ ...prev, repos }));
    } catch {
      setState((prev) => ({ ...prev, repos: [] }));
    }
  }, []);

  useEffect(() => {
    refreshStatus().then((status) => {
      if (status.connected) refreshRepos();
    });
  }, [refreshStatus, refreshRepos]);

  const connect = useCallback(async () => {
    try {
      const { url } = await getGitHubConnectUrl();
      window.location.assign(url);
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to initiate GitHub connect" }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
        configured: true,
        connected: false,
        user: null,
        repos: [],
        loading: false,
        error: null,
      });
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to disconnect GitHub" }));
    }
  }, []);

  // Check for GitHub error in URL params (from callback redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubError = params.get("github_error");
    if (githubError) {
      const messages: Record<string, string> = {
        expired: "GitHub connection expired. Please try again.",
        exchange_failed: "GitHub authorization failed. Please try again.",
        user_fetch_failed: "Failed to fetch GitHub profile. Please try again.",
        missing_params: "Invalid GitHub callback. Please try again.",
      };
      setState((prev) => ({
        ...prev,
        error: messages[githubError] ?? "GitHub connection error.",
      }));
      window.history.replaceState({}, "", "/");
    }
  }, []);

  return { ...state, connect, disconnect, refreshRepos };
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useGitHub.ts
git commit -m "feat(frontend): add useGitHub hook with connect/disconnect/repos"
```

---

## Task 10: Frontend RepoPicker Component

**Files:**
- Create: `packages/frontend/src/active/RepoPicker.tsx`

- [ ] **Step 1: Create RepoPicker**

Create `packages/frontend/src/active/RepoPicker.tsx`:

```tsx
import { useState } from "react";
import type { GitHubRepoResponse } from "../api";

interface RepoPickerProps {
  repos: GitHubRepoResponse[];
  onSelect: (repo: GitHubRepoResponse) => void;
}

export function RepoPicker({ repos, onSelect }: RepoPickerProps) {
  const [search, setSearch] = useState("");
  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search repositories..."
        style={{
          width: "100%",
          padding: "6px 8px",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          fontSize: "12px",
          fontFamily: '"Inter", sans-serif',
          outline: "none",
        }}
      />
      <div
        style={{
          maxHeight: "200px",
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          background: "var(--bg-inset)",
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: "8px",
              color: "var(--text-muted)",
              fontSize: "11px",
              fontFamily: '"Inter", sans-serif',
            }}
          >
            No repos found
          </div>
        )}
        {filtered.map((repo) => (
          <button
            key={repo.id}
            onClick={() => onSelect(repo)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              padding: "6px 8px",
              background: "none",
              border: "none",
              borderBottom: "1px solid var(--border)",
              color: "var(--text-primary)",
              cursor: "pointer",
              textAlign: "left" as const,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <span style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>
              {repo.full_name}
            </span>
            <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {repo.private && (
                <span
                  style={{
                    fontSize: "9px",
                    padding: "1px 4px",
                    background: "var(--accent-dim)",
                    color: "var(--accent)",
                    borderRadius: "2px",
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  PRIVATE
                </span>
              )}
              <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                {repo.default_branch}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/RepoPicker.tsx
git commit -m "feat(frontend): add RepoPicker searchable dropdown component"
```

---

## Task 11: Frontend — Integrate into App, TopBar, NewMissionForm

**Files:**
- Modify: `packages/frontend/src/App.tsx` — add useGitHub hook
- Modify: `packages/frontend/src/frame/TopBar.tsx` — add GitHub status
- Modify: `packages/frontend/src/active/NewMissionForm.tsx` — add RepoPicker
- Modify: `packages/frontend/src/active/MissionSidebar.tsx` — pass GitHub state

- [ ] **Step 1: Update App.tsx**

In `packages/frontend/src/App.tsx`:
1. Add import: `import { useGitHub } from "./hooks/useGitHub";`
2. Inside `App()` function, after the `useTheme` line, add:

```ts
  const github = useGitHub();
```

3. Pass to TopBar — find the `<TopBar` JSX and add `githubUser={github.user}`:

```tsx
      <TopBar
        connected={connected}
        missionCount={activeMissionCount}
        uptime={uptime}
        theme={theme}
        onThemeChange={setTheme}
        githubUser={github.user}
      />
```

4. Pass to MissionSidebar — find `<MissionSidebar` and add `github={github}`:

```tsx
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
          onCreateMission={handleCreateMission}
          github={github}
        />
```

5. Update `handleCreateMission` to pass cloneUrl:

```ts
  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
  }, [addOptimisticMission]);
```

- [ ] **Step 2: Update TopBar.tsx**

Add `githubUser` to the `TopBarProps` interface:

```ts
interface TopBarProps {
  connected: boolean;
  missionCount: number;
  uptime: string;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  githubUser?: { login: string; avatar_url: string } | null;
}
```

Update the function signature to accept it:

```ts
export function TopBar({ connected, missionCount, uptime, theme, onThemeChange, githubUser }: TopBarProps) {
```

In the right section (after MISSIONS span, before ThemePicker), add a GitHub indicator:

```tsx
        {githubUser ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <img
              src={githubUser.avatar_url}
              alt={githubUser.login}
              style={{ width: "18px", height: "18px", borderRadius: "50%" }}
            />
            <span style={{ color: "var(--text-secondary)" }}>{githubUser.login}</span>
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>GITHUB —</span>
        )}
```

- [ ] **Step 3: Update MissionSidebar.tsx**

Add `github` prop to the MissionSidebar component interface:

```ts
import type { GitHubState } from "../hooks/useGitHub";
```

Add to the props interface and pass through to NewMissionForm.

In `NewMissionForm`, add a `github` prop:

```ts
interface NewMissionFormProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: { configured: boolean; connected: boolean; repos: any[]; connect: () => void };
}
```

Update the form to conditionally show:
- If `github?.connected` → show RepoPicker above the textarea
- If `github?.configured && !github?.connected` → show "Connect GitHub" button
- Otherwise → current behavior (manual)

When RepoPicker selects a repo, store it and pass `clone_url` to `onSubmit`.

- [ ] **Step 4: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All existing tests PASS (new integration is additive, no breaking changes)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/frame/TopBar.tsx packages/frontend/src/active/NewMissionForm.tsx packages/frontend/src/active/MissionSidebar.tsx
git commit -m "feat(frontend): integrate GitHub into App, TopBar, NewMissionForm, MissionSidebar"
```

---

## Task 12: Config — Docker, Env, Progress Tracker

**Files:**
- Modify: `docker-compose.yml` — add GitHub env vars
- Modify: `.env.example` — add GitHub vars
- Modify: `docs/superpowers/plans/PROGRESS.md` — update status

- [ ] **Step 1: Update docker-compose.yml**

In the `backend` service's `environment` section, add:

```yaml
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
      GITHUB_CALLBACK_URL: ${GITHUB_CALLBACK_URL:-http://localhost:8080/api/github/callback}
```

- [ ] **Step 2: Update .env.example**

Append:

```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback
```

- [ ] **Step 3: Update PROGRESS.md**

Add GitHub integration row to the subsystem table and gaps table.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example docs/superpowers/plans/PROGRESS.md
git commit -m "chore: add GitHub OAuth env vars to Docker and env config"
```

---

## Task 13: Full Verification

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 2: Build all packages**

Run: `pnpm run build`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Docker build test**

Run: `docker compose build`
Expected: All 4 images build successfully

- [ ] **Step 5: Final commit if needed**
