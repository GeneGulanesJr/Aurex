# Aurex Configuration Reference

> _Last updated: 2026-06-17_

The source of truth is [`.env.example`](../.env.example). This document explains every variable, its effect, the code location that reads it, and a worked example for the built-in providers.

## How to set variables

**Local development:** copy `.env.example` to `.env` and edit.

**Docker:** pass via shell env (`GITHUB_CLIENT_SECRET=... docker compose up`) or a `.env` file at the repo root — `docker-compose.yml` interpolates `${VAR:-default}` values automatically.

**Validation:** the backend validates required variables on boot in [`packages/backend/src/config.ts:62`](../packages/backend/src/config.ts) (`loadConfig()` throws if a required var is missing).

---

## Server

| Variable | Type | Required | Default | Effect | Source |
|---|---|---|---|---|---|
| `PORT` | int | no | `3000` | HTTP port the Fastify backend binds to. WebSocket `/ws` shares this port. | [`config.ts:89`](../packages/backend/src/config.ts) |
| `API_KEY` | string | no | _(none)_ | If set, every REST request must include this value in an `Authorization: Bearer <key>` header. Leave empty to disable. WebSocket auth is described in [`docs/api.md`](./api.md#websocket-ws). | [`config.ts:90`](../packages/backend/src/config.ts) |
| `AUREX_ROOT` | path | no | `=REPO_ROOT` | Where the Aurex source tree lives — used to locate the orchestrator's own skill files (`packages/backend/src/skills/*.md`). Inside Docker, this is `/aurex` because the source is bind-mounted there. | [`config.ts:86`](../packages/backend/src/config.ts) |
| `AUTH_DISABLED` | bool | no | `false` | When `true`, the backend skips Auth0 JWT verification entirely (local dev without an Auth0 tenant). Production must leave this `false`. | [`config.ts`](../packages/backend/src/config.ts) |
| `PI_AGENT_DIR` | path | no | `$HOME/.pi/agent` | Directory of the Pi agent runtime used by the agent spawner. | [`server.ts`](../packages/backend/src/server.ts) |

## Repos & branches

| Variable | Type | Required | Default | Effect | Source |
|---|---|---|---|---|---|
| `REPO_ROOT` | path | **yes** | — | Parent directory under which cloned mission target repos live. Workers and scanners expect target repos under `${REPO_ROOT}/repos/<name>`. | [`config.ts:85`](../packages/backend/src/config.ts) |
| `GIT_MAIN_BRANCH` | string | no | `main` | Protected branch workers merge into. Branch guards refuse to commit to this branch from a worker worktree. | [`config.ts:87`](../packages/backend/src/config.ts) |

## Mission limits

| Variable | Type | Default | Effect | Source |
|---|---|---|---|---|
| `MAX_CONCURRENT_MISSIONS` | int | `3` | Max missions the runner pool will run in parallel. Excess missions queue. | [`config.ts:91`](../packages/backend/src/config.ts) |
| `MISSION_COST_CAP` | float | `50.0` | USD cap per mission. The milestone loop pauses + escalates when exceeded. | [`config.ts:83`](../packages/backend/src/config.ts) |
| `MAX_VALIDATOR_RETRIES` | int | `2` | Max times the negotiator may retry a failed milestone with a new worker. After this, the milestone escalates. | [`config.ts:81`](../packages/backend/src/config.ts) |
| `MAX_RESCOPES_PER_MILESTONE` | int | `2` | Max times a single milestone may be re-scoped. Note: `.env.example` ships `5`; the code default is `2`. | [`config.ts:82`](../packages/backend/src/config.ts) |
| `VALIDATOR_TOOL_CALL_CAP` | int | `0` | Optional per-validator tool-call cap. `0` disables the cap; validator timeout and mission cost cap still apply. | [`config.ts`](../packages/backend/src/config.ts) |
| `AFFECTED_CODE_TOKEN_BUDGET` | int | `1200` | Soft token budget for the compact affected-code scaffold (graph nodes, key import edges, complexity-ranked hotspots) injected into worker context so workers do not cold-start. The scaffold is a navigation map; full file bodies stay tool-fetched. `0` disables the scaffold. | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_MISSIONS_ENABLED` | bool | `false` | When `true`, the backend exposes mission orchestration APIs and reports `features.missionsEnabled` in `/health`. Does **not** show mission UI by itself. | [`config.ts`](../packages/backend/src/config.ts) |
| `VITE_MISSIONS_ENABLED` | bool | `false` | Frontend build flag. Set to `true` to show the mission sidebar, pipeline, and coding-agent UI. Requires `AUREX_MISSIONS_ENABLED=true` on the backend for missions to run. | [`useAppFeatures.ts`](../packages/frontend/src/hooks/useAppFeatures.ts) |

## Agent timeouts (milliseconds)

| Variable | Default | Effect | Source |
|---|---|---|---|
| `WORKER_TIMEOUT_SIMPLE` | `180000` (3 min) | Per-attempt timeout for "simple" workers (e.g. small text changes). Default was raised from 2 min to 3 min — most worker sessions need the extra time even on simple units, and the worker self-terminates via `write_handoff` long before the deadline. | [`config.ts:74`](../packages/backend/src/config.ts) |
| `WORKER_TIMEOUT_BUILD` | `300000` (5 min) | Per-attempt timeout for "build" workers (dependency installs, codegen). | [`config.ts:75`](../packages/backend/src/config.ts) |
| `WORKER_TIMEOUT_TEST_HEAVY` | `600000` (10 min) | Per-attempt timeout for "test-heavy" workers (running full test suites). | [`config.ts:76`](../packages/backend/src/config.ts) |
| `VALIDATOR_TIMEOUT` | `180000` (3 min) | Per-validator timeout. | [`config.ts:78`](../packages/backend/src/config.ts) |
| `RESEARCH_TIMEOUT` | `120000` (2 min) | Per-researcher-attempt timeout. | [`config.ts:79`](../packages/backend/src/config.ts) |

## LaPis endpoint

| Variable | Type | Required | Default | Effect | Source |
|---|---|---|---|---|---|
| `LAPIS_ENDPOINT` | URL | **yes** | — | Where the LaPis shared-state HTTP API lives. Inside Docker this is `http://lapis:9100`; locally it's `http://localhost:9100`. | [`config.ts:71`](../packages/backend/src/config.ts) |

## PiNyx endpoint

PiNyx (the LLM gateway) is **not configured via environment variables**. Provider URLs, API keys, and model selection live in the **Integrations → Connection / Keys / Models** tabs in the dashboard and are persisted into LaPis settings. The `/api/pinyx/*` endpoints in [`docs/api.md`](./api.md#pinyx) are how the Integrations panel reads and writes those settings. The bundled PiNyx is reachable inside Docker at `http://pinyx:7331` and locally at `http://localhost:7331`; you only need to know that URL when running the stack out of Docker.


## OpenTelemetry metrics

Aurex runs an OpenTelemetry Collector in Docker Compose as a metrics bridge only. The backend exports OTLP metrics to the collector, the collector exposes Aurex application metrics at `http://localhost:9464/metrics`, and collector self-metrics are exposed separately at `http://localhost:8888/metrics`. Backend HTTP metric labels use normalized Fastify route templates; unmatched requests are labeled `unmatched` to avoid high-cardinality URL labels. Prometheus and Grafana are intentionally not bundled so an external monitoring system can scrape those endpoints.

| Variable | Type | Default | Effect | Source |
|---|---|---|---|---|
| `OTEL_SERVICE_NAME` | string | `aurex-backend` | Service name attached to backend metric resource attributes. Docker Compose passes this to the backend container. | [`.env.example`](../.env.example), [`docker-compose.yml`](../docker-compose.yml) |
| `OTEL_METRICS_EXPORTER` | string | `otlp` in Docker / `.env.example`; unset disables export | Backend metrics exporter selector. Set to `none` to disable backend metric export without removing the collector. | [`packages/backend/src/telemetry.ts`](../packages/backend/src/telemetry.ts) |
| `OTEL_SDK_DISABLED` | bool | `false` | When `true`, disables backend OpenTelemetry metric export. | [`packages/backend/src/telemetry.ts`](../packages/backend/src/telemetry.ts) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | URL | `http://localhost:4318/v1/metrics` locally, `http://otel-collector:4318/v1/metrics` in Docker | OTLP HTTP endpoint used by the backend metric exporter. | [`.env.example`](../.env.example), [`docker-compose.yml`](../docker-compose.yml) |
| `OTEL_METRIC_EXPORT_INTERVAL` | int (ms) | `15000` | How often the backend pushes metric batches to the collector. | [`packages/backend/src/telemetry.ts`](../packages/backend/src/telemetry.ts) |
| `OTEL_METRIC_EXPORT_TIMEOUT` | int (ms) | `10000` | Metric export timeout. | [`packages/backend/src/telemetry.ts`](../packages/backend/src/telemetry.ts) |

## GitHub App OAuth

These are the **public** GitHub App client values for the bundled Aurex GitHub App. You only need to override them if you've registered your own GitHub App.

| Variable | Type | Default | Effect | Source |
|---|---|---|---|---|
| `GITHUB_CLIENT_ID` | string | `Iv23lijYF4sZMcU62MjT` (bundled Aurex App) | OAuth client id sent to `GET /api/github/connect`. | [`.env.example`](../.env.example) |
| `GITHUB_CLIENT_SECRET` | string | _(none)_ | **Required for OAuth to work.** Copy from the Aurex GitHub App's settings (or your own App if you registered one). The backend exchanges the temp code for an access token using this secret. | [`.env.example`](../.env.example) |
| `GITHUB_CALLBACK_URL` | URL | `http://localhost:3000/api/github/callback` | Where GitHub redirects after the user authorizes. Must match the callback URL registered on the GitHub App. | [`.env.example`](../.env.example) |
| `GITHUB_FRONTEND_URL` | URL | `http://localhost:8080` | Where the backend redirects the user *after* the callback exchanges the code. The dashboard reads `sessionStorage` to restore the UI state the user was on before kicking off OAuth. | [`.env.example`](../.env.example) |

## Quota

Per-coding-plan rate limits. The quota gate runs in front of `POST /api/missions` and refuses to start a mission if any tracked provider is out of budget.

| Variable | Type | Default | Effect | Source |
|---|---|---|---|---|
| `QUOTA_ENABLED` | bool | `false` | Master switch. When `true`, the backend reads `quota_config` and `quota_windows` from LaPis and gates `POST /api/missions` accordingly. | [`config.ts:93`](../packages/backend/src/config.ts) |
| `QUOTA_WINDOW_HOURS` | int (hours) | `5` | Length of the rolling quota window per provider. Converted to ms internally (`* 60 * 60 * 1000`). | [`config.ts:94`](../packages/backend/src/config.ts) |
| `QUOTA_BURN_HOURS` | int (hours) | `1` | Length of the budget-burn window the prefire check projects. Converted to ms internally. | [`config.ts:95`](../packages/backend/src/config.ts) |

## Durable execution control plane (experimental / reserved)

These flags gate the queue-backed agent-session subsystem. **All default off.** Even when enabled, no agent process is launched unless a real `launchAgent` is registered (see [`docs/AUDIT-dead-incomplete-code.md`](./AUDIT-dead-incomplete-code.md) §2.1), so the durable control plane is effectively inert in the default deployment.

> **Coupling requirement:** `AUREX_PREPARED_SESSIONS_ENABLED=true` **requires** `AUREX_DURABLE_QUEUE_ENABLED=true`. The prepared-session routes' `start()` enqueues an `agent_session_start` job; the queue worker started by `AUREX_DURABLE_QUEUE_ENABLED` is what drains it. Enabling prepared sessions without the durable queue would enqueue jobs that never run (silent ghost sessions), so the backend **refuses to boot** in that configuration rather than fail silently.

| Variable | Type | Default | Effect | Source |
|---|---|---|---|---|
| `AUREX_DURABLE_QUEUE_ENABLED` | bool | `false` | Mounts the execution-queue routes and starts the queue worker that drains `ExecutionQueueJob`s. | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_PREPARED_SESSIONS_ENABLED` | bool | `false` | Mounts the `/api/agent-sessions/*` routes for prepared agent sessions. **Requires** `AUREX_DURABLE_QUEUE_ENABLED=true`. | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_STALE_RECONCILER_ENABLED` | bool | `false` | Lets the manual `POST /api/execution-queue/reconcile` endpoint actively reclaim/fail stale work (otherwise dry-run only). Does **not** schedule a periodic timer — reconciliation is manual-only today. | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_STALE_RECONCILER_DRY_RUN` | bool | `true` | Default dry-run mode for the manual reconcile endpoint (set to `false` to allow active reconciliation). | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_QUEUE_WORKER_POLL_MS` | int (ms) | `1000` | How often the queue worker polls for claimable jobs. | [`config.ts`](../packages/backend/src/config.ts) |
| `AUREX_QUEUE_WORKER_ID` | string | `$HOSTNAME:$PID` | Identity stamped on job claims. | [`config.ts`](../packages/backend/src/config.ts) |

---

## Built-in PiNyx providers

PiNyx is configured in-app. The **Integrations → Keys** tab in the dashboard lets you enter an API key per provider; the **Integrations → Models** tab lets you pick a model. These three providers ship built-in:

| Provider | Base URL | Protocol | Notes |
|---|---|---|---|
| **Kilo Code** | `https://api.kilo.ai/v1` | OpenAI-compatible | Default for first-run. Free tier available by appending `/free` to the model id (e.g. `kilo/kilo-auto/free`). |
| **Z.AI Coding** | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible | Anthropic-aliased coding models. |
| **MiniMax** | `https://api.minimax.io/v1` | OpenAI-compatible | Default model: `MiniMax-M3`. Enter your Subscription Key in the Keys tab. |

**Custom OpenAI-compatible providers:** the Integrations panel accepts any base URL + key + model id. PiNyx uses the OpenAI-compatible adapter for all of them.

---

## Example: minimal local `.env`

```bash
# Required
LAPIS_ENDPOINT=http://localhost:9100
REPO_ROOT=/workspace

# Optional but recommended
AUREX_ROOT=/path/to/aurex
GIT_MAIN_BRANCH=main
PORT=3000
MAX_CONCURRENT_MISSIONS=3
MISSION_COST_CAP=50.00
MAX_VALIDATOR_RETRIES=2
MAX_RESCOPES_PER_MILESTONE=5
VALIDATOR_TOOL_CALL_CAP=0
AFFECTED_CODE_TOKEN_BUDGET=1200

# GitHub (only needed for the GitHub repo picker)
GITHUB_CLIENT_ID=Iv23lijYF4sZMcU62MjT
GITHUB_CLIENT_SECRET=replace-me
GITHUB_CALLBACK_URL=http://localhost:3000/api/github/callback
GITHUB_FRONTEND_URL=http://localhost:8080

# Optional auth
# API_KEY=some-shared-secret

# Optional quota gate
# QUOTA_ENABLED=true
# QUOTA_WINDOW_HOURS=5
# QUOTA_BURN_HOURS=1
```

PiNyx is intentionally **not** in this file — configure it through the dashboard's Integrations panel.
