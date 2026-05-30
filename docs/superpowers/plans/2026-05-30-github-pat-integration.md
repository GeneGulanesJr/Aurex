# GitHub PAT Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OAuth-based GitHub integration with a simple PAT paste-and-connect flow.

**Architecture:** Backend drops all OAuth infrastructure (Client ID/Secret, callback, nonce state, `exchangeCode`, `revokeToken`). Frontend drops the config form. A single `POST /api/github/connect { token }` validates the PAT against GitHub's user API, stores it, and returns the user profile.

**Tech Stack:** Fastify, React, TypeScript, Vitest, GitHub REST API

---

### Task 1: Strip OAuth from `github-client.ts`

**Files:**
- Modify: `packages/backend/src/clients/github-client.ts`

- [ ] **Step 1: Remove `exchangeCode` and `revokeToken` functions**

Remove these three things from `github-client.ts`:
1. The `GITHUB_OAUTH` constant (only used by `exchangeCode`)
2. The entire `exchangeCode` function
3. The entire `revokeToken` function

The file should end up containing only: `GITHUB_API`, `headers()`, `GitHubUser` interface, `GitHubRepo` interface, `getUser()`, `listRepos()`.

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (no imports of removed functions exist yet — `github.ts` routes still reference them but we'll fix that next)

---

### Task 2: Rewrite `github.ts` routes for PAT flow

**Files:**
- Modify: `packages/backend/src/routes/github.ts`

- [ ] **Step 1: Replace the entire route registration**

Replace the contents of `packages/backend/src/routes/github.ts` with:

```ts
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/clients/github-client.ts packages/backend/src/routes/github.ts
git commit -m "refactor: replace GitHub OAuth with PAT-based connect flow"
```

---

### Task 3: Update `config.ts` and `server.ts`

**Files:**
- Modify: `packages/backend/src/config.ts`
- Modify: `packages/backend/src/server.ts`

- [ ] **Step 1: Remove GitHub fields from `AppConfig` and `loadConfig()`**

In `packages/backend/src/config.ts`:

1. Remove from `AppConfig` interface:
   - `githubClientId?: string;`
   - `githubClientSecret?: string;`
   - `githubCallbackUrl: string;`

2. Remove from `loadConfig()`:
   - The three `const githubClient...` lines
   - The three properties from the returned object: `githubClientId`, `githubClientSecret`, `githubCallbackUrl`

- [ ] **Step 2: Simplify `registerGitHubRoutes` call in `server.ts`**

In `packages/backend/src/server.ts`, change:

```ts
registerGitHubRoutes(app, {
  lapis,
  clientId: config.githubClientId,
  clientSecret: config.githubClientSecret,
  callbackUrl: config.githubCallbackUrl,
});
```

to:

```ts
registerGitHubRoutes(app, { lapis });
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/server.ts
git commit -m "refactor: remove GitHub OAuth env vars from backend config"
```

---

### Task 4: Rewrite GitHub backend tests

**Files:**
- Modify: `packages/backend/__tests__/routes/github.test.ts`

- [ ] **Step 1: Replace test file**

Replace `packages/backend/__tests__/routes/github.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All GitHub tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/__tests__/routes/github.test.ts
git commit -m "test: rewrite GitHub routes tests for PAT-based flow"
```

---

### Task 5: Update frontend `api.ts`

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Remove OAuth types and functions, add PAT connect**

In `packages/frontend/src/api.ts`:

1. Remove the `GitHubConfigResponse` interface
2. Remove the `SaveGitHubConfigRequest` interface
3. Remove the `getGitHubConfig()` function
4. Remove the `saveGitHubConfig()` function
5. Remove the `getGitHubConnectUrl()` function
6. Change `GitHubStatusResponse` to remove `configured`:
   ```ts
   export interface GitHubStatusResponse {
     connected: boolean;
     user: { login: string; avatar_url: string; name: string | null } | null;
   }
   ```
7. Add the new connect function:
   ```ts
   export async function connectGitHub(token: string): Promise<GitHubStatusResponse> {
     const res = await apiFetch("/api/github/connect", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ token }),
     });
     if (!res.ok) throw new Error(`Failed to connect GitHub: ${res.status}`);
     return res.json() as Promise<GitHubStatusResponse>;
   }
   ```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: FAIL — `useGitHub.ts` and `IntegrationsPanel.tsx` still reference removed exports. That's expected, we fix those next.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "refactor: replace GitHub OAuth API calls with PAT connect"
```

---

### Task 6: Rewrite `useGitHub.ts` hook

**Files:**
- Modify: `packages/frontend/src/hooks/useGitHub.ts`

- [ ] **Step 1: Replace the hook**

Replace `packages/frontend/src/hooks/useGitHub.ts` with:

```ts
import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  connectGitHub,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse } from "../api";

