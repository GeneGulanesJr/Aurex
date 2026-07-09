# Aurex — Documentation Index

> _Last updated: 2026-06-08_

A pointer to every document in the repo. Start with the top-level files, then dive into architecture, then into the design specs and implementation plans.

---

## Start here

| File | Purpose |
|---|---|
| [`README.md`](../README.md) | Project overview, how it works, dashboard tour, key ideas, quick start, tech stack, monorepo layout |
| [`DESIGN.md`](../DESIGN.md) | Mission Control design system — colors, typography, layout, components, motion guidelines |
| [`docs/api.md`](./api.md) | Complete REST + WebSocket reference for every backend endpoint |
| [`docs/configuration.md`](./configuration.md) | Every env var, what it does, where it's used, defaults |

## Progress

| File | Purpose |
|---|---|
| [`docs/superpowers/plans/PROGRESS.md`](./superpowers/plans/PROGRESS.md) | Subsystem status, test history, remaining gaps, key decisions |
| [`docs/superpowers/specs/2026-07-09-reviewer-first-pivot-design.md`](./superpowers/specs/2026-07-09-reviewer-first-pivot-design.md) | **Active product direction:** codebase reviewer first; coding agents deferred |
| [`docs/superpowers/plans/2026-07-09-reviewer-first-pivot.md`](./superpowers/plans/2026-07-09-reviewer-first-pivot.md) | Implementation plan for reviewer-first pivot (Phase 1a–3) |

## Architecture diagrams

| File | Purpose |
|---|---|
| [`docs/architecture-overview.svg`](./architecture-overview.svg) | High-level architecture (SVG) |
| [`docs/architecture-overview.png`](./architecture-overview.png) | High-level architecture (PNG render) |
| [`docs/mission-lifecycle.svg`](./mission-lifecycle.svg) | Mission lifecycle loop (SVG) |
| [`docs/mission-lifecycle.png`](./mission-lifecycle.png) | Mission lifecycle loop (PNG render) |

---

## Design specs

The "what" and "why" for each major subsystem. Read these to understand the architecture before the implementation plans.

| Spec | Summary |
|---|---|
| [`2026-05-26-aurex-restructuring-design.md`](./superpowers/specs/2026-05-26-aurex-restructuring-design.md) | Top-level Aurex system architecture: backend, frontend, LaPis, PiNyx, agents, worktrees |
| [`2026-05-27-orchestrator-runtime-design.md`](./superpowers/specs/2026-05-27-orchestrator-runtime-design.md) | Orchestrator runtime: mission loop, milestone loop, planner, negotiator, agent spawner |
| [`2026-05-28-wire-enforcement-design.md`](./superpowers/specs/2026-05-28-wire-enforcement-design.md) | Wire the enforcement modules (branch guard, handoff, contract immutability) into the milestone loop |
| [`2026-05-30-github-app-integration-design.md`](./superpowers/specs/2026-05-30-github-app-integration-design.md) | GitHub App OAuth: client, routes, repo picker, `cloneUrl` mission config |
| [`2026-05-30-github-integration-design.md`](./superpowers/specs/2026-05-30-github-integration-design.md) | General GitHub integration architecture (status, repos, callback) |
| [`2026-05-30-github-pat-integration-design.md`](./superpowers/specs/2026-05-30-github-pat-integration-design.md) | PAT-based fallback for GitHub access |
| [`2026-05-31-code-context-panel-design.md`](./superpowers/specs/2026-05-31-code-context-panel-design.md) | Code Context panel: mission-scoped code summary, graph, hotspots |
| [`2026-05-31-github-repo-prepare-flow.md`](./superpowers/specs/2026-05-31-github-repo-prepare-flow.md) | User-consent flow for cloning + indexing a selected GitHub repo before mission creation |
| [`2026-05-31-pinyx-integration-redesign.md`](./superpowers/specs/2026-05-31-pinyx-integration-redesign.md) | In-app PiNyx configuration (providers, keys, models), Bumblebee, mutation testing, quota gate |
| [`2026-06-07-repo-auto-explore-design.md`](./superpowers/specs/2026-06-07-repo-auto-explore-design.md) | Auto-clone, index, and present a rich repo overview + mission suggestions |

---

## Implementation plans

The "how" — step-by-step task plans for each major piece of work. Grouped by month, most recent first.

### 2026-06

| Plan | Summary |
|---|---|
| [`2026-06-07-frontend-mission-control-layout.md`](./superpowers/plans/2026-06-07-frontend-mission-control-layout.md) | Rework the active mission experience into the composed `MissionPipeline` + `MissionInspectorPanel` layout |
| [`2026-06-07-repo-auto-explore.md`](./superpowers/plans/2026-06-07-repo-auto-explore.md) | Backend explore/summary/hotspots/suggestions endpoints + `RepoOverviewPanel` + compact sidebar card |
| [`2026-06-07-oauth-state-preservation.md`](./superpowers/plans/2026-06-07-oauth-state-preservation.md) | Preserve dashboard UI state across GitHub OAuth round-trip via `sessionStorage` |
| [`2026-06-06-minimax-provider-support.md`](./superpowers/plans/2026-06-06-minimax-provider-support.md) | Add MiniMax as a third built-in PiNyx provider (model `MiniMax-M3`) |
| [`2026-06-01-frontend-ui-audit-fixes.md`](./superpowers/plans/2026-06-01-frontend-ui-audit-fixes.md) | Cleanup pass on hooks, components, and styling after the integration audit |

