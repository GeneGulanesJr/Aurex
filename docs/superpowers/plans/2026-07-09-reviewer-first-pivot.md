# Reviewer-First Pivot — Implementation Plan

> **For agentic workers:** Implement phase-by-phase. Check off tasks with `- [ ]` → `- [x]`. Do not wire durable queue or prepared sessions — they remain experimental.

**Goal:** Make codebase review the primary Aurex experience. Users prepare a repo and receive a unified Health Report without creating a mission. Coding agents remain available behind `AUREX_MISSIONS_ENABLED` for Phase 2.

**Architecture:** Extend existing repo-explore + LaPis + Bumblebee + mutation stack with a `ReviewReport` orchestration layer and reframe the frontend around `RepoHealthReport`. Reuse `prompt-optimizer.ts` patterns for optional LLM narrative — do not reuse mission-only hooks directly.

**Tech Stack:** TypeScript, Fastify, LaPis HTTP client, React 19, Vitest, existing Bumblebee/mutation scanners.

**Design spec:** [`2026-07-09-reviewer-first-pivot-design.md`](../specs/2026-07-09-reviewer-first-pivot-design.md)

---

## Current State (verified)

| Capability | Status | Gap |
|---|---|---|
| LaPis index / summary / hotspots | ✅ | — |
| LaPis graph | ✅ backend | ❌ no repo-level REST or UI |
| `generateSuggestions()` (12 categories, P0–P5) | ✅ | ❌ not bundled into one report |
| Bumblebee repo scan `POST /repos/:name/scans` | ✅ | ❌ frontend never triggers; security suggestions empty |
| Mutation scanner | ✅ | ❌ not in suggestion tiers; optional |
| `RepoOverviewPanel` | ✅ | ❌ mission-framed CTAs only |
| Validator / worker agents | ✅ | ❌ mission-gated; defer |
| `prompt-optimizer.ts` | ✅ | ❌ mission-only; adapt pattern for review narrative |
| Mission orchestrator | ✅ | 🔒 hide behind flag for v1 |

---

## File Structure (new + modified)

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/review.ts` | **Create** | `ReviewReport`, `ReviewFinding`, triage enums |
| `packages/shared/src/index.ts` | Modify | Re-export review types |
| `packages/backend/src/review/review-generator.ts` | **Create** | Assemble report from LaPis + scans + suggestions |
| `packages/backend/src/review/review-narrator.ts` | **Create** | Optional LLM executive summary (Phase 1b) |
| `packages/backend/src/review/review-store.ts` | **Create** | LaPis settings persistence for reports |
| `packages/backend/src/routes/review-routes.ts` | **Create** | `POST/GET /api/repos/:repoName/review`, triage PATCH |
| `packages/backend/src/routes/repo-explore.ts` | Modify | Add `GET /graph`; export helpers for review-generator |
| `packages/backend/src/config.ts` | Modify | `AUREX_MISSIONS_ENABLED` (default `false`) |
| `packages/backend/src/server.ts` | Modify | Register review routes; gate mission UI endpoints messaging |
| `packages/backend/src/skills/reviewer.md` | **Create** | Read-only deep-dive agent prompt (Phase 1b) |
| `packages/backend/__tests__/review-generator.test.ts` | **Create** | Unit tests for report assembly |
| `packages/backend/__tests__/routes/review-routes.test.ts` | **Create** | Route integration tests |
| `packages/frontend/src/passive/RepoHealthReport.tsx` | **Create** | Unified dashboard (evolve from RepoOverviewPanel) |
| `packages/frontend/src/passive/RepoOverviewPanel.tsx` | Modify or deprecate | Thin wrapper → RepoHealthReport |
| `packages/frontend/src/App.tsx` | Modify | Review-first flow; auto-trigger review on prepare |
| `packages/frontend/src/api.ts` | Modify | `runRepoReview`, `getRepoReview`, `getRepoGraph`, `triggerRepoScan`, triage |
| `packages/frontend/src/passive/StatusBoard.tsx` | Modify | Review-first empty state |
| `docs/api.md` | Modify | Document review endpoints |
| `.env.example` | Modify | `AUREX_MISSIONS_ENABLED=false` |

---

## Phase 1a — Unified Health Report (MVP)

**Outcome:** User prepares repo → sees one Health Report with all deterministic findings. No mission required.

### Task 1: Shared review types

**Files:** `packages/shared/src/review.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1:** Define `ReviewFinding` extending `RepoSuggestion` with `status: "open" | "acknowledged" | "dismissed" | "fix_queued"` and optional `deepDive?: string`
- [ ] **Step 2:** Define `ReviewReport` per design spec (summary, sections, metadata, `status`)
- [ ] **Step 3:** Export from `@aurex/shared`; add type tests if shared test suite exists
- [ ] **Step 4:** Run `pnpm run typecheck`

### Task 2: Review generator (deterministic only)

**Files:** `packages/backend/src/review/review-generator.ts`, `packages/backend/__tests__/review-generator.test.ts`

