# Aurex API Reference

> _Last updated: 2026-06-08 · All routes below are implemented in `packages/backend/src/routes/` and registered in `packages/backend/src/server.ts`._

- **Base URL (default):** `http://localhost:3000`
- **WebSocket URL:** `ws://localhost:3000/ws`
- **Auth:** If `API_KEY` is set in the backend environment, the API key must be sent as `Authorization: Bearer <key>` on REST requests and as a `auth` message on the WebSocket.
- **Content type:** `application/json` for request and response bodies.
- **Error envelope:** `{ "error": "<message>" }` for REST errors. Some endpoints add a typed discriminator (e.g. `{ "error": "quota_exhausted", "providerId": "...", "remainingMs": ..., "windowResetsAt": "..." }`).

For shared request/response shapes see [`packages/shared/src/rest.ts`](../packages/shared/src/rest.ts) and [`packages/shared/src/types.ts`](../packages/shared/src/types.ts). The WebSocket event envelope is defined in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts).

---

## Quick index

| Group                        | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Missions**                 | [`POST /api/missions`](#post-apimissions), [`GET /api/missions/active`](#get-apimissionsactive), [`GET /api/missions/current`](#get-apimissionscurrent), [`GET /api/missions/:id`](#get-apimissionsid), [`GET /api/missions/:id/agent-logs`](#get-apimissionsidagent-logs), [`POST /api/missions/:id/abort`](#post-apimissionsidabort), [`POST /api/missions/:id/restart`](#post-apimissionsidrestart)                                                                                                                                                                               |
| **Checkpoints**              | [`POST /api/missions/:id/checkpoints`](#post-apimissionsidcheckpoints)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **GitHub**                   | [`GET /api/github/config`](#get-apigithubconfig), [`POST /api/github/config`](#post-apigithubconfig), [`GET /api/github/connect`](#get-apigithubconnect), [`GET /api/github/callback`](#get-apigithubcallback), [`GET /api/github/status`](#get-apigithubstatus), [`POST /api/github/disconnect`](#post-apigithubdisconnect), [`GET /api/github/repos`](#get-apigithubrepos), [`POST /api/github/repos/prepare`](#post-apigithubreposprepare)                                                                                                                                        |
| **Code Context**             | [`GET /api/missions/:missionId/code/summary`](#get-apimissionsmissionidcodesummary), [`GET /api/missions/:missionId/code/graph`](#get-apimissionsmissionidcodegraph), [`GET /api/missions/:missionId/code/hotspots`](#get-apimissionsmissionidcodehotspots)                                                                                                                                                                                                                                                                                                                          |
| **PiNyx**                    | [`GET /api/pinyx/status`](#get-apipinyxstatus), [`GET /api/pinyx/config`](#get-apipinyxconfig), [`POST /api/pinyx/config`](#post-apipinyxconfig), [`GET /api/pinyx/models`](#get-apipinyxmodels)                                                                                                                                                                                                                                                                                                                                                                                     |
| **Quota**                    | [`GET /api/quota`](#get-apiquota), [`POST /api/quota/config`](#post-apiquotaconfig), [`POST /api/quota/prefire`](#post-apiquotaprefire), [`POST /api/quota/reset`](#post-apiquotareset), [`POST /api/quota/calculate-prefire`](#post-apiquotacalculate-prefire)                                                                                                                                                                                                                                                                                                                      |
| **Mutation testing**         | [`GET /api/repos/:repoName/mutation`](#get-apireposreponamemutation), [`POST /api/repos/:repoName/mutation/run`](#post-apireposreponamemutationrun), [`GET /api/repos/:repoName/mutation/:runId`](#get-apireposreponamemutationrunid)                                                                                                                                                                                                                                                                                                                                                |
| **Repo Explore**             | [`POST /api/repos/:repoName/explore`](#post-apireposreponameexplore), [`GET /api/repos/:repoName/summary`](#get-apireposreponamesummary), [`GET /api/repos/:repoName/hotspots`](#get-apireposreponamehotspots), [`GET /api/repos/:repoName/readiness`](#get-apireposreponamereadiness), [`POST /api/repos/:repoName/scans`](#post-apireposreponamescans), [`GET /api/repos/:repoName/scans`](#get-apireposreponamescans-1), [`GET /api/repos/:repoName/scans/:scanId`](#get-apireposreponamescansscanid), [`GET /api/repos/:repoName/suggestions`](#get-apireposreponamesuggestions) |
| **Bumblebee (supply chain)** | [`GET /api/bumblebee/status`](#get-apibumblebeestatus), [`GET /api/bumblebee/catalog`](#get-apibumblebeecatalog), [`POST /api/bumblebee/catalog`](#post-apibumblebeecatalog), [`POST /api/missions/:missionId/scans`](#post-apimissionsmissionidscans), [`GET /api/missions/:missionId/scans`](#get-apimissionsmissionidscans), [`GET /api/missions/:missionId/scans/:scanId`](#get-apimissionsmissionidscansscanid)                                                                                                                                                                 |
| **Durable Execution**        | [`POST /api/agent-sessions/prepare`](#post-apiagent-sessionsprepare), [`POST /api/agent-sessionssessionidstart`](#post-apiagent-sessionssessionidstart), [`GET /api/execution-queue`](#get-apiexecution-queue), [`POST /api/execution-queue/reconcile`](#post-apiexecution-queuereconcile)                                                                                                                                                                                                                                                                                           |
| **WebSocket**                | [`/ws`](#websocket-ws)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## Missions

### `POST /api/missions`

Start a new mission.

- **Body:** `{ "description": string, "cloneUrl"?: string }`
- **Quota preflight:** if `quota_config` is enabled in LaPis, this checks each tracked provider's current window and returns `429 quota_exhausted` if any are out of budget.
- **Side effect:** resolves the default model from PiNyx's `/v1/models` (or falls back to `kilo/kilo-auto/free`), creates the mission in LaPis, and submits it to the in-process mission runner pool.
- **Response (201):** `{ "missionId": string, "status": string }`
- **Source:** `packages/backend/src/routes/missions.ts:59`

### `GET /api/missions/active`

List running missions, optionally with recently completed/failed missions appended for sidebar persistence across page refreshes.

- **Query:** `?includeHistory=N` — number of recent terminal missions to append (0–50, default 10; `0` = pool only).
- **Response:** `{ "missions": PoolMissionStatus[] }` (pool entries, then completed/failed history from LaPis, newest first, deduped against the pool)
- **Source:** `packages/backend/src/routes/missions.ts:125`

### `GET /api/missions/current`

Get the currently focused mission. Picks the first in-flight mission in the pool, falling back to the first active entry.

- **Response:** the hydrated payload (see `GET /api/missions/:id`).
- **Errors:** `404` if no active mission or the focused mission can't be found in LaPis.
- **Source:** `packages/backend/src/routes/missions.ts:111`

### `GET /api/missions/:id`

Get a hydrated mission payload: mission, milestones, active (non-terminal) workers across milestones, and cost.

- **Response:** `{ "mission": Mission, "milestones": Milestone[], "activeWorkers": WorkingUnit[], "cost": { "totalCost": number, "totalTokens": number, "entries": number } }`
- **Errors:** `404` if not found.
- **Source:** `packages/backend/src/routes/missions.ts:193`

### `GET /api/missions/:id/agent-logs`

Stream of agent lifecycle log entries for a mission. Requires the backend to have been started with an `AgentLogger`.

- **Response:** `{ "logs": Array<{ sessionId, agentType, missionId, milestoneId, unitId, event, message, timestamp, data? }> }`
- **Errors:** `503` if the agent logger is not available; `404` if the mission is not found.
- **Source:** `packages/backend/src/routes/missions.ts:202`

### `POST /api/missions/:id/abort`

Abort a running mission.

- **Response:** `{ "aborted": true }`
- **Errors:** `404` if the mission is not in the runner pool.
- **Source:** `packages/backend/src/routes/missions.ts:160`

### `POST /api/missions/:id/restart`

Restart a completed, failed, or aborted mission. Resets status to `planning` and resubmits to the pool.

- **Response:** `{ "restarted": true, "missionId": string, "status": "planning" }`
- **Errors:** `409` if the mission is currently active in the pool, or if its LaPis status is not in `["failed", "aborted", "completed"]`. `404` if not found.
- **Source:** `packages/backend/src/routes/missions.ts:170`

---

## Checkpoints

### `POST /api/missions/:id/checkpoints`

Submit a human decision on an open checkpoint (e.g. approve the latest attempt, re-scope, or abort).

- **Body:** the checkpoint-decision shape from `@aurex/shared` (see [`packages/shared/src/types.ts`](../packages/shared/src/types.ts)).
- **Response:** the resolved checkpoint result.
- **Source:** `packages/backend/src/routes/checkpoints.ts:21`

---

## GitHub

The GitHub surface is registered in `packages/backend/src/routes/github.ts`. The OAuth flow is backend-proxied: tokens live in LaPis settings, never in the browser.

### `GET /api/github/config`

Return the public GitHub App config (client id, callback URL, frontend URL) — safe to expose to the frontend.

### `POST /api/github/config`

Persist GitHub config to LaPis settings (server-side only).

### `GET /api/github/connect`

Kick off the GitHub App OAuth flow. Redirects the browser to GitHub.

### `GET /api/github/callback`

OAuth callback. Exchanges the temporary code for an access token, stores it in LaPis, and redirects back to the dashboard (with UI state preserved via `sessionStorage` per `2026-06-07-oauth-state-preservation`).

### `GET /api/github/status`

Report the current GitHub connection status (connected/disconnected, scopes, login).

### `POST /api/github/disconnect`

Clear the stored GitHub credentials from LaPis.

### `GET /api/github/repos`

List the GitHub repos the current user has access to via the connected App.

### `POST /api/github/repos/prepare`

Clone and index a selected repo into the Docker workspace, returning a `repoName` that subsequent mission-create calls can use as `cloneUrl`. Implements the user-consent flow from `2026-05-31-github-repo-prepare-flow`.

---

## Code Context

Code-context endpoints power the **Code** tab of `MissionInspectorPanel` and the `CodeContextPanel` / `HotspotHeatmap` / `DependencyGraph` components.

### `GET /api/missions/:missionId/code/summary`

High-level code summary for the mission's target repo (file count, language breakdown, module outline).

### `GET /api/missions/:missionId/code/graph`

Module-level dependency graph data for visualization.

### `GET /api/missions/:missionId/code/hotspots`

File-level churn / complexity hotspots.

All three live in `packages/backend/src/routes/code-context.ts`.

---

## PiNyx

The gateway admin surface. Live in `packages/backend/src/routes/pinyx.ts`.

### `GET /api/pinyx/status`

Reachability + configured-provider count for the connected PiNyx instance.

### `GET /api/pinyx/config`

Get the saved PiNyx config (providers, model hints, fallback settings).

### `POST /api/pinyx/config`

Update PiNyx config. The Integrations panel's **Connection** / **Keys** / **Models** tabs all call this endpoint under the hood.

### `GET /api/pinyx/models`

Proxy to PiNyx's `GET /v1/models` for the currently configured provider(s). Powers the model picker in the Integrations panel and the default-model auto-detection in `POST /api/missions`.

---

## Quota

The coding-plan quota gate (per-provider burn vs. window). Live in `packages/backend/src/routes/quota.ts`.

### `GET /api/quota`

Current quota state per tracked provider — `quota_windows` from LaPis plus the `quota_config` definition.

### `POST /api/quota/config`

Update the quota configuration (which providers are tracked, thresholds, etc.). The Integrations panel's **Quota** tab calls this.

### `POST /api/quota/prefire`

Run a preflight check against a hypothetical upcoming mission and report whether the quota allows it.

### `POST /api/quota/reset`

Manually reset a provider's quota window.

### `POST /api/quota/calculate-prefire`

Recalculate the prefire estimate using the latest cost data (used by the Quota tab to show "with current burn rate you'd run out in X minutes").

---

## Mutation testing

Backed by Stryker (see `stryker.config.mjs` and `pnpm test:mutation`). The frontend `MutationPanel` reads these endpoints. Live in `packages/backend/src/routes/mutation-routes.ts`.

### `GET /api/repos/:repoName/mutation`

Latest mutation score for the repo (or 404 if no run yet).

### `POST /api/repos/:repoName/mutation/run`

Kick off a Stryker run against the repo. Returns immediately; the run is observable via `GET /api/repos/:repoName/mutation/run/:runId`.

### `GET /api/repos/:repoName/mutation/:runId`

Get the status / results of a specific mutation run. Implemented in `packages/backend/src/routes/mutation-routes.ts:120`.

---

## Repo Explore

Auto-explore + smart-suggestions endpoints, introduced in `2026-06-07-repo-auto-explore`. Live in `packages/backend/src/routes/repo-explore.ts`. All read endpoints are best-effort: if the repo isn't indexed yet, they return a 404 with `error: "not_indexed"`.

### `POST /api/repos/:repoName/explore`

Kick off an explore pass (clone-or-refresh, language detection, dependency crawl). Idempotent for already-indexed repos.

### `GET /api/repos/:repoName/summary`

Cached repo summary (file counts, languages, top-level modules).

### `GET /api/repos/:repoName/hotspots`

File-level churn / complexity hotspots for the repo.

### `GET /api/repos/:repoName/readiness`

A score and breakdown of how ready the repo is to be a mission target (has tests? CI? README? locked dependencies?).

### `POST /api/repos/:repoName/scans`

Run a deeper scan (e.g. Bumblebee, full dep audit). The `Bumblebee` route also exposes the same shape under `/api/missions/:missionId/scans`.

### `GET /api/repos/:repoName/scans`

List scan results for the repo.

### `GET /api/repos/:repoName/scans/:scanId`

Fetch a specific scan by id.

### `GET /api/repos/:repoName/suggestions`

Smart mission suggestions for the repo — "add tests for `src/foo`", "fix the top 3 lint errors", etc.

---

## Bumblebee (supply chain)

Bumblebee + the native JS fallback supply-chain scanner. Live in `packages/backend/src/routes/bumblebee.ts`.

### `GET /api/bumblebee/status`

Is the Bumblebee binary available? (Falls back to the native JS scanner if not.)

### `GET /api/bumblebee/catalog`

The current vulnerability catalog.

### `POST /api/bumblebee/catalog`

Replace the vulnerability catalog with the provided entries.

### `POST /api/missions/:missionId/scans`

Run a supply-chain scan against a mission's target repo.

- **Body:** `{ "profile"?: "baseline" | "project" | "deep", "ecosystems"?: string[] }`

### `GET /api/missions/:missionId/scans`

List past scans for a mission.

### `GET /api/missions/:missionId/scans/:scanId`

Fetch a specific scan by id.

## Durable Execution Control Plane

Prepared agent sessions and the execution queue are the first phase of durable mission execution. These debug/control routes are implemented in `packages/backend/src/routes/agent-sessions.ts` and `packages/backend/src/routes/execution-queue.ts`. They do not change the default `POST /api/missions` behavior until the durable mission dispatch feature flags are enabled.

Feature flags:

| Variable                          |            Default | Purpose                                                                                            |
| --------------------------------- | -----------------: | -------------------------------------------------------------------------------------------------- |
| `AUREX_DURABLE_QUEUE_ENABLED`     |            `false` | Reserved for switching mission dispatch from direct runner submission to queue-backed dispatch.    |
| `AUREX_PREPARED_SESSIONS_ENABLED` |            `false` | Reserved for requiring prepared-session launch boundaries in orchestrator flows.                   |
| `AUREX_STALE_RECONCILER_ENABLED`  |            `false` | Reserved for scheduled/automatic stale reconciliation.                                             |
| `AUREX_STALE_RECONCILER_DRY_RUN`  |             `true` | Keeps manual reconciliation non-mutating unless explicitly disabled in the request/default config. |
| `AUREX_QUEUE_WORKER_POLL_MS`      |             `1000` | Future queue worker poll interval.                                                                 |
| `AUREX_QUEUE_WORKER_ID`           | `<hostname>:<pid>` | Queue worker identity for claim metadata.                                                          |

### `POST /api/agent-sessions/prepare`

Prepare an agent session without launching it.

- **Body:** `{ "missionId": string, "milestoneId"?: string | null, "unitId"?: string | null, "role": PreparedAgentRole, "config": { "model": string, "prompt": string, ... }, "maxAttempts"?: number }`
- **Response (201):** `{ "sessionId": string, "status": "prepared", "session": PreparedAgentSession }`

### `POST /api/agent-sessions/:sessionId/start`

Queue a prepared session for launch by creating an `agent_session_start` execution job and linking it back to the session.

- **Response (202):** `{ "sessionId": string, "queueJobId": string, "status": "queued" }`

### `GET /api/agent-sessions/:sessionId`

Inspect a prepared session.

- **Response:** `{ "session": PreparedAgentSession }`

### `POST /api/agent-sessions/:sessionId/messages`

Accept follow-up input for sessions that are `running` or `waiting_for_input`.

- **Body:** `{ "message": string }`
- **Response:** `{ "accepted": boolean }`

### `POST /api/agent-sessions/:sessionId/cancel`

Cancel a prepared, queued, running, or waiting session.

- **Response:** `{ "session": PreparedAgentSession }`

### `GET /api/execution-queue`

Inspect durable execution queue jobs.

- **Query:** `?status=queued|claimed|running|succeeded|failed|cancelled|stale|requeued&missionId=...&sessionId=...`
- **Response:** `{ "jobs": ExecutionQueueJob[] }`

### `POST /api/execution-queue/reconcile`

Run stale-work reconciliation manually. Defaults to dry-run behavior unless the body sets `dryRun: false` and the server config allows active reconciliation.

- **Body:** `{ "dryRun"?: boolean }`
- **Response (202):** `{ "summary": ReconciliationRunSummary }`

---

## WebSocket (`/ws`)

Connect to `ws://localhost:3000/ws` for real-time mission events. Implemented in `packages/backend/src/ws/events.ts`. `/ws` is exempt from REST auth, but if `API_KEY` is set the socket requires a token handshake (see below).

### Handshake

1. Client connects. The server immediately starts a 5-second auth timer.
2. If `API_KEY` is set, the client must send `{ "type": "auth", "token": "<API_KEY>" }`. On success the server replies with `{ "type": "auth_ok" }` and clears the timer; on failure the server closes the socket with code `4003`.
3. After auth, the server sends a single `{ "type": "hello", "seq": <currentSeq> }` frame so the client knows where to resume from.
4. If the client never authenticates within 5 seconds, the server closes the socket with code `4001`.

### Subscription

By default a connected client receives every emitted event. To filter to a single mission, send:

```
{ "type": "subscribe_mission", "missionId": "..." }
```

The server replies with `{ "type": "subscribed", "missionId": "..." }` to confirm. There is no "unsubscribe" message — close the socket to stop receiving.

### Live event stream

Server sends events as:

```
{ "seq": <monotonic id>, "event": <MissionEvent> }
```

where `MissionEvent` is the discriminated union defined in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts) (status changes, milestone transitions, cost updates, agent lifecycle, checkpoint escalations, etc.).

### Replay

If a client knows the last `seq` it saw, it can send `{ "type": "replay", "lastSeq": <n> }` and the server will replay all events with `seq > n` in batches of 100, then send `{ "type": "replay_done", "count": <k> }`. Replayed events include `"replayed": true` alongside `seq` and `event`. The event buffer holds the most recent 10 000 events; `lastSeq` values older than that will be clamped to the buffer's oldest entry.
