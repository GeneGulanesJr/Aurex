# Reviewer-First Pivot — Design Spec

> **Status:** Proposed · **Date:** 2026-07-09  
> **Supersedes (product priority):** Long-horizon autonomous coding agent as the primary entry point  
> **Preserves (deferred):** Mission orchestrator, workers, validators, worktrees — behind a feature flag until review quality is proven

---

## Problem

Aurex was conceived as an AI **mission control for coding tasks**: plan → build → validate → merge. That positions us directly against well-funded general coding agents (Cursor, Devin, Copilot, etc.) where distribution, IDE integration, and model spend are hard to match.

Meanwhile, Aurex already has substantial **codebase analysis plumbing** that does not require a mission:

- LaPis indexing, summary, graph, hotspots
- Deterministic suggestion engine (P0–P5 tiers, 12 categories)
- Bumblebee / native supply-chain scanning
- Stryker mutation testing
- Readiness profiling (package manager, scripts, blockers)
- A repo overview UI (`RepoOverviewPanel`)

The gap is **product shape**, not infrastructure: findings are framed as “Next Best Missions,” package scans are not auto-run, the dependency graph is mission-gated, and there is no standalone review artifact or LLM-generated report.

---

## Goal

**Lead with codebase review.** Users connect a repo, get a prioritized health report within minutes, and can export or triage findings — without starting a coding mission.

Coding agents (workers + validators + orchestrator) become **Phase 2**: optional “Fix this finding” actions once review trust is established.

---

## Non-Goals (for v1 reviewer product)

- Competing as a general-purpose long-horizon coding agent
- Wiring the durable prepared-session / execution-queue control plane
- Auto-fixing or auto-merging without explicit user opt-in
- Replacing dedicated SAST/SCA vendors (SonarQube, Snyk, Semgrep) — we integrate and unify, not replicate every rule

---

## Product Principles

1. **Read-only by default** — review never writes branches or merges code
2. **Evidence-backed findings** — every item cites LaPis data, scan output, or file paths; LLM narrative supplements, never replaces, deterministic signals
3. **Fast time-to-value** — first useful report within one prepare + explore cycle
4. **Triage before execution** — acknowledge, dismiss, export, or optionally “Fix later”
5. **Reuse existing stack** — LaPis, Bumblebee, mutation scanner, prompt-optimizer pattern; don’t rebuild analysis from scratch

---

## User Journey (v1)

```
Connect GitHub → Pick repo → Prepare (clone + index)
    → Auto-run: explore, readiness, package scan, suggestions
    → Health Report dashboard (findings, graph, hotspots, supply chain, mutation)
    → User: export Markdown / triage findings / (later) Fix this finding
```

Mission creation moves to a secondary action (“Fix with agent”) hidden until Phase 2.

---

## Architecture

### What stays the same

| Component | Role in reviewer mode |
|---|---|
| **LaPis** | Index repo, serve summary / graph / hotspots |
| **repo-explore routes** | Core analysis API (extend, don’t replace) |
| **Bumblebee + native scanner** | Supply-chain findings |
| **mutation-scanner** | Test-quality signal (optional, Stryker-dependent) |
| **GitHub prepare flow** | Clone + persist `repo:<name>:path` |
| **RepoOverviewPanel** | Primary dashboard (reframe, extend) |

### What we add

| Component | Purpose |
|---|---|
| **`POST /api/repos/:repoName/review`** | Orchestrate full review run; persist report in LaPis settings |
| **`GET /api/repos/:repoName/review`** | Fetch latest (or specific) review report |
| **`GET /api/repos/:repoName/graph`** | Repo-level dependency graph (mirror mission code-context) |
| **`review-generator.ts`** | Merge deterministic suggestions + scan data into structured report; optional LLM narrative |
| **`reviewer.md` skill** | Read-only agent prompt for deep-dive on top-N findings (Phase 1b) |
| **`ReviewReport` type** | Shared contract: findings, scores, sections, metadata |
| **Frontend: Review-first layout** | Default view after prepare; mission form de-emphasized |

### What we defer (feature-flagged)

| Component | Flag / behavior |
|---|---|
| Mission orchestrator | `AUREX_MISSIONS_ENABLED=false` (default off in reviewer mode) |
| Worker spawner / worktrees | Only when user clicks “Fix with agent” |
| Durable queue / prepared sessions | Remain experimental; no v1 dependency |
| Prompt optimizer | Mission-only today; reuse *pattern* for review narrative, not the mission hook |

---

## Review Report Structure

A unified artifact replacing scattered suggestion/scan/hotspot calls:

```typescript
interface ReviewReport {
  id: string;
  repoName: string;
  createdAt: string;
  analysisVersion: string;
  status: "running" | "completed" | "partial" | "failed";

  summary: {
    files: number;
    symbols: number;
    modules: number;
    cycleCount: number;
    findingCounts: Record<SuggestionTier, number>;
    supplyChainSeverity?: BumblebeeScanSummary;
    mutationScore?: number | null;
  };

  sections: {
    critical: ReviewFinding[];      // P0–P1
    improvements: ReviewFinding[];  // P2–P3
    polish: ReviewFinding[];        // P4–P5
    supplyChain: BumblebeeFinding[];
    hotspots: CodeHotspot[];
    architecture: {
      modules: ModuleSummary[];
      cycles: string[][];
      entryPoints: string[];
    };
    readiness: RepoReadinessProfile;
  };

  narrative?: string;  // Optional LLM executive summary (Phase 1b)
  recommended?: { highestImpact?: string; safestFirst?: string };
}
```