- [ ] **Step 1:** Extract `generateSuggestions` + `recommendSuggestions` imports from `repo-explore.ts` (export them or move to `review/suggestion-engine.ts` if circular imports appear)
- [ ] **Step 2:** Implement `buildReviewReport(repoName, { summary, hotspots, graph, scan, readiness, mutation })`:
  - Partition suggestions into `critical` (P0–P1), `improvements` (P2–P3), `polish` (P4–P5)
  - Populate `summary.findingCounts`
  - Include architecture subsection from graph + summary cycles/entryPoints
  - Set `status: "partial"` if any upstream fetch failed
- [ ] **Step 3:** Unit tests with fixture LaPis payloads (mock data objects, no HTTP)
- [ ] **Step 4:** Run `pnpm --filter @aurex/backend test review-generator`

### Task 3: Review store

**Files:** `packages/backend/src/review/review-store.ts`

- [ ] **Step 1:** `saveReview(lapis, report)` → `review:<id>` + append to `repo:<name>:reviews` + set `repo:<name>:latest_review_id`
- [ ] **Step 2:** `getLatestReview(lapis, repoName)`, `getReview(lapis, reviewId)`
- [ ] **Step 3:** `updateFindingTriage(lapis, reviewId, findingId, status)` — patch single finding
- [ ] **Step 4:** Unit tests with mock LaPis client

### Task 4: Review routes + repo graph endpoint

**Files:** `packages/backend/src/routes/review-routes.ts`, `packages/backend/src/routes/repo-explore.ts`, `packages/backend/src/server.ts`

- [ ] **Step 1:** Add `GET /api/repos/:repoName/graph` → `lapis.getCodeGraph(repoName)` (404 if not prepared)
- [ ] **Step 2:** Implement `POST /api/repos/:repoName/review`:
  1. Resolve repo path (404 if missing)
  2. Ensure indexed (`explore` or `indexRepo` if stale — document policy: always re-index on review for v1)
  3. Fetch summary, hotspots, graph, readiness in parallel
  4. If no recent Bumblebee scan (< 24h or none): run `POST scans` logic inline
  5. Fetch mutation summary (best-effort)
  6. Call `buildReviewReport`, persist, return 201
- [ ] **Step 3:** Implement `GET /api/repos/:repoName/review` (latest) and `GET /api/repos/:repoName/review/:reviewId`
- [ ] **Step 4:** Implement `PATCH /api/repos/:repoName/review/:reviewId/findings/:findingId` with `{ status }`
- [ ] **Step 5:** Implement `GET /api/repos/:repoName/review/:reviewId/export` → Markdown string
- [ ] **Step 6:** Register routes in `server.ts`
- [ ] **Step 7:** Route tests in `review-routes.test.ts` (mock lapis + bumblebee)
- [ ] **Step 8:** Run backend tests

### Task 5: Feature flag for missions

**Files:** `packages/backend/src/config.ts`, `.env.example`, `packages/backend/src/routes/missions.ts`

- [ ] **Step 1:** Add `missionsEnabled: process.env.AUREX_MISSIONS_ENABLED !== "false"` (default **false** for reviewer-first)
- [ ] **Step 2:** `POST /api/missions` returns `503 { error: "Mission orchestration is disabled. Enable AUREX_MISSIONS_ENABLED=true." }` when flag off
- [ ] **Step 3:** Document in `.env.example` and `docs/configuration.md`
- [ ] **Step 4:** Test: mission create blocked when flag false

### Task 6: Frontend — review-first flow

**Files:** `packages/frontend/src/api.ts`, `App.tsx`, `RepoHealthReport.tsx`, `StatusBoard.tsx`

- [ ] **Step 1:** Add API functions: `runRepoReview`, `getRepoReview`, `getRepoGraph`, `triggerRepoScan`, `exportReview`, `triageFinding`
- [ ] **Step 2:** Create `RepoHealthReport.tsx`:
  - Accept `ReviewReport` prop
  - Sections: summary bar, critical/improvements/polish accordions, graph, hotspots, supply chain, mutation, readiness
  - Finding actions: Acknowledge, Dismiss (calls triage PATCH) — **no Start Mission** in v1
  - Export button → download Markdown
- [ ] **Step 3:** Update `handleRepoPrepared` in `App.tsx`:
  - Replace parallel `getRepoSuggestions` + `listRepoScans` with single `runRepoReview`
  - Persist `{ repoName, reviewId }` in sessionStorage (extend existing `prepared_repo` key)
- [ ] **Step 4:** Update empty state copy: “Connect a repository to run a health review”
- [ ] **Step 5:** Hide mission creation form when `missionsEnabled` false (fetch from new `GET /api/config` or embed in existing status endpoint)
- [ ] **Step 6:** Frontend tests for api.ts new functions
- [ ] **Step 7:** Manual smoke: prepare repo → review loads → triage works → export downloads

### Task 7: Documentation

**Files:** `docs/api.md`, `docs/INDEX.md`, `README.md` (short pivot note)

- [ ] **Step 1:** Document all review endpoints in `docs/api.md`
- [ ] **Step 2:** Add spec + plan to `docs/INDEX.md`
- [ ] **Step 3:** Update README “How It Works” with reviewer-first flow as primary; mission loop marked “Phase 2 (optional)”

