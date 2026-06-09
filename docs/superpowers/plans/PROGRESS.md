# Aurex — Progress Tracker

_Last updated: 2026-06-08 | Mission control layout rework complete | 700 tests across 71 files, all passing_

## Subsystem Status

| Subsystem | Status | Plan | Tests | Notes |
|---|---|---|---|---|
| **Shared types & enums** | ✅ Complete | — | Covered | `@aurex/shared` — 5 files: enums, events, rest, types, index |
| **Backend module structure** | ✅ Complete | — | — | 50 source files across 8 source directories (`agents`, `clients`, `enforcement`, `orchestrator`, `routes`, `scanner`, `skills`, `ws`) + `config.ts` + `server.ts` |
| **Frontend component structure** | ✅ Complete | — | — | 69 source files across 6 directories |
| **Agent spawner + factory** | ✅ Complete | — | ✅ | Pi SDK `createAgentSession()`, per-type tools |
| **Worker spawning + worktrees** | ✅ Complete | — | ✅ | Git worktree isolation, branch guards, handoffs |
| **Milestone loop (core)** | ✅ Complete | — | ✅ | Planning → execution → completion lifecycle |
| **Concurrent worker batching** | ✅ Complete | — | ✅ | Non-overlapping batch grouping via `checkPreSpawnOverlap` |
| **Validator spawning** | ✅ Complete | — | ✅ | Paired scrutiny + user-testing validators |
| **Negotiator (retry/rescope)** | ✅ Complete | — | ✅ | Pass/retry/rescope/escalate decisions |
| **Research agent tools** | ✅ Complete | — | ✅ | `write_finding`, `search_memory` |
| **State compression** | ✅ Complete | — | ✅ | Post-milestone + budget-threshold triggers |
| **Cost tracking** | ✅ Complete | — | ✅ | Pi SDK usage events → LaPis |
| **Branch guard hooks** | ✅ Complete | — | ✅ | Pre-commit hook in worktrees |
| **Cost-cap enforcement** | ✅ Complete | — | ✅ | Per-mission cap wired into milestone loop |
| **Enforcement module wiring** | ✅ Complete | — | ✅ | All 9 enforcement modules wired into milestone loop |
| **REST API** | ✅ Complete | — | ✅ | Missions, checkpoints, health, 45+ endpoints |
| **WebSocket event bus** | ✅ Complete | — | ✅ | Real-time events with replay + auth |
| **Overlap detection** | ✅ Complete | — | ✅ | Pre-spawn + post-commit overlap checks, `excludeIds` defense |
| **Validation contracts** | ✅ Complete | — | ✅ | Append-only with versioning, supersede via rescope |
| **Startup recovery** | ✅ Complete | — | — | Auto-resume paused missions |
| **GitHub App OAuth** | ✅ Complete | `2026-05-30-github-app-integration` | ✅ | OAuth client + routes, repo picker, `cloneUrl` mission config |
| **GitHub repo prepare flow** | ✅ Complete | `2026-05-31-github-repo-prepare-flow` | ✅ | Clone → index → explore pipeline |
| **Code Context panel** | ✅ Complete | `2026-05-31-code-context-panel` | ✅ | Mission-scoped code summary / graph / hotspots API |
| **PiNyx integration redesign** | ✅ Complete | `2026-05-31-pinyx-integration-redesign` | ✅ | In-app provider / model / key configuration |
| **Bumblebee supply-chain scanning** | ✅ Complete | `2026-05-31-pinyx-integration-redesign` | ✅ | Native JS fallback + Bumblebee NDJSON runner |
| **Mutation testing (Stryker)** | ✅ Complete | `2026-05-31-pinyx-integration-redesign` | ✅ | `pnpm test:mutation` + `pnpm test:mutation:diff` |
| **Quota gate / coding-plan rate limits** | ✅ Complete | `2026-05-31-pinyx-integration-redesign` | ✅ | `quota-gate` + `quota-mutex` + dedicated tab |
| **Frontend UI audit fixes** | ✅ Complete | `2026-06-01-frontend-ui-audit-fixes` | ✅ | Cleanup pass on hooks and components |
| **MiniMax provider** | ✅ Complete | `2026-06-06-minimax-provider-support` | — | Third built-in PiNyx provider, model `MiniMax-M3` |
| **Mission control layout rework** | ✅ Complete | `2026-06-07-frontend-mission-control-layout` | ✅ | `MissionPipeline` + Inspector + activity feed |
| **OAuth state preservation** | ✅ Complete | `2026-06-07-oauth-state-preservation` | — | `sessionStorage` preserves UI state across GitHub OAuth round-trip |
| **Repo auto-explore + suggestions** | ✅ Complete | `2026-06-07-repo-auto-explore` | ✅ | Auto-clone, index, present rich repo overview + mission ideas |
| **Docker deployment** | ✅ Complete | — | — | Top-level + per-package Dockerfiles, full + E2E compose |
| **E2E test harness** | ✅ Complete | — | — | `docker-compose.e2e.yml` + `scripts/e2e-docker.sh` |

