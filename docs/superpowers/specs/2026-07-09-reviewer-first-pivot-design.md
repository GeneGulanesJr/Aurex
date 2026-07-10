# Reviewer-First Pivot — Design Spec

> **Status:** Proposed · **Date:** 2026-07-09 · **Updated:** 2026-07-09 (prompt-first scope)  
> **Supersedes (product priority):** Long-horizon autonomous coding agent as the primary entry point  
> **v1 product:** Scan repo → isolated issues → copy-ready fix prompts with LaPis-backed context  
> **Out of scope for now:** Fix-with-agent, missions, workers, validators, worktrees

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

**Scan the repo, isolate each issue, generate a small targeted fix prompt with accurate LaPis context.**

Users connect a repo, Aurex indexes it via LaPis, identifies discrete problems, and produces **copy-ready prompts** — one per issue — that a human (or any external coding tool) can paste and execute. No in-app agent execution in v1.

This is a **prompt delivery product**, not a coding agent product (yet).

---

## Non-Goals (v1)

- Fix-with-agent / mission orchestration / workers / validators
- One mega-prompt that tries to fix the whole repo
- Competing as a general-purpose long-horizon coding agent
- Wiring the durable prepared-session / execution-queue control plane
- Auto-fixing or auto-merging code inside Aurex
- Replacing dedicated SAST/SCA vendors — we unify signals, not every rule engine

---

## Product Principles

1. **One issue, one prompt** — never bundle unrelated fixes; small scoped changes only
2. **LaPis-grounded context** — every prompt cites indexed evidence: files, graph edges, cycle paths, complexity, imports
3. **Prompt includes the fix direction** — not just “this is broken” but a concrete proposed approach and acceptance checks
4. **Read-only in Aurex** — we scan and write prompts; the user executes elsewhere
5. **Evidence before LLM** — deterministic LaPis + scan data defines the issue; LLM optionally enriches prompt wording, never invents issues
6. **Fast time-to-value** — first prompt list within one prepare + index + scan cycle

---

## User Journey (v1)

```
Connect GitHub → Pick repo → Prepare (clone + LaPis index)
    → Scan: summary, graph, hotspots, supply chain, readiness
    → Issue list (isolated, prioritized P0–P5)
    → User opens one issue → sees full Fix Prompt (context + proposed fix)
    → User copies prompt → pastes into Cursor / Claude / their workflow
```

No missions. No agents. Export all prompts as Markdown optional.

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
| **`issue-isolator.ts`** | Split bundled heuristics into one issue per cycle / file / package / blocker |
| **`fix-prompt-builder.ts`** | Build copy-ready prompt from LaPis context + proposed fix |
| **`POST /api/repos/:repoName/review`** | Index + scan + isolate issues + generate prompts |
| **`GET /api/repos/:repoName/review`** | Fetch latest scan report with all fix prompts |
| **`GET /api/repos/:repoName/graph`** | Repo-level dependency graph for prompt context |
| **`ReviewReport` / `FixPrompt` types** | Shared contracts |
| **Frontend: Issue list + prompt panel** | Select issue → view/copy full fix prompt |

### What we defer entirely (not v1)

| Component | Notes |
|---|---|
| Mission orchestrator, workers, validators | Future phase; do not expose in UI |
| Fix-with-agent button | User copies prompt externally |
| Durable queue / prepared sessions | Remain experimental |
| LLM-generated fix prompts (Phase 1b) | v1 uses template + LaPis context; LLM polishes wording only |

---

## Core Concept: Isolated Issues + Fix Prompts

### One issue, one prompt

Each **Issue** is a single, bounded change a developer can complete in one PR:

| ✅ Good (isolated) | ❌ Bad (bundled) |
|---|---|
| Break cycle `auth → billing → auth` | “Fix all 5 dependency cycles” |
| Refactor `src/payment/handler.ts` (complexity 42) | “Refactor all high-complexity files” |
| Upgrade `lodash@4.17.15` in `package.json` | “Fix all supply-chain findings” |
| Remove dead file `utils/legacy.ts` | “Audit 12 orphan files at once” |

**Splitting rules** (implement in `issue-isolator.ts`):

