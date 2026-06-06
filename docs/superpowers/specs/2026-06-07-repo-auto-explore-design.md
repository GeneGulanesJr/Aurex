# Repo Auto-Explore + Smart Suggestions

**Date:** 2026-06-07
**Status:** Approved

## Problem

When a user selects a repo in Aurex, it gets cloned but not indexed. The user has no visibility into the repo's structure, health, or what work needs doing. Code indexing only happens during mission-runner startup, after a mission is already created. The repo is a black box until then.

## Solution

When a repo is selected, Aurex automatically clones it, indexes it via LaPis, and presents a three-surface overview:

1. **Enhanced RepoPrepareModal** (Surface A) — progress + summary in the confirmation dialog
2. **RepoOverviewPanel in main view** (Surface B) — full repo map, hotspots, and suggested missions
3. **Compact repo card in sidebar** (Surface C) — quick stats under the mission form

After indexing, Aurex runs static heuristics against LaPis analysis data to generate **actionable mission suggestions** — one-click mission cards the user can launch directly.

---

## Architecture

### Data Flow

```
User clicks repo in RepoPicker
  → RepoPrepareModal opens (3-phase progress)
  → User confirms
  → POST /api/github/repos/prepare (clone)
  → POST /api/repos/:repoName/explore (index)
  → Modal shows final summary → "Use Repo"
  → Sidebar shows compact repo card
  → Main view shows RepoOverviewPanel
     - Repo map (modules, hotspots, structure)
     - Suggested missions (from /api/repos/:repoName/suggestions)
  → User clicks suggestion or types custom description
  → Creates mission (mission-runner skips re-indexing)
```

### Backend Changes

#### 1. Modified prepare endpoint — `POST /api/github/repos/prepare`

Currently returns `{ indexed: false, indexingStatus: "unavailable" }`. After this change, it only clones/fetches (unchanged) and returns the repoName so the frontend can call the explore endpoint next. The prepare response stays focused:

```ts
interface PrepareGitHubRepoResponse {
  fullName: string;
  repoPath: string;
  repoStatus: "cloned" | "updated";
  repoName: string;       // NEW: derived from path, e.g. "GeneGulanesJr-Aurex"
  indexed: boolean;
  indexingStatus: "completed" | "unavailable" | "failed";
}
```

The `indexed` and `indexingStatus` fields remain for backward compatibility but will be `"unavailable"` from prepare. Indexing is a separate explicit step.

#### 2. New explore endpoint — `POST /api/repos/:repoName/explore`

Triggers LaPis indexing for an already-cloned repo. Stores the repo path in a LaPis setting for later lookup.

```ts
// Request
POST /api/repos/:repoName/explore
// Response
{
  repoName: string;
  status: "completed" | "failed";
  summary?: CodeSummaryResponse;   // included immediately if completed
  error?: string;
}
```

Implementation:
- Look up repo path via `lapis.getSetting("repo:<repoName>:path")` (set during prepare)
- Call `lapis.indexRepo(repoPath, repoName)`
- If successful, call `lapis.getCodeSummary(repoName)` and return it
- If indexing fails, return `{ status: "failed", error }` — repo is still usable

#### 3. New repo-scoped routes — `GET /api/repos/:repoName/summary|hotspots|suggestions`

These proxy to LaPis using the stored repo name, without requiring a missionId:

```
GET /api/repos/:repoName/summary
  → lapis.getCodeSummary(repoName)
  → CodeSummaryResponse

GET /api/repos/:repoName/hotspots
  → lapis.getCodeHotspots(repoName)
  → CodeHotspotsResponse

GET /api/repos/:repoName/suggestions
  → calls summary + hotspots
  → applies static heuristics
  → RepoSuggestionsResponse
```

#### 4. New suggestions endpoint — `GET /api/repos/:repoName/suggestions`

Returns synthesized mission suggestions based on code analysis. Calls LaPis analysis endpoints and applies static heuristics (no LLM call — fast and deterministic):

```ts
interface RepoSuggestion {
  id: string;
  category: "test_gaps" | "high_complexity" | "dead_code" | "coupling" | "cycles" | "structure";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  affectedFiles: number;
  detail: string;  // e.g. "14 untested symbols" or "Complexity score: 47"
  prefill: string; // mission description to prefill
}

interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
}
```

**Suggestion heuristics** (all from LaPis data):

| Category | Trigger | Generated Title | Priority |
|---|---|---|---|
| `test_gaps` | Untested symbols found | "Write tests for {module} — {n} untested symbols" | high if > 10 symbols, medium otherwise |
| `high_complexity` | Files with complexity > 20 | "Refactor {file} — complexity score {n}" | high if > 30, medium if > 20 |
| `dead_code` | Dead symbols found | "Remove dead code — {n} unused symbols in {files} files" | medium |
| `coupling` | Files with high fan-in/out | "Decouple {file} from {n} consumers" | medium |
| `cycles` | Dependency cycles > 0 | "Break {n} dependency cycles in {modules}" | high |
| `structure` | Module with > 20 files | "Split {module} ({n} files) into focused packages" | low |

