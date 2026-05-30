# GitHub Integration — Design Spec

**Date**: 2026-05-30
**Status**: Approved
**Scope**: Full GitHub OAuth integration for repo browsing and mission creation

## Overview

Aurex connects to the user's GitHub account via OAuth 2.0. Once connected, the UI shows a searchable repo picker when creating missions. The backend stores the GitHub token securely and proxies all GitHub API calls — the token never reaches the frontend.

## Architecture

```
User clicks "Connect GitHub"
        │
        ▼
Browser → github.com/login/oauth/authorize?client_id=...&scope=repo&state=<csrf>
        │
        ▼
User authorizes on GitHub
        │
        ▼
GitHub → GET /api/github/callback?code=...&state=<csrf>
        │
        ▼
Backend exchanges code → access_token (server-to-server POST to github.com)
        │
        ▼
Backend stores token + user info in LaPis (keyed values)
        │
        ▼
Backend redirects to frontend (302 → /)
        │
        ▼
Frontend calls GET /api/github/status → { connected, user }
Frontend calls GET /api/github/repos → [{ full_name, clone_url, private, default_branch }]
        │
        ▼
User selects repo → creates mission against it
```

## Backend

### New Files

#### `packages/backend/src/clients/github-client.ts`

Thin wrapper around GitHub REST API using native `fetch` (Node 22 built-in).

**Functions:**
- `exchangeCode(clientId, clientSecret, code, redirectUri)` → `{ access_token }` — POST to `https://github.com/login/oauth/access_token`
- `getUser(token)` → `{ login, avatar_url, name }` — GET `https://api.github.com/user`
- `listRepos(token, opts?)` → `[{ id, full_name, clone_url, private, default_branch, updated_at }]` — GET `https://api.github.com/user/repos?sort=updated&per_page=100`
- `revokeToken(clientId, clientSecret, token)` → void — DELETE `https://api.github.com/applications/{clientId}/token`. Requires HTTP Basic Auth with `clientId:clientSecret` as credentials.

All functions set `Accept: application/vnd.github+json` and `User-Agent: Aurex` headers.

#### `packages/backend/src/routes/github.ts`

Fastify route plugin registered at `/api/github`.

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/github/status` | API key (if configured) | Returns `{ configured: bool, connected: bool, user: { login, avatar_url, name } }` or `{ configured: false, connected: false }` |
| `GET` | `/api/github/repos` | API key (if configured) | Returns array of repos. Returns 401 if not connected. |
| `GET` | `/api/github/callback` | None | OAuth callback. Validates `state` param, exchanges `code` for token, stores in LaPis, redirects to `/` |
| `POST` | `/api/github/disconnect` | API key (if configured) | Revokes token on GitHub, deletes stored token from LaPis |
| `GET` | `/api/github/connect` | API key (if configured) | Returns `{ url }` — the GitHub OAuth authorize URL with generated `state` nonce. State is stored server-side with TTL. |

**Callback flow detail:**
1. Frontend calls `GET /api/github/connect` → gets `{ url }`
2. Frontend redirects browser to `url`
3. GitHub redirects back to `/api/github/callback?code=...&state=...`
4. Backend validates `state` matches its stored nonce (generated in step 1, kept server-side only)
5. Backend calls `exchangeCode()`
6. Backend calls `getUser()` to get profile
7. Backend stores `github_token` and `github_user` in LaPis
8. Backend redirects (302) to frontend root `/`

**Error cases:**
- Unknown/expired `state` → redirect to `/?github_error=expired`
- `exchangeCode` fails (bad code, wrong secret) → redirect to `/?github_error=exchange_failed`
- `getUser` fails (bad token) → redirect to `/?github_error=user_fetch_failed`

> **Note**: The `state` nonce is generated and validated server-side. It passes through the browser URL during the GitHub redirect (standard OAuth behavior) but is never handled or stored by frontend JavaScript code.

### Token Storage (LaPis)

Store as keyed values via a new `settings` route in LaPis.

**LaPis does not currently have a KV/settings endpoint** (verified — `src/http/server.js` has no settings routes). We need to add one.

**New LaPis routes** (in `src/http/handlers/settings.js`):
- `GET /settings/:key` → value or 404
- `PUT /settings/:key` → upsert value (body: `{ value: any }`)
- `DELETE /settings/:key` → 204

**Schema**: Simple `settings` table in SQLite:
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Keys stored:
- `github_token` → `JSON.stringify({ access_token, created_at })`
- `github_user` → `JSON.stringify({ login, avatar_url, name })`

**Aurex LaPis client** gets 3 new methods:
- `getSetting(key)` → parsed value or null
- `setSetting(key, value)` → void
- `deleteSetting(key)` → void

### State Nonce Storage

OAuth `state` parameter is generated and stored server-side only (never sent to the frontend):
- Store in-memory `Map<string, { createdAt: number }>` with 10-minute TTL
- Cleaned up on access (delete after validation)
- No persistence needed — if server restarts during OAuth flow, user just re-connects
- Graceful error handling: if the callback receives an unknown/expired `state`, redirect to `/?github_error=expired` so the frontend can show "Connection expired, please try again"

### Configuration

New environment variables:

| Variable | Required | Description |
|---|---|---|
| `GITHUB_CLIENT_ID` | Yes | OAuth App client ID from GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | Yes | OAuth App client secret |
| `GITHUB_CALLBACK_URL` | No (default: `http://localhost:8080/api/github/callback`) | OAuth callback URL |

