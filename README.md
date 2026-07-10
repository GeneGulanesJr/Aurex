# Aurex

**Scan your repo → isolated issues → copy-ready fix prompts.**

> _Last updated: 2026-07-10 · Scanner-first default: connect GitHub, scan a repo, copy LaPis-backed fix prompts per issue._

Aurex indexes your codebase with LaPis, runs supply-chain and heuristic analysis, and produces **one copy-ready fix prompt per isolated issue** — ready to paste into Cursor, Claude, or any coding workflow. No in-app agent execution required for the default scanner experience.

**Optional (legacy coding-agent UI):** Set `VITE_MISSIONS_ENABLED=true` when building the frontend to expose the AI mission orchestrator sidebar and pipeline. Set `AUREX_MISSIONS_ENABLED=true` on the backend for missions to actually run. The UI defaults to scanner-only mode.

---

## Reviewer flow (default)

1. **Connect GitHub** — OAuth via Integrations
2. **Pick a repo** — clone + LaPis index on prepare
3. **Scan** — summary, graph, hotspots, Bumblebee supply chain, readiness
4. **Review issues** — filtered list with tier, category, and metadata
5. **Copy fix prompt** — one bounded change per issue, LaPis context included

Export all prompts as Markdown, filter by tier/category/status, or inspect architecture (modules, cycles, entry points) in the dashboard.

---

## Mission orchestrator (optional)

**An AI-powered mission control for coding tasks** when `VITE_MISSIONS_ENABLED=true` at frontend build time and `AUREX_MISSIONS_ENABLED=true` on the backend.

---

## How It Works

![Architecture Overview](docs/architecture-overview.svg)

1. **You create a mission** — describe what you want done
2. **The AI plans** — the orchestrator breaks your goal into milestones and working units
3. **Workers build** — AI coding agents write code in isolated git branches
4. **Validators check** — separate agents review the work against acceptance criteria
5. **You approve** — Aurex escalates to you only when needed (scope changes, cost limits, test failures)
6. **Done** — merged code, audit trail, and cost report