For the initial implementation, suggestions derive from:
- **Summary data**: modules, cycles, entryPoints
- **Hotspot data**: complexity scores per file
- **Dead code / untested**: via new LaPis proxy endpoints (if available) or skipped gracefully

If a LaPis analysis call fails, that suggestion category is simply omitted. No partial failure cascades.

#### 5. Store repo path during prepare

In `github.ts` prepare handler, after cloning:
```ts
// Use the same name mission-runner would derive: path.basename(repoPath)
const repoName = path.basename(prepared.repoPath);
await lapis.setSetting(`repo:${repoName}:path`, prepared.repoPath);
await lapis.setSetting(`repo:${repoName}:fullName`, repo.full_name);
```

This matches the convention in `code-context.ts` and `mission-runner.ts` which both use `path.basename(repoPath)`. The repo-scoped routes resolve the path via this setting.

#### 6. Mission-runner skip re-indexing

In `mission-runner.ts`, before calling `lapis.indexRepo()`:
```ts
// Check if repo is already indexed
const existingRepoName = await lapis.getSetting(`mission:${missionId}:repoName`);
if (existingRepoName) {
  // Already indexed during explore phase — skip
  eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Repo ${existingRepoName} already indexed, skipping…` });
} else {
  // Index as before
  const repoName = path.basename(missionRepoRoot);
  const indexResult = await lapis.indexRepo(missionRepoRoot, repoName);
  // ...
}
```

The repoName is stored as a LaPis setting during the explore phase. The mission-runner also stores `mission:${missionId}:repoName` after indexing. If the setting already exists (from a prior explore), indexing is skipped. If not (user bypassed explore), the existing indexing path runs unchanged.

---

### Frontend Changes

#### 7. Enhanced RepoPrepareModal (Surface A)

Three states shown sequentially in the same modal:

**State 1: Confirm**
```
┌─────────────────────────────────────────┐
│ REPOSITORY SELECTED                     │
│                                         │
│ owner/repo-name                         │
│ Default: main · PUBLIC                  │
│                                         │
│ Aurex will:                             │
│ ○ Clone or update the repository        │
│ ○ Index code for AI context             │
│ ○ Prepare for mission work              │
│                                         │
│ [Cancel]              [Prepare & Scan]  │
└─────────────────────────────────────────┘
```

**State 2: Scanning**
```
┌─────────────────────────────────────────┐
│ PREPARING REPOSITORY                    │
│                                         │
│ owner/repo-name                         │
│                                         │
│ ✓ Repository cloned                     │
│ ◌ Indexing code…                        │
│                                         │
│                              [Cancel]   │
└─────────────────────────────────────────┘
```

**State 3: Complete**
```
┌─────────────────────────────────────────┐
│ REPOSITORY READY ✓                      │
│                                         │
│ owner/repo-name                         │
│                                         │
│ 342 files · 1,891 symbols · 12 modules  │
│ Default: main · Cloned (fresh)          │
│                                         │
│ Top modules: src/orchestrator, src/agent │
│ Entry points: 3 · Cycles: 0             │
│                                         │
│                              [Use Repo] │
└─────────────────────────────────────────┘
```

Props change:
```ts
interface RepoPrepareModalProps {
  repo: GitHubRepoResponse;
  phase: "confirm" | "cloning" | "indexing" | "complete" | "error";
  summary?: CodeSummaryResponse | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}
```

The modal no longer receives `preparing: boolean` — it receives a `phase` enum and optional `summary`.

#### 8. RepoOverviewPanel in main view (Surface B)

New component rendered in `<main>` when no mission is selected but a repo has been prepared. Replaces EmptyState.

```
┌──────────────────────────────────────────────────────────┐
│ REPO MAP                                                │
│ owner/repo-name · 342 files · 1,891 symbols             │
│                                                          │
│ ┌──────────────────┐  ┌──────────────────────────────┐  │
│ │ MODULES          │  │ HOTSPOTS                      │  │
│ │                  │  │                                │  │
│ │ orchestrator  12 │  │ mission-runner.ts    47 ██████│  │
│ │ agents         8 │  │ planner.ts           32 ████  │  │
│ │ routes         7 │  │ negotiator.ts        28 ███   │  │
│ │ enforcement    5 │  │ checkpoint-mgr.ts    21 ██    │  │
│ │ clients        4 │  │ lapis-client.ts      19 ██    │  │
│ │ ws             2 │  │                                │  │
│ │ skills         3 │  │                                │  │
│ └──────────────────┘  └──────────────────────────────┘  │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ STRUCTURE                                           │ │
│ │ Entry Points: server.ts, mission-runner.ts, ...      │ │
│ │ Dependency Cycles: 0 · Edges: 847                    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ SUGGESTED MISSIONS                       BASED ON CODE│ │
│ │                                                      │ │
│ │ 🧪 Write tests for orchestrator — 14 untested sym.. │ │
│ │                                    [Start Mission →] │ │
│ │                                                      │ │
│ │ 🔥 Refactor mission-runner.ts — complexity: 47      │ │
│ │                                    [Start Mission →] │ │
│ │                                                      │ │
│ │ ⚠️ Break 2 dependency cycles                        │ │
│ │                                    [Start Mission →] │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Props:
```ts
interface RepoOverviewPanelProps {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
  hotspots: CodeHotspotsResponse | null;
  suggestions: RepoSuggestion[];
  loading: boolean;
  onStartMission: (prefill: string) => void;
}
```