These go in `.env` and `docker-compose.yml` environment section.

### Route Registration

Register in `packages/backend/src/server.ts`:
```ts
import { registerGitHubRoutes } from "./routes/github.js";
registerGitHubRoutes(app, lapis, { clientId, clientSecret, callbackUrl });
```

Only register if `GITHUB_CLIENT_ID` is set — gracefully skip if not configured (status endpoint returns `{ connected: false, configured: false }`).

## Frontend

### New Files

#### `packages/frontend/src/hooks/useGitHub.ts`

Hook that manages GitHub connection state.

```ts
interface GitHubState {
  configured: boolean;  // backend has GitHub OAuth configured
  connected: boolean;   // user has authorized
  user: { login: string; avatar_url: string } | null;
  repos: GitHubRepo[];
  loading: boolean;
  error: string | null;
}

interface UseGitHubReturn extends GitHubState {
  connect: () => void;       // redirects to GitHub
  disconnect: () => void;    // calls POST /api/github/disconnect
  refreshRepos: () => void;  // re-fetches repo list
}
```

- On mount: `GET /api/github/status` → sets `connected`, `configured`, `user`
- If connected: auto-fetches `GET /api/github/repos`
- `connect()` — calls `GET /api/github/connect`, redirects browser to the returned `url`

#### `packages/frontend/src/active/GitHubStatus.tsx`

Small component for TopBar — shows GitHub icon (connected/disconnected state). Click to open settings or shows connect button.

#### `packages/frontend/src/active/RepoPicker.tsx`

Searchable dropdown component:
- Text input with search filter
- Lists repos sorted by `updated_at` (most recent first)
- Shows `full_name`, private badge, default branch
- Click to select → calls `onSelect(repo)` callback
- Uses DESIGN.md tokens: `var(--bg-surface)`, `var(--border)`, `var(--text-primary)`, etc.

### Modified Files

#### `packages/frontend/src/App.tsx`

- Add `useGitHub()` hook at top level
- Pass `gitHubState` and `connect/disconnect` to TopBar

#### `packages/frontend/src/active/MissionSidebar.tsx`

- Pass `gitHubState` to NewMissionForm

#### `packages/frontend/src/active/NewMissionForm.tsx`

- Add conditional rendering:
  - If `connected && repos.length > 0` → show RepoPicker
  - If `configured && !connected` → show "Connect GitHub" button
  - If `!configured` → show manual repo path input (current behavior)
- On repo select: the `clone_url` is passed as part of the mission creation payload. The backend's `POST /api/missions` endpoint needs a new optional `cloneUrl` field — if provided, the backend clones the repo into a workspace directory before creating the mission. The `REPO_ROOT` env var is used as the parent directory for cloned repos (e.g., `${REPO_ROOT}/repos/{owner}-{repo}`).

> **Backend change required**: `POST /api/missions` must accept `cloneUrl` in the request body. When present, the mission runner clones the repo before starting the milestone loop. The `mission.configJson` should store the `cloneUrl` so the runner can reference it.

#### `packages/frontend/src/frame/TopBar.tsx`

- Add GitHub icon/status indicator on the right side (next to theme switcher)
- Shows avatar if connected, gray icon if not

### Shared Types

Add to `packages/shared/src/types.ts`:

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

## Security

