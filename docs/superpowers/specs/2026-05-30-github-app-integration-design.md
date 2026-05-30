# GitHub App Integration

**Date:** 2026-05-30
**Status:** Approved
**Replaces:** PAT-based GitHub integration (commit history: OAuth → PAT → this)

## Context

Aurex currently uses a GitHub Personal Access Token (PAT) for GitHub integration. The user manually creates a PAT, pastes it into the IntegrationsPanel, and Aurex stores it in LaPis settings. This works but has limitations:

- No fine-grained permission scoping (PAT grants everything or nothing)
- No path to future GitHub App features (webhooks, installation tokens, acting as the app)
- Manual token creation is a poor UX compared to "click Connect → authorize on GitHub"

Moving to a **GitHub App** with user-to-server OAuth flow gives us fine-grained permissions, a proper authorization UX, and room to grow.

## Requirements

- **Single-user / self-hosted** — one GitHub App per Aurex instance, one user
- **Frontend-configured** — all credentials entered in IntegrationsPanel, stored in LaPis settings, no `.env` needed
- **User-to-server OAuth flow** — redirect to GitHub, authorize, callback with token
- **`repo` scope** — full read/write access for current usage (listing repos, cloning) and future usage (pushing branches, opening PRs)
- **CSRF-protected** — state nonce on the OAuth authorize URL

## Design

### 1. Backend — GitHub Client

**File:** `packages/backend/src/clients/github-client.ts`

Keep existing exports unchanged:
- `getUser(token)` — fetches authenticated user
- `listRepos(token)` — lists user repos
- `GitHubUser`, `GitHubRepo` interfaces

Add:
- `exchangeCode(clientId, clientSecret, code, callbackUrl)` — POST to `https://github.com/login/oauth/access_token`, returns `{ access_token, token_type, scope }`

The client remains a stateless utility module.

### 2. LaPis Settings Keys

| Key | Shape | Purpose |
|---|---|---|
| `github_app_config` | `{ app_id, client_id, client_secret, private_key, callback_url, frontend_url, created_at }` | App credentials from IntegrationsPanel form |
| `github_token` | `{ access_token, token_type, scope, created_at }` | OAuth token from successful callback |
| `github_user` | `{ login, avatar_url, name }` | GitHub user profile |

`GET /api/github/config` returns only: `{ configured, client_id, callback_url, has_client_secret, has_private_key }`. Secrets are never returned to the frontend.

### 3. Backend — Routes

**File:** `packages/backend/src/routes/github.ts`

| Route | Method | Purpose |
|---|---|---|
| `/api/github/config` | GET | Returns config status (no secrets) |
| `/api/github/config` | POST | Saves app credentials (including frontend_url) |
| `/api/github/connect` | GET | Returns `{ url }` — GitHub OAuth authorize URL with CSRF state nonce |
| `/api/github/callback` | GET | Exchanges code for token, stores token + user, redirects to frontend |
| `/api/github/status` | GET | Returns connected state + user info |
| `/api/github/repos` | GET | Lists user repos using stored token |
| `/api/github/disconnect` | POST | Deletes token + user (keeps app config) |

**CSRF protection:** In-memory `Map<string, { createdAt: number }>` with 10-minute TTL. Nonce is generated when `/api/github/connect` is called, embedded in the authorize URL, and validated in `/api/github/callback`.

**Callback redirect:** After successful token exchange, the callback route redirects to the frontend with `?github=connected`. The IntegrationsPanel config form includes a **Frontend URL** field (default: `http://localhost:5173`) stored alongside the app config in LaPis. The callback redirects to `{frontendUrl}/?github=connected`. On error, redirects with `?github=error&message=...`.

**Route deps:** `GitHubRouteDeps` only needs `lapis: LaPisClient`. All credentials come from LaPis settings, not env vars.

### 4. Frontend — API Layer

**File:** `packages/frontend/src/api.ts`

Add:
- `getGitHubConfig()` → `{ configured, client_id, callback_url, has_client_secret, has_private_key }`
- `saveGitHubConfig(config: { appId, clientId, clientSecret, privateKey, callbackUrl, frontendUrl })` → saves app credentials