### 2026-05

| Plan | Summary |
|---|---|
| [`2026-05-31-pinyx-integration-redesign.md`](./superpowers/plans/2026-05-31-pinyx-integration-redesign.md) | Implement the Integrations panel (Connection / Keys / Models) + Bumblebee scanner + Stryker mutation testing + Quota gate |
| [`2026-05-31-github-repo-prepare-flow.md`](./superpowers/plans/2026-05-31-github-repo-prepare-flow.md) | Build the user-consent clone-and-index flow for a selected GitHub repo |
| [`2026-05-31-code-context-panel.md`](./superpowers/plans/2026-05-31-code-context-panel.md) | Backend code-context API + frontend `CodeContextPanel` |
| [`2026-05-30-integration-audit-fixes.md`](./superpowers/plans/2026-05-30-integration-audit-fixes.md) | Fix the small set of type and runtime issues surfaced by the GitHub-integration audit |
| [`2026-05-30-github-app-integration.md`](./superpowers/plans/2026-05-30-github-app-integration.md) | Implement GitHub App OAuth, repo picker, and `cloneUrl` mission config |
| [`2026-05-30-github-pat-integration.md`](./superpowers/plans/2026-05-30-github-pat-integration.md) | PAT-based fallback for users without a GitHub App install |
| [`2026-05-30-github-integration.md`](./superpowers/plans/2026-05-30-github-integration.md) | General GitHub integration routes, status, and OAuth callback plumbing |
| [`2026-05-29-new-mission-form.md`](./superpowers/plans/2026-05-29-new-mission-form.md) | New Mission form with GitHub repo picker, description, and model hints |
| [`2026-05-29-mission-control-ui.md`](./superpowers/plans/2026-05-29-mission-control-ui.md) | Mission Control UI redesign (precursor to the 2026-06-07 layout rework) |
| [`2026-05-29-mission-control-ui-review.md`](./superpowers/plans/2026-05-29-mission-control-ui-review.md) | Self-review of the Mission Control UI plan against the codebase and DESIGN.md |
| [`2026-05-28-implementation-tracker.md`](./superpowers/plans/2026-05-28-implementation-tracker.md) | Single source of truth for unimplemented features, code quality issues, and deferred items |
| [`2026-05-28-wire-enforcement.md`](./superpowers/plans/2026-05-28-wire-enforcement.md) | Wire the enforcement modules into the milestone loop |
| [`2026-05-28-aurex-runtime-gaps.md`](./superpowers/plans/2026-05-28-aurex-runtime-gaps.md) | Close the major functional gaps in the runtime (PR #9) |
| [`2026-05-27-worker-spawning.md`](./superpowers/plans/2026-05-27-worker-spawning.md) | Worker spawning with isolated git worktrees (PR #3) |
| [`2026-05-27-orchestrator-runtime.md`](./superpowers/plans/2026-05-27-orchestrator-runtime.md) | Orchestrator runtime: mission loop, planner, negotiator, agent spawner |
| [`2026-05-26-aurex-restructuring.md`](./superpowers/plans/2026-05-26-aurex-restructuring.md) | Top-level repo restructuring into the `packages/{shared,backend,frontend}` monorepo layout |

---

## Project conventions

| Source | Convention |
|---|---|
| [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | `packages/*` is a pnpm workspace; packages are `@aurex/shared`, `@aurex/backend`, `@aurex/frontend` |
| [`tsconfig.base.json`](../tsconfig.base.json) | TypeScript base config shared across all packages |
| [`stryker.config.mjs`](../stryker.config.mjs) | Stryker mutation testing harness (run via `pnpm test:mutation`) |
| [`vitest.config.ts`](../vitest.config.ts) | Vitest configuration |
| [`docker-compose.yml`](../docker-compose.yml) | Production full stack (real PiNyx gateway) |
| [`docker-compose.e2e.yml`](../docker-compose.e2e.yml) | E2E test stack (PiNyx stub, used by `pnpm test:e2e`) |
| [`Dockerfile.lapis`](../Dockerfile.lapis) | LaPis (shared state) image |
| [`Dockerfile.pinyx`](../Dockerfile.pinyx) | PiNyx (real Rust LLM gateway) image |
| [`Dockerfile.pinyx-stub`](../Dockerfile.pinyx-stub) | PiNyx stub image (mock responses, E2E only) |
| [`packages/backend/Dockerfile`](../packages/backend/Dockerfile) | Backend image (used by `docker-compose.yml`) |
| [`packages/frontend/Dockerfile`](../packages/frontend/Dockerfile) | Frontend image (used by `docker-compose.yml`) |
| [`.env.example`](../.env.example) | Source of truth for all environment variables; see [`docs/configuration.md`](./configuration.md) for narrative |
| [`scripts/`](../scripts) | E2E harness (`e2e-docker.sh`) and smoke-test entry points (`pinyx-stub.mjs`, `smoke-lapis.js`, `smoke-pinyx.js`) |
