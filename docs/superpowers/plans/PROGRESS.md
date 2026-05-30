# Aurex — Progress Tracker

_Last updated: 2026-05-30 | HEAD: `89b1aa5` | 251 tests across 48 files_

## Subsystem Status

| Subsystem | Status | PR | Tests | Notes |
|---|---|---|---|---|
| **Shared types & enums** | ✅ Complete | — | Covered | `@aurex/shared` — types, enums, events, REST types |
| **Backend module structure** | ✅ Complete | — | — | 32+ source files |
| **Frontend component structure** | ✅ Complete | — | — | 23 files, React + Vite |
| **Agent spawner + factory** | ✅ Complete | #3 | — | Pi SDK `createAgentSession()`, per-type tools |
| **Worker spawning + worktrees** | ✅ Complete | #3 | — | Git worktree isolation, branch guards, handoffs |
| **Milestone loop (core)** | ✅ Complete | #3, #9 | — | Planning → execution → completion lifecycle |
| **Concurrent worker batching** | ✅ Complete | #9 | — | Non-overlapping batch grouping via `checkPreSpawnOverlap` |
| **Validator spawning** | ✅ Complete | #9 | — | Paired scrutiny + user-testing validators |
| **Negotiator (retry/rescope)** | ✅ Complete | #9 | — | Pass/retry/rescope/escalate decisions |
| **Research agent tools** | ✅ Complete | #9 | — | `write_finding`, `search_memory` |
| **State compression** | ✅ Complete | #9 | — | Post-milestone + budget-threshold triggers |
| **Cost tracking** | ✅ Complete | #9 | — | Pi SDK usage events → LaPis |
| **Branch guard hooks** | ✅ Complete | #9 | — | Pre-commit hook in worktrees |
| **Enforcement module wiring** | ✅ Complete | #25 | — | All 6 enforcement modules wired into milestone loop |
| **REST API** | ✅ Complete | — | ✅ | Missions, checkpoints, health |
| **WebSocket event bus** | ✅ Complete | — | ✅ | Real-time events with replay |
| **Overlap detection** | ✅ Complete | — | 11 tests | Pre-spawn + post-commit overlap checks, `excludeIds` defense |
| **Validation contracts** | ✅ Complete | — | ✅ | Append-only with versioning, supersede via rescope |
| **Startup recovery** | ✅ Complete | — | — | Auto-resume paused missions |

## Remaining Gaps (from spec, functional not structural)

| # | Gap | Priority | Status |
|---|---|---|---|
| 1 | Post-commit overlap detection at merge time (git diff scope check) | Medium | 🔲 Not started |
| 2 | Research agent pre-spawning during planning phase (spec §3c) | Medium | 🔲 Not started |
| 3 | Broadcasts API surface in milestone loop | Low | 🔲 Not started |
| 4 | Cost cap enforcement (pause/escalate when exceeded) | High | 🔲 Not started |
| 5 | `milestone_complete` checkpoint for human approval before merge → main | High | 🔲 Not started |
| 6 | Frontend animation wiring (anime.js → components) | Low | 🔲 Not started |
| 7 | Docker deployment (Dockerfile + docker-compose.yml) | Medium | 🔲 Not started |
| 8 | `supersedeContract` path in rescope handler | Medium | 🔲 Not started |

## Bug Fixes

| Bug | Status | Commit |
|---|---|---|
| `checkPreSpawnOverlap` self-overlap when unit status is spawned/working | ✅ Fixed | Pending commit |
| pendingUnits filter included working/spawned units (self-overlap root cause) | ✅ Fixed | Pending commit |
| `checkPreSpawnOverlap` and `detectOverlap` now accept `excludeIds` for defense in depth | ✅ Fixed | Pending commit |

## Test History

| Date | Tests | Files | Notable |
|---|---|---|---|
| 2026-05-27 | 113 | 36 | PR #3 merge — worker spawning |
| 2026-05-28 | 168 | 41 | PR #9 merge — all major gaps closed |
| 2026-05-28 | 246 | 47 | PR #25 merge — enforcement wiring |
| 2026-05-30 | 251 | 48 | Overlap bug fix + new tests |

## Key Decisions

- **LaPis is the shared state DB** — all data access through LaPis HTTP client, never direct SQLite
- **PiNyx is the sole LLM gateway** — all model calls through `localhost:7331`
- **Logic in skill files, boundaries in runtime** — agent behavior in markdown skills, enforcement in TypeScript
- **Workers are ephemeral** — isolated Pi SDK sessions with restricted tool sets, own git worktree
- **Validation contracts are immutable** — append-only with versioning, supersede requires rescope event
- **Overlap check excludes by ID** — defense in depth against self-overlap on re-processing