Replace:
- `connectGitHub(token: string)` → removed (was PAT-based)

Keep unchanged:
- `getGitHubConnectUrl()` → `{ url: string }` (already exists, behavior changes to return OAuth URL instead of starting PAT connect)
- `getGitHubStatus()`, `getGitHubRepos()`, `disconnectGitHub()`

Add interfaces:
- `GitHubConfigResponse { configured, client_id, callback_url, has_client_secret, has_private_key }`
- `GitHubConfigPayload { appId, clientId, clientSecret, privateKey, callbackUrl, frontendUrl }`

### 5. Frontend — useGitHub Hook

**File:** `packages/frontend/src/hooks/useGitHub.ts`

Add to state and return:
- `config: GitHubConfigResponse | null` — app configuration status
- `saveConfig(appId, clientId, clientSecret, privateKey, callbackUrl): Promise<void>`
- `connect(): Promise<void>` — no longer takes a token argument; calls `getGitHubConnectUrl()` then does `window.location.href = url`

Remove:
- `connect(token: string)` — replaced by parameterless `connect()`

On mount:
- Check URL params for `?github=connected` → refresh status
- Check URL params for `?github=error` → set error state from `message` param
- Clean URL params after reading them

### 6. Frontend — IntegrationsPanel

**File:** `packages/frontend/src/active/IntegrationsPanel.tsx`

Three states for the GitHub section:

**Unconfigured** (no app credentials saved):
```
┌─ GitHub ──────────────────────── OFFLINE ─┐
│                                            │
│  Connect Aurex to GitHub via GitHub App.   │
│  Create one at github.com/settings/        │
│  developers → New GitHub App               │
│                                            │
│  App ID         [________________]          │
│  Client ID      [________________]          │
│  Client Secret  [________________]          │
│  Private Key    [________________]          │
│                 [________________]          │
│  Callback URL   [________________]          │
│  Frontend URL   [________________]          │
│                                            │
│  [Save Configuration]                       │
└────────────────────────────────────────────┘
```

**Configured, disconnected:**
```
┌─ GitHub ──────────────────── CONFIGURED ──┐
│                                            │
│  Client ID: Iv1.xxxxx                     │
│  Callback: http://localhost:3000/...       │
│  Secrets saved ✓                           │
│                                            │
│  [Edit Configuration]   [Connect]          │
└────────────────────────────────────────────┘
```

**Connected:**
```
┌─ GitHub ───────────────────── CONNECTED ──┐
│                                            │
│  [avatar] username                         │
│                                            │
│  [Disconnect]                              │
└────────────────────────────────────────────┘
```

### 7. Server Registration

**File:** `packages/backend/src/server.ts`

No changes needed. `registerGitHubRoutes(app, { lapis })` already works — the route deps only need LaPis.

### 8. Config

**File:** `packages/backend/src/config.ts`

No changes. No GitHub env vars. All credentials stored in LaPis settings.

## What Gets Removed

- `connectGitHub(token: string)` from `api.ts`
- `connect(token: string)` parameter from `useGitHub.ts`
- PAT input field and related state from `IntegrationsPanel.tsx`
- `POST /api/github/connect` route (accepts `{ token }`) — replaced by `GET /api/github/connect` (returns OAuth URL)

## What Stays the Same

- `getUser(token)` and `listRepos(token)` in github-client.ts
- `GitHubUser` and `GitHubRepo` interfaces
- `GET /api/github/status`, `GET /api/github/repos`, `POST /api/github/disconnect` routes (behavior unchanged)
- Mission runner compatibility (reads `github_token.access_token` from LaPis)
- PiNyx section of IntegrationsPanel (untouched)

## Out of Scope

- Installation tokens / acting as the GitHub App itself (private key stored for future use)
- Webhook endpoints
- Multi-tenant / multi-user support
- Token refresh logic (GitHub App user tokens don't expire by default for single-user)

## Testing

- Unit tests for `exchangeCode` in github-client.ts
- Unit tests for all 7 routes in github.ts (config save/load, nonce generation, callback, status, repos, disconnect)
- Mock LaPis client for route tests
- Verify mission runner still works with new token shape (add `token_type` and `scope` fields — backward compatible since runner only reads `access_token`)
