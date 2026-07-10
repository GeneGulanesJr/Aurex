# Changelog

## 2026-07-10

- **Scanner mode:** Frontend defaults to scanner-only UI — mission sidebar, pipeline, telemetry, and coding-agent shortcuts are hidden unless both `AUREX_MISSIONS_ENABLED=true` and `VITE_MISSIONS_ENABLED=true`. Top bar shows `MODE SCANNER`; checklist copy updated for Bumblebee audit.
- **Bumblebee in repo review:** `POST /api/repos/:name/review` accepts `{ forceRescan: true }` to bypass the 24h scan cache; re-scan and first-time prepare (`freshIndex`) use it. Review pipeline loads the exposure catalog via shared `bumblebee-catalog` helper (parity with mission runner).
- **Mission hooks:** `useMissions({ enabled })` skips loading/persisting missions when scanner mode is active.
- **Delete mission:** `DELETE /api/missions/:id` tombstones missions in LaPis settings (LaPis has no hard delete), aborts active runs first, filters deleted missions from `GET /api/missions/active`, and emits `mission_deleted` over WebSocket. Frontend sidebar shows a Delete button when missions UI is enabled.
- **Docs:** README, `.env.example`, and `docs/configuration.md` document the dual env-var requirement for mission UI (`AUREX_MISSIONS_ENABLED` + `VITE_MISSIONS_ENABLED`).

## 2026-07-09

- **Review (Phase 1a):** Implemented scan → isolated issues → copy-ready fix prompts. Backend: `issue-isolator`, `fix-prompt-builder`, `review-generator`, `review-store`, `POST/GET /api/repos/:name/review`, repo graph endpoint. Frontend: `RepoScanDashboard` with issue list, fix prompt panel, copy/export. LaPis-heavy context via `affected-code` scaffold in each prompt.
- **Review fixes:** Rehydrate cached review on refresh (GET before POST); scan works with GitHub only (no PiNyx required); reduce false-positive dead-code (inbound edges, cap 5, skip scoped files); optimistic dismiss/copy UI; immutable review store updates.
- **Review follow-ups:** Re-added repo-level heuristics (test coverage, per-entry-point documentation capped at 5, import density, naming, style); category-specific proposed-fix steps; server-side Export all via `GET /review/:id/export` + `exportRepoReview()`; `RepoScanDashboard` unit tests.
- **Review hardening:** Fresh prepare always runs a new review scan; unique package issue IDs when `catalogId` is empty; lockfile findings scoped to manifest paths; entry points resolved to qualified file paths; PATCH failure rolls back optimistic issue status; export feedback/error UX fixes.
- **Review polish:** Cycle scope uses crossing import edges (not whole modules); ambiguous entry points rank by importance; readiness/style/performance issues scoped to avoid full-graph prompts; scan timestamp in dashboard; stale error responses respect version guard.
- **Review edge cases:** Package issue IDs always include finding.id; test-coverage scope falls back to hotspots; performance issue skipped when graph has no fan-out; issue-status PATCH guarded by review/repo identity; re-scan blocked while loading.
- **Review URL safety:** Sanitize path/package segments in issue IDs (fixes dismiss/copy PATCH 404s); encode issueId in client PATCH; drop expired Bumblebee scan when refresh fails; entry-point scope ignores unresolved paths before hotspot fallback.
- **Review post-review fixes:** Preserve prior report on failed re-scan; retry Bumblebee after failed cached scan; sanitize finding.id in package IDs; skip documentation issues for unresolved entry points.
- **Review v1 polish:** `AUREX_MISSIONS_ENABLED` (default off) gates mission UI; dashboard filters (tier/category/status/search), recommended pins, architecture tab, supply-chain summary, scan progress steps, acknowledge action; complexity issues capped at 10; readiness warnings become issues; review-store and route error tests; README + API docs for review endpoints.
- **Review cleanup:** Removed legacy `RepoOverviewPanel`, bundled `GET /suggestions` API, and `generateSuggestions()` — superseded by review pipeline (`issue-isolator` + `RepoScanDashboard`).
- **CI:** Review route/generator tests use `process.cwd()` for repo path instead of hardcoded `/workspace` (fixes GitHub Actions).
- **Product:** Refocused reviewer-first plan on scan → isolated issues → copy-ready fix prompts (LaPis-heavy). Removed fix-with-agent from v1 scope.
- **Docs:** New files `docs/superpowers/specs/2026-07-09-reviewer-first-pivot-design.md` and `docs/superpowers/plans/2026-07-09-reviewer-first-pivot.md`; indexed in `docs/INDEX.md`.
- **Orchestrator:** Mission runner resumes existing milestones instead of re-planning on restart/recovery; user restarts reset milestone/unit execution without duplicating plan artifacts; checkpoint waits honor abort signals (abort wins over in-flight poll); rescope only runs on failure/recovery triggers (not `milestone_complete`); validator fail verdicts downgrade previously passed todos; contract history loads latest version; empty rescope plans rejected; feature diff and research findings failures surfaced via `onError`; feature diff failure checkpoints instead of running validators blind; checkpoint-loop rescope/recovery fetches emit `mission_error` instead of silent fallbacks.
- **Frontend:** Orchestration warning banner for recoverable research/diff/checkpoint fetch errors; human-readable mission error labels in activity feed; supply-chain scan failures clear scanning state; agent log rehydration keys by worker unit id; prepared repo `cloneUrl` persisted across refresh; WebSocket shows connection-failed state after max retries; mission list load errors surfaced in sidebar; restart/abort API failures reported; mutation poll errors mark run failed; `getHealth` checks HTTP status.
- **Agents:** `write_handoff` validates `commandsRun` element shape (`command` + `exitCode`); agent error events no longer fall through to tool processing.
- **Pool:** Queued mission abort emits `mission_completed`; `drain()` resolves pending waiters.