| Source signal | Split granularity |
|---|---|
| LaPis `cycles.paths[]` | **One issue per cycle path** |
| Hotspots `complexity > 30` | **One issue per file** (already mostly true) |
| Hotspots `complexity 20–30` | **One issue per file** |
| Bumblebee findings | **One issue per package finding** (already true) |
| Dead code orphans | **One issue per file** (change from today’s bundled “audit N files”) |
| Readiness blockers | **One issue per blocker string** |
| Coupling (giant module) | **One issue per module**, scope limited to “identify one extraction seam” |

Today’s `generateSuggestions()` already isolates per-file complexity and per-package security. **Main fix:** split `critical-cycles` into per-cycle issues and `dead-code-scan` into per-file issues.

### LaPis context in every prompt

LaPis is the source of truth for code intelligence. Each fix prompt pulls from:

| LaPis API | Used in prompt for |
|---|---|
| `indexRepo` | Ensure repo is indexed before issue detection |
| `getCodeSummary` | Module layout, entry points, cycle count |
| `getCodeGraph` | Import edges touching affected files, cycle path, neighbor nodes |
| `getCodeHotspots` | Complexity, symbol count, module |
| Settings (`readiness`) | Verify commands: test, lint, typecheck, build |

Reuse `affected-code.ts` pattern: given an issue’s `scopePaths` / `scopeModules`, build a compact scaffold (nodes, edges, hotspots) injected into the prompt — **navigation map, not full file bodies**.

Optional: read file snippets for top-N lines around the issue (bounded, e.g. 40 lines) when repo is on disk — only for single-file issues.

### Fix prompt template (v1 deterministic)

Each issue exposes a **`fixPrompt`** string (Markdown) with this structure:

```markdown
## Issue
[One-line title — e.g. "Break dependency cycle: auth/middleware.ts → billing/hooks.ts → auth/middleware.ts"]

## Problem
[What LaPis/scan detected, with numbers]

## Context (from LaPis index)
- **Affected files:** `path/a.ts`, `path/b.ts`
- **Cycle path:** A → B → C → A  (or: complexity 42, 18 symbols)
- **Import edges:** `a.ts` imports `b.ts` (kind: static)
- **Module:** `packages/backend`
- **Neighbors (high importance):** …

## Proposed fix
[Concrete steps — extract interface, invert dependency, upgrade package, delete unused export, etc.]

## Scope
- **In:** only the files/imports listed above
- **Out:** no unrelated refactors, no API changes unless required for the decoupling

## Verification
Run after applying the fix:
- `pnpm test` (from readiness profile)
- `pnpm typecheck`
- Re-index check: cycle count for this path should be 0 / complexity should drop below 30
```

The **Proposed fix** section is template-driven per category in v1 (like today’s `prefill` but richer). Phase 1b may use PiNyx to refine wording — **must not expand scope**.

### `FixPrompt` type

```typescript
interface IsolatedIssue {
  id: string;
  tier: SuggestionTier;
  category: SuggestionCategory;
  title: string;
  description: string;

  // Isolation bounds — enforce one-small-fix
  scopePaths: string[];       // max ~3 files for v1; split if more needed
  scopeModules: string[];

  evidence: SuggestionEvidence[];
  confidence: SuggestionConfidence;
  estimatedEffort: SuggestionEffort;
  estimatedRisk: SuggestionRisk;

  fixPrompt: string;          // full copy-ready Markdown
  fixPromptVersion: string;   // e.g. "1.0-template"

  status?: "open" | "acknowledged" | "dismissed" | "copied";
}
```

---

## Review Report Structure