On any escalation, see the [API at a Glance](#api-at-a-glance) for the exact surface you can act through.

---

## Mission Lifecycle

![Mission Lifecycle](docs/mission-lifecycle.svg)

Every mission follows a structured loop:

- **Plan → Build → Validate → Pass/Fail**
- On **pass**, move to the next milestone (or complete the mission)
- On **fail**, retry with the same worker (up to 2 times) or re-scope the milestone
- If retries are exhausted, **you decide** — approve the attempt, re-scope, or abort

---

## The Dashboard

Aurex comes with a real-time mission control dashboard — think air traffic control for AI agents.

| Area | What you see |
|---|---|
| **Topbar** | System status (connected services), uptime, active mission count, theme picker |
| **Sidebar** | List of missions, create new mission button, running costs |
| **Mission Pipeline** | Composed layout: left rail with mission status + milestones, right inspector with Activity / Code / Supply Chain tabs |
| **Integrations Panel** | PiNyx Connection / Keys / Models, GitHub OAuth, Settings, Quota, Mutation testing |
| **Telemetry Bar** | Live token count, cost, active agents, WebSocket status |
| **Escalation Overlay** | When Aurex needs you — context, attempt history, approve/reject/rescope |

Three color themes are built in: **Solar Flare** (amber), **Frost Command** (cyan), and **Signal Red** (crimson). Switch instantly without reloading.

---

## Key Ideas

| Concept | Plain English |
|---|---|
| **Mission** | Your high-level goal — "add login to the app" |
| **Milestone** | A chunk of the mission — "set up the auth middleware" |
| **Worker** | An AI agent that writes code in its own isolated git branch |
| **Validator** | An AI agent that reviews a worker's output against requirements |
| **Researcher** | An AI agent that explores the codebase to gather context (read-only) |
| **Checkpoint** | A pause where Aurex asks you for approval before continuing |
| **Negotiator** | The decision-maker that determines pass/fail/retry/escalate |
| **Integrations Panel** | In-app UI for PiNyx providers/keys, GitHub OAuth, settings, quota, mutation testing |
| **Supply-Chain Scan** | Bumblebee + native JS fallback audits a repo's dependencies for known issues |
| **Quota Gate** | Rate-limit per coding plan via `pinyx-quota-wrapper` so you don't burn through daily limits |

---

## Design Principles

- **Isolation by default** — every worker gets its own git worktree, so agents never step on each other
- **No agent-to-agent chatter** — agents communicate only through shared state, never directly
- **Gateway-fronted LLMs** — the Pi SDK runs inside agent sessions, but every model call is routed through PiNyx so providers, keys, and rate-limits live in one place
- **Human-in-the-loop when it matters** — you're not in the weeds, but you're not locked out either
- **Enforcement guardrails** — branch protection, handoff validation, contract immutability, quota gates, and full audit trails

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Fastify, TypeScript, Pi SDK (per-session), PiNyx gateway |
| **Frontend** | React, Vite, Tailwind CSS, anime.js |
| **Shared State** | LaPis (SQLite-backed HTTP API) |
| **LLM Gateway** | PiNyx (proxies all model calls) |
| **Observability** | OpenTelemetry Collector; Prometheus-compatible metrics endpoint |
| **Testing** | Vitest (700 tests across 71 files), Stryker (mutation testing) |
| **Tooling** | pnpm workspaces, TypeScript, @earendil-works/pi-coding-agent |

---

## Quick Start

### Docker (recommended)

One command runs the full stack:

```bash
docker compose build && docker compose up
```

To **force fresh LaPis and PiNyx** clones from GitHub (they are baked into the image at build time and often stay cached):

```bash
LAPIS_PULL=$(date +%F) PINYX_PULL=$(date +%F) docker compose build --no-cache lapis pinyx
docker compose up -d
```

> **Why two steps?** `docker compose build` rebuilds Aurex images from your local checkout. LaPis and PiNyx are cloned during the `lapis` / `pinyx` image build; without new `LAPIS_PULL` / `PINYX_PULL` args (or `--no-cache`), Docker may reuse cached clone layers. Run the commands above when you need the latest LaPis/PiNyx from `main`. For everyday Aurex code changes, `docker compose build && docker compose up` is enough.

| Service | URL |
|---|---|
| Dashboard | http://localhost:8080 |
| Backend API | http://localhost:3000 |
| Shared State (LaPis) | http://localhost:9100 |
| LLM Gateway (PiNyx) | http://localhost:7331 |
| App Metrics (OpenTelemetry Collector) | http://localhost:9464/metrics |
| Collector Self-Metrics | http://localhost:8888/metrics |

The bundled PiNyx is the real Rust gateway with no providers configured by default. Open the dashboard's **Integrations → Connection** tab to add a provider, or **Integrations → Keys** to enter an API key for one of the built-ins. To run the offline mock instead, use `docker compose -f docker-compose.e2e.yml up`.

OpenTelemetry Collector is bundled as a metrics bridge only: the backend exports OTLP metrics to the collector, and the collector exposes Prometheus-compatible scrape endpoints. Prometheus and Grafana are intentionally not bundled; point your external monitoring system at `http://<aurex-host>:9464/metrics` for Aurex app metrics and `http://<aurex-host>:8888/metrics` for collector self-metrics.

### Local Development

```bash
pnpm install
cp .env.example .env   # configure endpoints and model names
pnpm run build
pnpm --filter @aurex/backend run dev   # backend on :3000
pnpm --filter @aurex/frontend run dev  # frontend on :5173
pnpm --filter @aurex/frontend run preview  # production frontend preview
```

### Testing

```bash
pnpm test                         # full Vitest run (700 tests)
pnpm test:watch                   # Vitest in watch mode
pnpm test:e2e                     # end-to-end (uses docker-compose.e2e.yml)
pnpm test:mutation                # full Stryker mutation run
pnpm test:mutation:diff           # mutation run against working-tree diff only
npx vitest --reporter=verbose     # detailed per-test output
```

---

## API at a Glance

**REST**

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/missions` | Start a new mission |
| `GET` | `/api/missions/active` | List running + recently-completed missions |
| `GET` | `/api/missions/current` | Get the currently focused mission |
| `GET` | `/api/missions/:id` | Get mission details (mission, milestones, active workers, cost) |
| `GET` | `/api/missions/:id/agent-logs` | Stream of agent lifecycle log entries |
| `POST` | `/api/missions/:id/checkpoints` | Submit your decision on a checkpoint |
| `POST` | `/api/missions/:id/abort` | Abort a running mission |
| `DELETE` | `/api/missions/:id` | Remove a mission from sidebar/history (tombstone) |
| `POST` | `/api/missions/:id/restart` | Restart a completed/failed/aborted mission |

**WebSocket** — connect to `/ws` for real-time mission events (status changes, milestone transitions, cost updates, checkpoint escalations). Supports auth and replay.

Full reference covering all 45+ endpoints across missions, checkpoints, GitHub, repos, code-context, PiNyx, quota, mutation, and supply-chain — see [`docs/api.md`](./docs/api.md).

---

## Configuration

All config is via environment variables. Key ones:

| Variable | Default | What it controls |
|---|---|---|
| `LAPIS_ENDPOINT` | `http://localhost:9100` | Where the shared state DB lives |
| `REPO_ROOT` | `/workspace` | Path to the parent directory containing mission target repos |
| `AUREX_ROOT` | `=REPO_ROOT` | Path to the Aurex source tree (for orchestrator skills) |
| `GIT_MAIN_BRANCH` | `main` | Protected branch workers merge into |
| `PORT` | `3000` | Backend HTTP port |
| `API_KEY` | _(none)_ | Optional shared secret for backend auth |
| `MAX_CONCURRENT_MISSIONS` | `3` | How many missions run at once |
| `MISSION_COST_CAP` | `$50.00` | Max spend per mission before pausing |
| `MAX_VALIDATOR_RETRIES` | `2` | How many times a failed milestone can retry |
| `MAX_RESCOPES_PER_MILESTONE` | `5` | How many rescopes a single milestone may undergo |
| `VALIDATOR_TOOL_CALL_CAP` | `0` | Optional per-validator tool-call cap; `0` means unlimited |
| `AFFECTED_CODE_TOKEN_BUDGET` | `1200` | Soft token budget for the affected-code scaffold injected into worker context (graph nodes, key edges, complexity hotspots); `0` disables |
| `WORKER_TIMEOUT_SIMPLE` | `180000` ms | Timeout for simple workers |
| `WORKER_TIMEOUT_BUILD` | `300000` ms | Timeout for build workers |
| `WORKER_TIMEOUT_TEST_HEAVY` | `600000` ms | Timeout for test-heavy workers |
| `VALIDATOR_TIMEOUT` | `180000` ms | Timeout for validators |
| `RESEARCH_TIMEOUT` | `120000` ms | Timeout for research agents |
| `GITHUB_CLIENT_ID` | `Iv23lijYF4sZMcU62MjT` | GitHub App OAuth client id |
| `GITHUB_CLIENT_SECRET` | _(none)_ | GitHub App OAuth client secret |
| `GITHUB_CALLBACK_URL` | `http://localhost:3000/api/github/callback` | OAuth callback URL |
| `GITHUB_FRONTEND_URL` | `http://localhost:8080` | Frontend base for OAuth return |
| `QUOTA_ENABLED` | `false` | Enable the coding-plan quota gate |
| `QUOTA_WINDOW_HOURS` | `5` | Quota measurement window in hours |
| `QUOTA_BURN_HOURS` | `1` | Quota budget window in hours |
| `OTEL_SERVICE_NAME` | `aurex-backend` | Service name attached to backend metrics |
| `OTEL_METRICS_EXPORTER` | `otlp` | Set to `none` to disable backend metric export |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://localhost:4318/v1/metrics` | OTLP HTTP metrics endpoint for local backend runs |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` ms | Backend metric export interval |

Full list in [`.env.example`](./.env.example). Per-variable narrative with code references — see [`docs/configuration.md`](./docs/configuration.md).

### Built-in PiNyx providers

PiNyx (the LLM gateway) is configured via **Integrations → Keys** in the dashboard. Three providers are built-in:

| Provider | Base URL | Protocol | Configure via |
|---|---|---|---|
| **Kilo Code** | `https://api.kilo.ai/v1` | OpenAI-compatible | Integrations → Keys (default for first-run; free tier available with `/free` suffix) |
| **Z.AI Coding** | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible | Integrations → Keys (Anthropic-aliased coding models) |
| **MiniMax** | `https://api.minimax.io/v1` | OpenAI-compatible | Integrations → Keys; model `MiniMax-M3`, enter your Subscription Key |

Custom providers are also supported — add any base URL in the Integrations panel and the gateway will use the OpenAI-compatible adapter.

---

## Monorepo Layout

```
.
├── packages/
│   ├── shared/          # Types, enums, events, REST contracts (@aurex/shared)
│   ├── backend/         # Fastify server, orchestrator, agents, scanners (@aurex/backend)
│   │   ├── agents/      # Factory + tool defs (worker, validator, researcher, agent-logger)
│   │   ├── clients/     # LaPis, PiNyx, GitHub, Bumblebee, native scanner, quota wrapper
│   │   ├── enforcement/ # Branch guards, handoff validation, lifecycle, contract immutability, quota gate/mutex
│   │   ├── orchestrator/# Mission loop, planner, negotiator, mission runner pool, integration lifecycle
│   │   ├── routes/      # REST endpoints (missions, checkpoints, github, pinyx, bumblebee, ...)
│   │   ├── scanner/     # Mutation scanner (Stryker-backed)
│   │   ├── skills/      # Markdown skill files driving agent behavior
│   │   ├── ws/          # WebSocket event bus (auth + replay)
│   │   ├── config.ts
│   │   ├── server.ts
│   │   └── Dockerfile
│   └── frontend/        # React mission control dashboard (@aurex/frontend)
│       ├── frame/       # TopBar, TelemetryBar, ThemePicker
│       ├── hooks/       # 13 typed hooks (mission, ws, theme, github, pinyx, quota, ...)
│       ├── lib/         # Shared client utilities + sessionState
│       ├── passive/     # MissionPipeline, InspectorPanel, RepoOverview, CodeContext, SupplyChain
│       ├── active/      # Escalation overlay, Integrations panel, Mutation panel, Quota panel
│       ├── animations/  # anime.js modules (counters, state-transitions, agent-animations, stagger)
│       ├── App.tsx, main.tsx, api.ts, styles.css
│       └── Dockerfile
├── docs/                # Architecture diagrams + doc set (see docs/INDEX.md)
├── scripts/             # E2E + smoke-test entry points
├── aurex-pr71/          # Historical PR artifact (kept for reference)
├── docker-compose.yml
├── docker-compose.e2e.yml
├── DESIGN.md
├── README.md
├── stryker.config.mjs
└── package.json
```

---

## Design System

Aurex has its own design system — dark-mode-native, mission-control-inspired, with three switchable themes. See [DESIGN.md](./DESIGN.md) for the full token spec, component guidelines, and animation rules.

---

## Further Reading

- [`docs/INDEX.md`](./docs/INDEX.md) — pointer to the full doc set, including all implementation plans and design specs
- [`docs/api.md`](./docs/api.md) — complete REST + WebSocket reference
- [`docs/configuration.md`](./docs/configuration.md) — every env var, what it does, and where it's used
- [`docs/superpowers/plans/PROGRESS.md`](./docs/superpowers/plans/PROGRESS.md) — what's done, what's in flight, and what's left