## Remaining Gaps (from spec, functional not structural)

_Refreshed 2026-06-08. Most of the items in the 2026-05-30 list have since landed — see the table above for the per-item status._

| # | Gap | Priority | Status |
|---|---|---|---|
| 1 | Post-commit overlap detection at merge time (git diff scope check) | Medium | 🔲 Not started |
| 2 | Research agent pre-spawning during planning phase (spec §3c) | Medium | 🔲 Not started |
| 3 | Broadcasts API surface in milestone loop | Low | 🔲 Not started |
| 4 | Per-repo mutation testing UX (auto-run on mission completion) | Low | 🔲 Not started |
| 5 | Bumblebee deep-scan profile in the production happy path | Low | 🔲 Not started |

## Test History

| Date | Tests | Files | Notable |
|---|---|---|---|
| 2026-05-27 | 113 | 36 | PR #3 merge — worker spawning |
| 2026-05-28 | 168 | 41 | PR #9 merge — all major gaps closed |
| 2026-05-28 | 246 | 47 | PR #25 merge — enforcement wiring |
| 2026-05-30 | 251 | 48 | Overlap bug fix + new tests |
| 2026-05-30 | 283 | 51 | GitHub client + frontend integration in progress |
| 2026-05-31 | ~330 | ~55 | GitHub App + repo-prepare + code-context + PiNyx redesign merged |
| 2026-06-01 | ~410 | ~60 | Frontend UI audit fixes + new hook tests |
| 2026-06-06 | ~430 | ~62 | MiniMax provider |
| 2026-06-07 | ~600 | ~67 | Mission control layout + repo auto-explore + OAuth state preservation |
| 2026-06-08 | **700** | **71** | Verified by `npx vitest run` — all passing |

## Key Decisions

- **LaPis is the shared state DB** — all data access through LaPis HTTP client, never direct SQLite
- **PiNyx is the sole LLM gateway** — all model calls through PiNyx; the Pi SDK runs *inside* per-agent sessions
- **PiNyx is configured in-app, not via env** — provider URLs and keys live in the Integrations panel, not in `.env`
- **Logic in skill files, boundaries in runtime** — agent behavior in markdown skills, enforcement in TypeScript
- **Workers are ephemeral** — isolated Pi SDK sessions with restricted tool sets, own git worktree
- **Validation contracts are immutable** — append-only with versioning, supersede requires rescope event
- **Overlap check excludes by ID** — defense in depth against self-overlap on re-processing
- **GitHub OAuth is backend-proxied** — token stored in LaPis settings and never exposed to frontend JS
- **Mission Pipeline is composed, not monolithic** — `MissionPipeline` + `MissionSummaryHeader` + `MissionActivityFeed` + `MissionInspectorPanel` with `missionUiModel.ts` pure helpers
- **OAuth state is preserved across the dashboard return trip** via `sessionStorage`