1. **CSRF protection**: `state` nonce generated and stored server-side, validated on callback. Nonce passes through browser URL (standard OAuth) but is never handled by frontend JS.
2. **Token never in frontend**: all GitHub API calls proxied through backend
3. **Client secret server-only**: `GITHUB_CLIENT_SECRET` never leaves backend process
4. **Token revocation on disconnect**: calls GitHub's token revocation endpoint before deleting
5. **Existing API key auth**: all `/api/github/*` endpoints (except `/callback`) respect the existing `API_KEY` config

### Known Limitations

- **GitHub OAuth App tokens don't expire** — unlike GitHub App tokens, OAuth App tokens have no expiration. If compromised, use disconnect → reconnect to rotate. Consider migrating to a GitHub App in the future for automatic token expiration.
- **Single-user — one GitHub token globally** — the token is stored as a global setting in LaPis, not per-user. This is intentional for now (Aurex is a single-user tool). If multi-user support is needed later, tokens would need to be scoped per user.
- **100-repo limit** — `GET /user/repos` returns max 100 per page. Users with 100+ repos will see only the 100 most recently updated. Pagination can be added later if needed.

## Dependencies

**No new npm dependencies.** Node 22 has native `fetch`. GitHub API returns JSON. Frontend uses existing `api.ts` pattern.

## Docker Compose Updates

Add to `docker-compose.yml` environment for backend service:
```yaml
GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}
GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
GITHUB_CALLBACK_URL: ${GITHUB_CALLBACK_URL:-http://localhost:8080/api/github/callback}
```

Add to `.env.example`:
```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:8080/api/github/callback
```

## Implementation Order

1. **LaPis settings routes** — add `GET/PUT/DELETE /settings/:key` to LaPis (`src/http/handlers/settings.js` + route registration in `src/http/server.js` + `settings` table in `schema.sql`)
2. Shared types (`GitHubRepo`, `GitHubStatus`)
3. Backend GitHub client (`github-client.ts`)
4. Backend LaPis client update — add `getSetting`, `setSetting`, `deleteSetting` methods
5. Backend routes (`github.ts`) + registration in `server.ts`
6. Frontend `useGitHub` hook
7. Frontend `RepoPicker` component
8. Frontend integration (NewMissionForm, TopBar, App)
9. Docker/env config updates
10. Backend mission route update — accept `cloneUrl`, clone repo into workspace
11. Tests (unit tests for github-client, route tests, LaPis settings handler)

## Files Summary

| File | Action |
|---|---|
| **LaPis** (`github.com/GeneGulanesJr/LaPis`) | |
| `src/http/handlers/settings.js` | New — GET/PUT/DELETE handler |
| `src/http/server.js` | Modify — register settings routes |
| `schema.sql` | Modify — add `settings` table |
| **Aurex shared** | |
| `packages/shared/src/types.ts` | Modify — add GitHubRepo, GitHubStatus |
| `packages/shared/src/index.ts` | Modify — re-export new types |
| **Aurex backend** | |
| `packages/backend/src/clients/github-client.ts` | New |
| `packages/backend/src/clients/lapis-client.ts` | Modify — add getSetting/setSetting/deleteSetting |
| `packages/backend/src/routes/github.ts` | New |
| `packages/backend/src/server.ts` | Modify — register GitHub routes |
| `packages/backend/src/config.ts` | Modify — add GitHub env vars |
| **Aurex frontend** | |
| `packages/frontend/src/hooks/useGitHub.ts` | New |
| `packages/frontend/src/active/GitHubStatus.tsx` | New |
| `packages/frontend/src/active/RepoPicker.tsx` | New |
| `packages/frontend/src/active/NewMissionForm.tsx` | Modify — add RepoPicker |
| `packages/backend/src/routes/missions.ts` | Modify — accept optional `cloneUrl` in POST body, trigger clone |
| `packages/frontend/src/active/MissionSidebar.tsx` | Modify — pass GitHub state |
| `packages/frontend/src/frame/TopBar.tsx` | Modify — add status indicator |
| `packages/frontend/src/App.tsx` | Modify — add useGitHub |
| `packages/frontend/src/api.ts` | Modify — add GitHub API calls |
| **Config** | |
| `docker-compose.yml` | Modify — add GitHub env vars |
| `.env.example` | Modify — add GitHub vars |
| `docs/superpowers/plans/PROGRESS.md` | Modify — add GitHub integration status |
