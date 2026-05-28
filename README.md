# Aurex

A multi-agent orchestration runtime that coordinates AI coding agents (workers, validators, researchers) through structured missions with milestones, checkpoints, and enforcement guardrails.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AUREX RUNTIME                            │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Orchestrator  │    │  PiNyx       │    │   LaPis      │      │
│  │ (persistent)  │    │  Gateway     │    │   (shared    │      │
│  │              │    │  :7331       │    │    state DB)  │      │
│  └──────┬───────┘    └──────▲───────┘    └──────▲───────┘      │
│         │                   │                   │              │
│         │ spawns            │ all LLM calls     │ all data     │
│         │                   │                   │ access       │
│         ▼                   │                   │              │
│  ┌──────────────┐  ┌───────┴──────┐  ┌─────────┴──────┐      │
│  │   Workers    │  │  Validators  │  │   Research     │      │
│  │  (ephemeral) │  │   (paired)   │  │  (read-only)   │      │
│  │              │  │              │  │                │      │
│  │ Pi SDK       │  │ Pi SDK       │  │ Pi SDK         │      │
│  │ + worktree   │  │ + restricted │  │ + read-only    │      │
│  │ + task/*     │  │              │  │                │      │
│  └──────────────┘  └──────────────┘  └────────────────┘      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Fastify Server                        │   │
│  │  REST API (missions, checkpoints)  │  WebSocket (events) │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                       │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐ │
│  │  Passive View   │  │  Active View (escalation modal)      │ │
│  │  • Agent grid   │  │  • Checkpoint context                │ │
│  │  • Milestone    │  │  • Approve / Reject / Re-scope       │ │
│  │  • Cost counter │  │  • Attempt history                   │ │
│  │  • Status feed  │  │                                      │ │
│  └─────────────────┘  └──────────────────────────────────────┘ │
│                                                                 │
│  Tailwind CSS + anime.js v4 (all animations)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Architectural Invariants

1. **LaPis is the shared state DB** — all data access through LaPis HTTP client, never direct SQLite
2. **No direct agent communication** — isolated Pi SDK sessions with restricted tool sets
3. **PiNyx is the sole LLM gateway** — all model calls route through `localhost:7331`
4. **Each worker gets its own git worktree** — filesystem isolation by default
5. **Logic in skill files, boundaries in runtime** — agent behavior defined in markdown skills, enforcement in TypeScript

## Key Concepts

- **Missions** → **Milestones** → **Working Units**: hierarchical task decomposition planned by the orchestrator via LLM
- **Workers**: ephemeral Pi SDK agents with isolated git worktrees that implement code changes
- **Validators**: paired agents that evaluate worker output against immutable validation contracts
- **Researchers**: read-only agents for codebase exploration and context gathering
- **Negotiator**: decides pass/retry/rescope/escalate based on validation verdicts
- **Checkpoints**: human-in-the-loop escalation for scope changes, cost caps, and test failures
- **Enforcement module**: branch guards, handoff validation, broadcast lifecycle, contract immutability, creator-verifier audit

## Monorepo Structure

```
packages/
├── shared/              # @aurex/shared — types, enums, REST/WS definitions
│   └── src/
│       ├── enums.ts     # MissionStatus, MilestoneStatus, AgentType, etc.
│       ├── types.ts     # Mission, Milestone, WorkingUnit, Handoff, etc.
│       ├── events.ts    # WsClientEvent discriminated union
│       ├── rest.ts      # REST request/response types
│       └── index.ts     # barrel export
│
├── backend/             # @aurex/backend — Fastify server + orchestrator
│   └── src/
│       ├── server.ts    # entry point, Fastify + WS setup
│       ├── config.ts    # env-driven configuration
│       ├── agents/      # agent spawner, factory, tool definitions
│       ├── clients/     # LaPis HTTP client, PiNyx LLM client
│       ├── enforcement/ # branch guard, handoff validator, lifecycle enforcers
│       ├── orchestrator/# mission runner, planner, negotiator, milestone loop
│       ├── routes/      # REST routes (missions, checkpoints, auth)
│       ├── skills/      # markdown skill files (orchestrator, worker, validator, research)
│       └── ws/          # WebSocket event bus
│
└── frontend/            # @aurex/frontend — React dashboard
    └── src/
        ├── App.tsx      # root component with WS + passive/active routing
        ├── passive/     # StatusBoard, AgentGrid, MilestoneBar, CostCounter, StatusFeed
        ├── active/      # EscalationOverlay, CheckpointPanel, AttemptHistory, DecisionActions
        ├── animations/  # anime.js modules (agent, state, counter, stagger)
        ├── hooks/       # useWebSocket, useMission, useMissions
        └── api.ts       # REST client
```

## Tech Stack

- **Runtime**: Node.js >= 20, pnpm >= 9
- **Language**: TypeScript 5.7
- **Backend**: Fastify 5, @fastify/websocket, Pi SDK
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, anime.js 4
- **Testing**: Vitest (193 tests across 41 files)
- **Validation**: @sinclair/typebox

## Prerequisites

Aurex requires two external services:

- **LaPis** — shared state database (SQLite-backed HTTP API). Set `LAPIS_ENDPOINT`.
- **PiNyx** — LLM gateway that proxies all model calls. Set `PINYX_ENDPOINT`.

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your LaPis/PiNyx endpoints, model names, and API key

# Build all packages
pnpm run build

# Type-check all packages
pnpm run typecheck

# Development (backend)
pnpm --filter @aurex/backend run dev

# Development (frontend)
pnpm --filter @aurex/frontend run dev

# Run tests
npx vitest

# Docker
docker compose up
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `LAPIS_ENDPOINT` | `http://localhost:9100` | LaPis shared state DB endpoint |
| `PINYX_ENDPOINT` | `http://localhost:7331` | PiNyx LLM gateway endpoint |
| `REPO_ROOT` | `/workspace` | Git repository root path |
| `GIT_MAIN_BRANCH` | `main` | Main branch for worktree operations |
| `PORT` | `3000` | Backend HTTP/WS port |
| `API_KEY` | _(empty)_ | Optional API key for auth |
| `MAX_CONCURRENT_MISSIONS` | `3` | Max parallel missions in pool |
| `MODEL_ORCHESTRATOR` | `reasoning-strong` | Model hint for planning/negotiation |
| `MODEL_WORKER` | `code-fast` | Model hint for worker agents |
| `MODEL_VALIDATOR_SCRUTINY` | `reasoning` | Model hint for scrutiny validators |
| `MODEL_VALIDATOR_USER_TESTING` | `computer-use` | Model hint for user-testing validators |
| `MODEL_RESEARCH` | `fast-cheap` | Model hint for research agents |
| `WORKER_TIMEOUT_SIMPLE` | `120000` | Timeout (ms) for simple worker tasks |
| `WORKER_TIMEOUT_BUILD` | `300000` | Timeout (ms) for build tasks |
| `WORKER_TIMEOUT_TEST_HEAVY` | `600000` | Timeout (ms) for test-heavy tasks |
| `VALIDATOR_TIMEOUT` | `180000` | Timeout (ms) for validator agents |
| `RESEARCH_TIMEOUT` | `120000` | Timeout (ms) for research agents |
| `MAX_VALIDATOR_RETRIES` | `2` | Max validator retries per milestone |
| `MAX_RESCOPES_PER_MILESTONE` | `5` | Max re-scope attempts per milestone |
| `MISSION_COST_CAP` | `50.00` | Cost cap (USD) per mission |

## API

### REST

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/missions` | Create a new mission |
| `GET` | `/api/missions/active` | List active missions |
| `GET` | `/api/missions/current` | Get current active mission |
| `GET` | `/api/missions/:id` | Get mission by ID |
| `POST` | `/api/missions/:id/checkpoints` | Submit checkpoint decision |
| `POST` | `/api/missions/:id/abort` | Abort a running mission |
| `GET` | `/health` | Health check (LaPis + PiNyx) |

### WebSocket

Connect to `/ws` for real-time mission events. Supports auth, replay (catch-up by sequence number), and streams all `WsClientEvent` types (status changes, milestone transitions, cost updates, checkpoint escalations).

## Testing

```bash
npx vitest              # run all tests
npx vitest --reporter=verbose   # verbose output
```

193 tests across 41 files covering shared types, backend logic (enforcement, orchestrator, routes), and frontend API client.
