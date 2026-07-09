# Changelog

## 2026-07-09

- **Product:** Refocused reviewer-first plan on scan → isolated issues → copy-ready fix prompts (LaPis-heavy). Removed fix-with-agent from v1 scope.
- **Docs:** New files `docs/superpowers/specs/2026-07-09-reviewer-first-pivot-design.md` and `docs/superpowers/plans/2026-07-09-reviewer-first-pivot.md`; indexed in `docs/INDEX.md`.

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