**Phase 1a exit criteria:**

- [ ] Prepare repo → Health Report without mission
- [ ] Package scan auto-runs on first review
- [ ] Graph visible in UI
- [ ] Export Markdown works
- [ ] Missions disabled by default; explicit flag enables them
- [ ] All existing tests pass + new review tests pass

---

## Phase 1b — LLM Narrative & Deep-Dive Reviewer

**Outcome:** Report includes an executive summary; user can request deep-dive on a finding.

### Task 8: Review narrator

**Files:** `packages/backend/src/review/review-narrator.ts`, tests

- [ ] **Step 1:** Adapt `prompt-optimizer.ts` pattern:
  - System prompt: “Summarize these findings for an engineering lead. Do not invent new issues. Reference finding IDs.”
  - Input: JSON summary of `ReviewReport.sections.critical` + `improvements` (cap token size)
  - Fail-safe: return `undefined` on PiNyx error; report still valid without narrative
- [ ] **Step 2:** Call from `POST /review` when `?narrative=true` query param or `AUREX_REVIEW_NARRATIVE_ENABLED=true`
- [ ] **Step 3:** Tests with mocked PiNyx client

### Task 9: Reviewer skill + optional deep-dive endpoint

**Files:** `packages/backend/src/skills/reviewer.md`, `packages/backend/src/routes/review-routes.ts`

- [ ] **Step 1:** Write `reviewer.md` — read-only, evidence-grounded, based on `validator.md` scrutiny rules + `research.md` exploration limits
- [ ] **Step 2:** `POST /api/repos/:repoName/review/:reviewId/findings/:findingId/deep-dive`:
  - Spawn read-only Pi agent session (reuse researcher factory if available, or lightweight one-shot PiNyx call for v1)
  - Append result to finding `deepDive`
- [ ] **Step 3:** Frontend: “Deep dive” button on P0–P1 findings (shows loading, then expander)

**Phase 1b exit criteria:**

- [ ] Narrative appears when enabled; absent when PiNyx down
- [ ] Deep-dive produces grounded text referencing files from finding evidence

---

## Phase 2 — Fix with Agent (deferred)

**Outcome:** User can convert a finding into a scoped mission.

### Task 10: Finding → mission bridge

- [ ] **Step 1:** Re-enable missions via `AUREX_MISSIONS_ENABLED=true`
- [ ] **Step 2:** “Fix with agent” CTA on findings → `createMission({ description: finding.prefill, repoName, scope: finding.affectedFiles })`
- [ ] **Step 3:** Set finding status `fix_queued` + link `missionId` on report
- [ ] **Step 4:** Keep validator/worker loop unchanged — mission is the execution container

### Task 11: Sidebar repo list

- [ ] **Step 1:** Sidebar section “Repositories” listing prepared repos + last review date + P0 count badge
- [ ] **Step 2:** Click repo → load latest review without re-running unless stale (> 7 days or user clicks Re-run)

---

## Phase 3 — Long-Horizon Missions (deferred)

Restore original Aurex vision as premium tier:

- Multi-milestone missions from free-form goals
- Full mission pipeline dashboard as primary when missions enabled
- Prompt optimizer on mission create
- Post-milestone Bumblebee auto-scan

**No tasks until Phase 1a/1b ship and dismiss-rate metrics are acceptable.**

---

## Explicitly Out of Scope

- [ ] Durable prepared sessions / execution queue wiring (`AUREX_DURABLE_QUEUE_ENABLED`)
- [ ] Auto-merge or autonomous fix without user approval
- [ ] GitHub PR comment bot (defer)
- [ ] Scheduled/cron re-reviews (defer)
- [ ] Deleting orchestrator code — flag only

---

## Testing Strategy

| Layer | What to test |
|---|---|
| `review-generator` | Partitioning, partial failure, empty repo, scan-less security |
| `review-routes` | 404 unprepared, auto-scan trigger, triage PATCH, export format |
| `review-narrator` | PiNyx failure fallback, no hallucinated finding IDs |
| Frontend `api.ts` | New endpoints |
| E2E (optional) | `docker-compose.e2e.yml`: prepare → review → export |

Run before merge:

```bash
pnpm run typecheck
pnpm test
```

---

## Rollout Checklist

- [ ] Phase 1a merged; `AUREX_MISSIONS_ENABLED` defaults false
- [ ] README and dashboard copy reflect reviewer-first
- [ ] Changelog updated
- [ ] Monitor: review completion rate, P0 dismiss rate, export usage
- [ ] Phase 1b behind `AUREX_REVIEW_NARRATIVE_ENABLED`
- [ ] Phase 2 announced only after 1a stable

---

## Task Order (critical path)

```
T1 types → T2 generator → T3 store → T4 routes → T5 flag → T6 frontend → T7 docs
                                                              ↓
                                              T8 narrator → T9 deep-dive (Phase 1b)
                                                              ↓
                                              T10–T11 (Phase 2, later)
```

Estimated scope: **Phase 1a ≈ 7 tasks**, mostly extending existing code. No new infrastructure services required.
