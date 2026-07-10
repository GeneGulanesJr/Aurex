# Reviewer-First Pivot — Implementation Plan

> **For agentic workers:** Implement phase-by-phase. Check off tasks with `- [ ]` → `- [x]`. Do not wire durable queue or prepared sessions — they remain experimental.

**Goal:** Scan a repo via LaPis, isolate each issue, and generate **copy-ready fix prompts** with accurate context and a proposed fix. No in-app agent execution. User copies prompts into their own tools.

**Architecture:** LaPis index → detect signals → `issue-isolator.ts` (one small fix per issue) → `fix-prompt-builder.ts` (LaPis scaffold + template) → UI with issue list + Copy prompt.

**Tech Stack:** TypeScript, Fastify, LaPis HTTP client, React 19, Vitest, Bumblebee scanner, `affected-code.ts` for graph context.

**Design spec:** [`2026-07-09-reviewer-first-pivot-design.md`](../specs/2026-07-09-reviewer-first-pivot-design.md)

---

## Current State (verified)

| Capability | Status | Gap |
|---|---|---|
| LaPis index / summary / hotspots | ✅ | — |
| LaPis graph | ✅ backend | ❌ no repo-level REST or UI |
| `generateSuggestions()` | ✅ | ❌ bundles cycles + dead code; needs `issue-isolator` |
| `prefill` strings | ✅ | ❌ too short; replace with full `fixPrompt` template |
| `affected-code.ts` scaffold | ✅ | ❌ not wired for repo-level prompts yet |
| Bumblebee repo scan | ✅ | ❌ not auto-run from UI |
| Mission / agent UI | ✅ | 🔒 hide entirely in v1 |

---

## File Structure (new + modified)

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/review.ts` | **Create** | `IsolatedIssue`, `FixPrompt`, `ReviewReport` |
| `packages/backend/src/review/issue-isolator.ts` | **Create** | Split bundled signals → one issue per cycle/file/package |
| `packages/backend/src/review/fix-prompt-builder.ts` | **Create** | LaPis context + category template → Markdown `fixPrompt` |
| `packages/backend/src/review/review-generator.ts` | **Create** | Orchestrate index + fetch + isolate + build prompts |
| `packages/backend/src/review/review-store.ts` | **Create** | Persist reports in LaPis settings |
| `packages/backend/src/routes/review-routes.ts` | **Create** | `POST/GET /api/repos/:repoName/review` |
| `packages/backend/src/routes/repo-explore.ts` | Modify | Export raw signal helpers; add `GET /graph` |
| `packages/frontend/src/passive/RepoScanDashboard.tsx` | **Create** | Issue list + Fix Prompt panel + Copy button |
| `packages/frontend/src/App.tsx` | Modify | Scan-first flow; hide mission UI |
| `packages/frontend/src/api.ts` | Modify | `runRepoReview`, `getRepoReview`, `getRepoGraph` |

---

## Phase 1a — Scan + Isolated Fix Prompts (MVP)

**Outcome:** User prepares repo → sees isolated issues → copies a full fix prompt for any one issue.

### Task 1: Shared types (`IsolatedIssue`, `ReviewReport`)

- [ ] Define `IsolatedIssue` with `scopePaths`, `scopeModules`, `fixPrompt`, `fixPromptVersion`
- [ ] Define `ReviewReport` with flat `issues[]` array
- [ ] Export from `@aurex/shared`

### Task 2: Issue isolator

**Files:** `packages/backend/src/review/issue-isolator.ts`, tests

- [ ] Input: LaPis summary, graph, hotspots, Bumblebee scan, readiness
- [ ] **Split cycles:** one `IsolatedIssue` per entry in `summary.cycles.paths[]`
- [ ] **Split dead code:** one issue per orphan file (not bundled “audit N files”)
- [ ] **Keep per-file complexity** (already isolated)
- [ ] **Keep per-package security** (already isolated)
- [ ] **Split readiness blockers:** one issue per blocker
- [ ] Enforce `scopePaths.length <= 3`; if cycle touches more, pick the 3 highest-importance nodes from graph
- [ ] Unit tests for splitting rules

### Task 3: Fix prompt builder

**Files:** `packages/backend/src/review/fix-prompt-builder.ts`, tests

- [ ] Reuse `buildAffectedCodeScaffold()` from `affected-code.ts` for graph/hotspot context block
- [ ] Per-category template for **Proposed fix** section:
  - `critical_path` → extract interface / invert import / move shared types
  - `complexity` → extract functions, reduce branching
  - `security` → upgrade/replace package, update lockfile
  - `dead_code` → confirm unused, remove export/file
  - etc.
- [ ] Inject readiness verify commands into **Verification** section
- [ ] Output full Markdown `fixPrompt` per design spec template
- [ ] Unit tests: prompt contains scope paths, LaPis evidence, proposed fix, verify commands

### Task 4: Review generator + routes

- [ ] `review-generator.ts`: index → parallel fetch → isolate → build prompts → persist
- [ ] Auto-run Bumblebee scan if none in last 24h
- [ ] `POST /api/repos/:repoName/review`, `GET .../review`, `GET .../graph`
- [ ] Route tests

### Task 5: Frontend — issue list + copy prompt

- [ ] `RepoScanDashboard`: left issue list, right prompt panel
- [ ] **Copy fix prompt** button (clipboard API)
- [ ] Remove “Start Mission” CTAs
- [ ] Hide mission creation UI
- [ ] On prepare → `runRepoReview()`

### Task 6: Docs

- [ ] Update `docs/api.md`, README pivot note

**Phase 1a exit criteria:**

- [ ] Every issue is isolated (≤3 files)
- [ ] Every issue has a copy-ready `fixPrompt` with LaPis context
- [ ] No mission/agent UI in v1 path
- [ ] Tests pass

---

## Phase 1b — LLM Prompt Polish (optional)

**Outcome:** Fix prompts read more naturally; scope unchanged.

### Task 7: Prompt polisher

**Files:** `packages/backend/src/review/fix-prompt-polisher.ts`, tests

- [ ] Adapt `prompt-optimizer.ts` fail-safe pattern
- [ ] Input: template `fixPrompt` + `IsolatedIssue` JSON
- [ ] Output: polished Markdown; **must preserve `scopePaths` exactly**
- [ ] Opt-in via `?polish=true` or env flag
- [ ] Tests: scope paths unchanged after polish

**Phase 1b exit criteria:**

- [ ] Polished prompts read better; deterministic fallback always works

---

## Future (not planned)

- In-app fix-with-agent / missions / orchestrator
- GitHub PR comment bot
- Scheduled re-scans

---

## Explicitly Out of Scope (v1)

- [ ] Fix-with-agent, missions, workers, validators in UI
- [ ] One large bundled fix prompt
- [ ] Durable prepared sessions / execution queue
- [ ] Auto-merge or in-app code changes
- [ ] Deleting orchestrator code (keep for future)

---

## Testing Strategy

| Layer | What to test |
|---|---|
| `issue-isolator` | Per-cycle split, per-file dead code, ≤3 scope paths |
| `fix-prompt-builder` | LaPis context present, category templates, verify commands |
| `review-generator` | End-to-end assembly, partial failure, auto-scan |
| `review-routes` | 404 unprepared, copy/export |
| Frontend | Copy button, issue selection |

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
T1 types → T2 issue-isolator → T3 fix-prompt-builder → T4 routes → T5 frontend → T6 docs
                                                              ↓
                                                    T7 prompt-polisher (Phase 1b)
```