export interface GitHubState {
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  loading: boolean;
  error: string | null;
}

export interface UseGitHubReturn extends GitHubState {
  connect: (token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [state, setState] = useState<GitHubState>({
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
      const status = await getGitHubStatus();
      setState((prev) => ({
        ...prev,
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

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(async (token: string) => {
    try {
      const result = await connectGitHub(token);
      setState((prev) => ({
        ...prev,
        connected: result.connected,
        user: result.user,
        error: null,
      }));
      await refreshRepos();
    } catch {
      setState((prev) => ({ ...prev, error: "Invalid GitHub token" }));
    }
  }, [refreshRepos]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
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

  return { ...state, connect, disconnect, refreshRepos };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: May still fail on `IntegrationsPanel.tsx` — that's next.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useGitHub.ts
git commit -m "refactor: simplify useGitHub hook for PAT-based flow"
```

---

### Task 7: Rewrite IntegrationsPanel GitHub section

**Files:**
- Modify: `packages/frontend/src/active/IntegrationsPanel.tsx`

- [ ] **Step 1: Replace GitHub section in IntegrationsPanel**

In `packages/frontend/src/active/IntegrationsPanel.tsx`:

1. Remove from state: `clientId`, `clientSecret`, `callbackUrl`, `saving`
2. Add to state: `token` (string), `connecting` (boolean)
3. Remove the `canSave` computed and `handleSave` function
4. Remove the `useEffect` that loads config fields (keep the PiNyx loading effect)
5. Replace the GitHub section JSX (the `<div style={{ border: ... }}>` containing the form) with:

```tsx
<div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)" }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
    <div>
      <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>GitHub</h3>
      <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
        Connect with a Personal Access Token.
      </p>
    </div>
    <span style={{ color: github.connected ? "var(--success)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
      {github.connected ? "CONNECTED" : "OFFLINE"}
    </span>
  </div>

  {github.user && (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
      <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
      <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
    </div>
  )}

  {!github.connected && (
    <>
      <label style={labelStyle}>Personal Access Token</label>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_xxxxx... (requires 'repo' scope)"
        type="password"
        style={inputStyle}
      />
      <button
        onClick={() => { setConnecting(true); github.connect(token.trim()).finally(() => setConnecting(false)); }}
        disabled={!token.trim() || connecting}
        style={buttonStyle(!!token.trim() && !connecting)}
      >
        {connecting ? "Connecting..." : "Connect"}
      </button>
    </>
  )}

  {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

  {github.connected && (
    <button onClick={() => void github.disconnect()} style={dangerButtonStyle}>
      Disconnect
    </button>
  )}
</div>
```

6. Add the new state variables at the top of the component:
```tsx
const [token, setToken] = useState("");
const [connecting, setConnecting] = useState(false);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/IntegrationsPanel.tsx
git commit -m "feat: replace GitHub OAuth form with PAT input in IntegrationsPanel"
```

---

### Task 8: Simplify `NewMissionForm.tsx`

**Files:**
- Modify: `packages/frontend/src/active/NewMissionForm.tsx`

- [ ] **Step 1: Remove `configured` conditional**

In `packages/frontend/src/active/NewMissionForm.tsx`, remove this block:

```tsx
{github?.configured && !github.connected && (
  <button
    onClick={() => void github.connect()}
    style={{...}}
  >
    Connect GitHub
  </button>
)}
```

This block is no longer needed — the user connects from the IntegrationsPanel, not from the mission form.

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/NewMissionForm.tsx
git commit -m "refactor: remove Connect GitHub button from NewMissionForm"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL tests PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: final cleanup for PAT-based GitHub integration"
```