## 2026-06-15

- **Docs:** README Quick Start documents `LAPIS_PULL` / `PINYX_PULL` rebuild commands for fresh LaPis/PiNyx Docker images.
- **Continual learning:** Created `AGENTS.md` with learned user preferences and workspace facts; initialized incremental transcript index at `.cursor/hooks/state/continual-learning-index.json`.
- **Orchestrator:** Decomposed the agentic milestone loop into phase modules (`milestone-unit-context`, `milestone-handoff-gate`, `milestone-validation-phase`, `milestone-integration-phase`, `milestone-validator-verdicts`, `milestone-retry-budget`, `branch-merge-service`). `milestone-loop.ts` is now a coordinator; worker/handoff/validator retry budgets are tracked separately.
- **LaPis:** Added `updateWorkingUnit` to persist `taskBranch`, `worktreePath`, and `sessionId` across refetches; runtime overlay cache remains as fallback.
- **Frontend:** Centralized mission status UI in `missionUiModel.ts` (`getMissionStatusUi`, `isMissionActive`, `countActiveMissions`, `countTerminalMissions`). `MissionSidebar` is presentational; abort/restart API calls live in `App.tsx`. Aborted missions hydrate in sidebar history.
- **Tests:** Added milestone-loop contract harness, unit/retry/merge helper tests, `updateWorkingUnit` client test, and frontend status mapping coverage.
- **Review fixes:** Stale-unit refresh preserves runtime fields; worker/validation stale resets are independent; integration rejects `-X ours` merges that would drop worker changes; validator retry counter increments only on retry decisions; mission restart re-hydrates from API.
- **Orchestrator:** Overlapping worker batches chain from the prior worker's task branch; multi-worker validator dry-merge conflicts trigger one full-batch sequential retry before checkpointing; worker prompt/skill stress mandatory `write_handoff`.
- **PR #108 review fixes:** Docker `LAPIS_PULL`/`PINYX_PULL` now bust clone cache; `recreateBranch` checks out base before delete; runner/pool use `aborted` terminal state; LaPis unit-fetch and retry-counter failures escalate instead of silently continuing; `/api/missions/current` excludes aborted pool entries; `PoolMissionStatus` includes `aborted`.

## 2026-06-15 (earlier)

- **Orchestrator:** Block milestone completion when worker branches cannot merge cleanly. Integration now throws on any merge conflict (no partial release branches), validator dry-merge conflicts checkpoint as `validation_failed` before negotiator pass, and integration/release branches are recreated idempotently on retry via `recreateBranch`.
- **Docker:** Replaced GitHub API `ADD` cache-bust (504-prone) with `LAPIS_PULL` / `PINYX_PULL` build args for reliable LaPis/PiNyx re-clones.
- **UI:** Added a visible **Stop Mission** button on the active mission header and sidebar list. Abort works for `running`, `paused`, and pool states; stopped missions show as **Aborted** instead of disappearing from the list.
- **Backend:** `POST /api/missions/:id/abort` now updates LaPis to `aborted`, emits WebSocket status events, and treats user aborts as `aborted` instead of `failed`.
- **Frontend:** Restored `latestNotifEvent` state in `App.tsx` (accidentally dropped when adding abort UI), fixing Docker frontend build.
