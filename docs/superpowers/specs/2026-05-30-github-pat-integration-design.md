# GitHub PAT-based Integration Redesign

**Date:** 2026-05-30
**Status:** Approved

## Context

Aurex's GitHub integration uses a full OAuth flow (Client ID, Client Secret, Callback URL, nonce-based state management, redirect dance). This requires the user to manually type in OAuth app credentials and a callback URL in the IntegrationsPanel — too much friction for a single-user tool.

## Decision

Replace OAuth with a **GitHub Personal Access Token (PAT)** flow. Single token, single user, paste-and-connect.

## Flow

1. User opens IntegrationsPanel → GitHub section
2. Pastes PAT into a single password input
3. Clicks **"Connect"**
4. Backend validates token via `GET https://api.github.com/user`
5. If valid: stores token + user profile in LaPis settings, returns user info
6. If invalid: returns 401, frontend shows error
7. Once connected: shows avatar + username, repos load automatically
8. User picks repos via existing `RepoPicker` during mission creation
9. **"Disconnect"** clears stored token and user info

One token at a time. Pasting a new token replaces the old one.

## Backend Changes

### Routes

| Route | Method | Action |
|---|---|---|
| `/api/github/connect` | POST | Accepts `{ token }` in body. Validates by calling `getUser(token)`. Stores `{ access_token, created_at }` in LaPis setting `github_token` and user profile in `github_user`. Returns user profile. |
| `/api/github/disconnect` | POST | Clears `github_token` and `github_user` from LaPis settings. Returns `{ success: true }`. |
| `/api/github/status` | GET | Returns `{ connected: boolean, user: GitHubUserProfile | null }`. The `configured` field is removed — with PAT flow you're either connected or not. |
| `/api/github/repos` | GET | Lists repos using stored token via `listRepos()` from github-client. |

**Removed routes:** `GET /api/github/config`, `POST /api/github/config`, `GET /api/github/callback`

### `github-client.ts`

**Remove:** `exchangeCode()`, `revokeToken()`
**Keep:** `getUser(token)`, `listRepos(token)`, `headers()` helper

### `config.ts`

Remove fields: `githubClientId`, `githubClientSecret`, `githubCallbackUrl`
Remove env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`

### `server.ts`

Simplify `registerGitHubRoutes` deps — only needs `lapis` client (no more clientId/clientSecret/callbackUrl).

### `registerGitHubRoutes` signature

Before:
```ts
registerGitHubRoutes(app, { lapis, clientId, clientSecret, callbackUrl })
```

After:
```ts
registerGitHubRoutes(app, { lapis })
```

## Frontend Changes

### `api.ts`

**Remove:** `getGitHubConfig()`, `saveGitHubConfig()`, `getGitHubConnectUrl()`, `GitHubConfigResponse`, `SaveGitHubConfigRequest`

**Add:**
```ts
connectGitHub(token: string): Promise<GitHubStatusResponse>
```

**Keep:** `getGitHubStatus()`, `getGitHubRepos()`, `disconnectGitHub()`, `GitHubRepoResponse`

**Change:** `GitHubStatusResponse` drops `configured` field — becomes `{ connected: boolean, user: ... }` only.

### `useGitHub.ts`

**Remove from state:** `configured`, `config`
**Remove from return:** `saveConfig`
**Change:** `connect(token: string)` — now takes the PAT string, calls `connectGitHub(token)`, stores result
**Simplify:** No more config/status dual-fetch on mount. Just fetch status. Drop `configured` from state entirely.

### `IntegrationsPanel.tsx` — GitHub Section

Replace the Client ID / Client Secret / Callback URL form with:

- Single `<input type="password" placeholder="ghp_xxxxx..." />` 
- **"Connect"** button (disabled while empty or connecting)
- On connect success: shows avatar + username + "Disconnect" button
- On connect failure: shows error message

### `NewMissionForm.tsx`

Remove the `configured && !connected` conditional that showed "Connect GitHub" button. Just check `connected`.

### Files with no changes

- `TopBar.tsx` — already works correctly
- `RepoPicker.tsx` — already works correctly

## Validation

- Backend validates token before storing: calls `getUser(token)`, if it throws → 401
- Frontend placeholder text hints at `repo` scope requirement for private repos
- Token is never returned to frontend after storage (only user profile is)

## Testing

- Backend: update `github.test.ts` — remove config/callback tests, add PAT connect tests (valid token, invalid token, disconnect)
- Frontend: manual verification of IntegrationsPanel PAT input flow