A unified artifact: scan results + isolated issues + fix prompts.

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
    issueCounts: Record<SuggestionTier, number>;
    supplyChainSeverity?: BumblebeeScanSummary;
  };

  issues: IsolatedIssue[];    // flat list, sorted tier then category

  architecture: {
    modules: ModuleSummary[];
    cycles: string[][];
    entryPoints: string[];
  };

  readiness: RepoReadinessProfile;
  recommended?: { highestImpact?: string; safestFirst?: string };
}
```

---

## Analysis Layers

### Layer 1 — LaPis + deterministic isolation (ship first)

1. **Index** via `lapis.indexRepo`
2. **Fetch** summary, graph, hotspots, readiness; run Bumblebee if needed
3. **Detect** raw signals (cycles, hotspots, packages, heuristics)
4. **Isolate** via `issue-isolator.ts` — one issue per cycle/file/package/blocker
5. **Build prompt** via `fix-prompt-builder.ts` — template + LaPis scaffold per issue

No LLM required for v1 MVP.

### Layer 2 — LLM prompt polish (Phase 1b, optional)

Adapt `prompt-optimizer.ts` pattern:

- Input: deterministic `fixPrompt` + issue JSON (not whole repo)
- Output: clearer wording, sharper proposed fix steps
- Rules: **same scopePaths, same acceptance criteria, no new issues**
- Fail-safe: return template prompt if PiNyx unavailable

### Layer 3 — In-app agent execution (future, not planned in v1)

Deferred indefinitely until prompt quality and user copy-rate are validated.

---

## Frontend Changes

### Primary view: Issue list + Fix Prompt panel

Evolve `RepoOverviewPanel` → **`RepoScanDashboard`**:

| Area | Behavior |
|---|---|
| **Left: Issue list** | Isolated issues sorted P0→P5; badge per tier; filter by category |
| **Right: Fix Prompt panel** | Full Markdown prompt for selected issue; **Copy prompt** button |
| **Header** | Repo name, file/symbol counts, last scan time, Re-scan |
| **Architecture tab** | Graph, cycles, hotspots (context for prompts, not separate product) |

Primary CTA: **Copy fix prompt** — not Start Mission.

Secondary: Acknowledge, Dismiss, Export all prompts.

### Navigation

- Sidebar: **Repositories** (prepared repos + issue count badge)
- Empty state: “Connect a repo to scan for issues and generate fix prompts”
- Hide mission UI entirely in v1

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
| Time to first issue list after prepare | < 2 min for repos < 5k files |
| Issues are isolated (≤3 scope files each) | 100% |
| Every issue has `fixPrompt` with LaPis context | 100% |
| Copy prompt works | Yes |
| Export all prompts as Markdown | Yes |
| False-positive rate (P0/P1) | Track via dismiss rate |
| Prompt copy rate | Track — leading indicator of value |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Prompts too vague to act on | LaPis scaffold + proposed fix template per category |
| Prompts too large (whole-repo fix) | `issue-isolator` enforces ≤3 files; split cycles per path |
| LLM expands scope in Phase 1b | Constrain LLM to polish wording only; validate scopePaths unchanged |
| Package scan never ran | Auto-run on scan; partial status if fails |
| “Another scanner” | Differentiate on **actionable isolated fix prompts**, not just findings |

---

## Phased Rollout

| Phase | Scope | User-visible outcome |
|---|---|---|
| **1a** | LaPis scan + issue isolation + template fix prompts + copy UI | Select repo → issue list → copy fix prompt |
| **1b** | LLM polish on fix prompts (optional) | Richer proposed fix wording, same scope |
| **Future** | In-app agent / missions | Only if copy-rate validates demand |

---

## Key Files

| Area | Files |
|---|---|
| Isolation | new `packages/backend/src/review/issue-isolator.ts` |
| Prompts | new `packages/backend/src/review/fix-prompt-builder.ts` |
| LaPis context | reuse `packages/backend/src/orchestrator/affected-code.ts` |
| API | `packages/backend/src/routes/repo-explore.ts`, new `review-routes.ts` |
| Orchestration | new `packages/backend/src/review/review-generator.ts` |
| Types | new `packages/shared/src/review.ts` |
| Frontend | `RepoOverviewPanel.tsx` → `RepoScanDashboard.tsx`, `App.tsx`, `api.ts` |

---

## Open Questions

1. **GitHub App vs PAT only for v1?** — Keep existing OAuth; no change required.
2. **Review re-run policy** — Manual “Re-run review” button; no auto-schedule in v1.
3. **PR comment integration** — Defer to Phase 2 (needs GitHub check run or comment API).
4. **Pricing model** — v1 is mostly LaPis + templates (cheap); LLM polish optional
5. **Max scope per issue** — Confirm ≤3 files cap; split further if needed

---

## Related Docs

- [`2026-06-07-repo-auto-explore`](../plans/2026-06-07-repo-auto-explore.md) — prior repo overview work (paths may differ)
- [`docs/AUDIT-dead-incomplete-code.md`](../../AUDIT-dead-incomplete-code.md) — durable queue explicitly deferred
- [`packages/backend/src/routes/repo-explore.ts`](../../../packages/backend/src/routes/repo-explore.ts) — suggestion engine
- [`packages/backend/src/orchestrator/prompt-optimizer.ts`](../../../packages/backend/src/orchestrator/prompt-optimizer.ts) — LLM brief pattern to reuse