#### 9. Compact repo card in sidebar (Surface C)

Rendered inside NewMissionForm below the repo picker after a repo is prepared:

```
┌───────────────────────────┐
│ ✓ owner/repo-name         │
│ 342 files · 1,891 symbols │
│ 12 modules · 847 edges    │
│ Status: INDEXED            │
└───────────────────────────┘
```

This is a small inline component — not a separate file. Just a styled `<div>` rendered conditionally in NewMissionForm when `state.selectedRepoFullName` is set.

#### 10. App-level state for prepared repo

New state in App.tsx to track the prepared repo across components:

```ts
interface PreparedRepo {
  repoName: string;
  fullName: string;
  cloneUrl: string;
  repoId: number;
  summary: CodeSummaryResponse | null;
  hotspots: CodeHotspotsResponse | null;
  suggestions: RepoSuggestion[];
  loading: boolean;
}
```

Stored as `useState<PreparedRepo | null>(null)` in App. Passed down to:
- MissionSidebar → NewMissionForm (for compact card)
- StatusBoard → RepoOverviewPanel (for main view)

When a mission is created, the prepared repo state is cleared (repo info is now on the mission).

#### 11. Frontend API additions

```ts
// api.ts
export async function exploreRepo(repoName: string): Promise<ExploreRepoResponse> { ... }
export async function getRepoSummary(repoName: string): Promise<CodeSummaryResponse> { ... }
export async function getRepoHotspots(repoName: string): Promise<CodeHotspotsResponse> { ... }
export async function getRepoSuggestions(repoName: string): Promise<RepoSuggestionsResponse> { ... }
```

#### 12. NewMissionForm flow changes

The form's `handleConfirmRepo` now:
1. Calls `prepareGitHubRepo(cloneUrl)` — get back `{ repoName, fullName }`
2. Sets `preparing` phase to "cloning"
3. Calls `exploreRepo(repoName)` — get back `{ status, summary }`
4. Sets phase to "complete" with summary
5. User clicks "Use Repo" — sets form state + notifies parent

The parent (App) then fetches suggestions for the overview panel.

---

## File Changes Summary

### Backend (new files)
- `packages/backend/src/routes/repo-explore.ts` — new repo-scoped routes

### Backend (modified files)
- `packages/backend/src/routes/github.ts` — store repo path + fullName during prepare
- `packages/backend/src/clients/lapis-client.ts` — no changes needed (existing `indexRepo`, `getCodeSummary`, `getCodeHotspots` suffice)
- `packages/backend/src/orchestrator/mission-runner.ts` — skip indexing if already done

### Frontend (new files)
- `packages/frontend/src/passive/RepoOverviewPanel.tsx` — main view repo map + suggestions

### Frontend (modified files)
- `packages/frontend/src/active/RepoPrepareModal.tsx` — 3-phase progress UI
- `packages/frontend/src/active/NewMissionForm.tsx` — explore flow + compact card
- `packages/frontend/src/api.ts` — new API functions + types
- `packages/frontend/src/App.tsx` — prepared repo state + pass to children

---

## Error Handling

- **LaPis unavailable during explore**: prepare succeeds (clone worked), explore returns `status: "failed"`. Modal shows "Repository ready (code indexing unavailable)". Overview panel shows basic info only, no suggestions.
- **Suggestions endpoint partially fails**: Each suggestion category is independent. If hotspots fail but summary works, complexity suggestions are omitted but test/structure suggestions still appear.
- **Mission-runner double-index guard**: If explore was never called (user created mission directly), mission-runner indexes as before. No behavior change for the non-explore path.

## Testing

- Unit tests for `repo-explore.ts` suggestion heuristics (deterministic, no LLM)
- Unit tests for modified `RepoPrepareModal` phase transitions
- Integration test: full flow from repo selection → explore → suggestion → mission creation
- Integration test: mission-runner skip when repo already indexed