`ReviewFinding` extends today’s `RepoSuggestion` with triage state: `status: "open" | "acknowledged" | "dismissed" | "fix_queued"`.

---

## Analysis Layers

### Layer 1 — Deterministic (ship first)

Already implemented in `generateSuggestions()` + LaPis + Bumblebee:

- Dependency cycles, complexity hotspots, coupling, layer violations
- Test/doc heuristics, supply-chain severity mapping
- Readiness blockers

**Action:** Bundle into `POST /review`, auto-trigger package scan if none exists.

### Layer 2 — LLM narrative (Phase 1b)

Adapt `prompt-optimizer.ts` pattern:

- Input: structured findings JSON + repo summary (not raw repo)
- Output: executive summary, cross-finding themes, recommended order of attack
- Fail-safe: return deterministic report only if PiNyx unavailable

**Do not** let the LLM invent findings — it narrates and prioritizes existing evidence.

### Layer 3 — Deep-dive reviewer agent (Phase 1b, optional)

Read-only agent using `research.md` + `validator.md` scrutiny rules:

- Spawned only for user-selected finding or top-N P0/P1 items
- Tools: `read`, `bash` (git log, grep), LaPis graph lookup
- Output: appended `deepDive` field on finding

---

## Frontend Changes

### Primary view: Health Report

Evolve `RepoOverviewPanel` → **`RepoHealthReport`**:

| Section | Source |
|---|---|
| Executive summary | Review report narrative + counts |
| Critical findings | P0–P1 with evidence expanders |
| Architecture | Graph (`DependencyGraph`), cycles, modules |
| Hotspots | `HotspotHeatmap` |
| Supply chain | Findings table + severity badges |
| Test quality | `MutationPanel` (when Stryker present) |
| Readiness | Commands, blockers, package manager |

### De-emphasize mission creation

- Remove “Start Mission →” as the only CTA on every finding
- Replace with: **Acknowledge**, **Dismiss**, **Export**, **Copy details**
- Phase 2: **Fix with agent** (prefills mission, requires `AUREX_MISSIONS_ENABLED`)

### Navigation

- Sidebar: **Repositories** (prepared repos + last review date) before **Missions**
- Empty state: “Connect a repo to run your first health review”

---

## Storage

No LaPis schema migration required for v1. Use settings KV (existing pattern):

| Key | Value |
|---|---|
| `repo:<name>:reviews` | `{ reviewIds: string[] }` |
| `review:<id>` | Full `ReviewReport` JSON |
| `repo:<name>:latest_review_id` | string |

Triage updates patch individual findings inside `review:<id>`.

---

## Success Metrics

| Metric | Target (v1) |
|---|---|
| Time to first report after prepare | < 2 min for repos < 5k files |
| Findings with evidence | 100% of deterministic items |
| User can complete flow without mission | Yes |
| Export produces valid Markdown | Yes |
| False-positive rate (P0/P1) | Track via dismiss rate; tune heuristics |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| “Another scanner” without differentiation | Unified report + graph + supply chain + optional LLM narrative + future fix path |
| LLM hallucinated findings | LLM narrates only; findings come from deterministic layer |
| Package scan never ran (today’s gap) | Auto-run on review; show partial status if scan fails |
| Mission code bit-rots | Feature-flag, keep tests, don’t delete orchestrator |
| Stryker not configured | Mutation section shows “not configured”; don’t block report |

---

## Phased Rollout

| Phase | Scope | User-visible outcome |
|---|---|---|
| **1a** | Unified review API + auto-scan + graph endpoint + UI reframe | One-click health report, no missions required |
| **1b** | LLM narrative + optional deep-dive reviewer agent | Executive summary and richer finding detail |
| **2** | “Fix with agent” + `AUREX_MISSIONS_ENABLED` | Findings → scoped missions |
| **3** | Long-horizon missions, multi-milestone goals | Full Aurex mission control (original vision) |

---

## Key Files

| Area | Files |
|---|---|
| API | `packages/backend/src/routes/repo-explore.ts`, new `review-routes.ts` |
| Generator | new `packages/backend/src/review/review-generator.ts` |
| LLM | new `packages/backend/src/review/review-narrator.ts` (pattern from `prompt-optimizer.ts`) |
| Skills | new `packages/backend/src/skills/reviewer.md` |
| Types | `packages/shared/src/rest.ts` |
| Frontend | `RepoOverviewPanel.tsx` → `RepoHealthReport.tsx`, `App.tsx`, `api.ts`, `StatusBoard.tsx` |
| Config | `.env.example`, `docs/api.md` — `AUREX_MISSIONS_ENABLED` |

---

## Open Questions

1. **GitHub App vs PAT only for v1?** — Keep existing OAuth; no change required.
2. **Review re-run policy** — Manual “Re-run review” button; no auto-schedule in v1.
3. **PR comment integration** — Defer to Phase 2 (needs GitHub check run or comment API).
4. **Pricing model** — Review-only may use fewer tokens; quota gate still applies for LLM narrative.

---

## Related Docs

- [`2026-06-07-repo-auto-explore`](../plans/2026-06-07-repo-auto-explore.md) — prior repo overview work (paths may differ)
- [`docs/AUDIT-dead-incomplete-code.md`](../../AUDIT-dead-incomplete-code.md) — durable queue explicitly deferred
- [`packages/backend/src/routes/repo-explore.ts`](../../../packages/backend/src/routes/repo-explore.ts) — suggestion engine
- [`packages/backend/src/orchestrator/prompt-optimizer.ts`](../../../packages/backend/src/orchestrator/prompt-optimizer.ts) — LLM brief pattern to reuse
