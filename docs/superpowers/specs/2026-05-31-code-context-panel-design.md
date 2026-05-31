# Code Context Panel — Design Spec

**Date:** 2026-05-31
**Status:** Draft
**Depends on:** LaPis code-index HTTP endpoints (`POST /code/index`, `GET /code/health/:repo`)

## Overview

After LaPis indexes a repo, show the user what was found before planning begins. A collapsible panel inside MissionPipeline that displays three sections: Architecture Summary, Dependency Graph, and Hotspot Heatmap. All animated with anime.js. Auto-collapses when the first milestone appears.

## UX Flow

```
mission starts
  → repo prepared
  → "Indexing repo Aurex for code context…" (existing log)
  → indexing completes
  → CODE CONTEXT panel animates in
     │  Architecture Summary  (text blurb)
     │  Dependency Graph      (animated SVG)
     │  Hotspot Heatmap       (colored blocks)
  → planner streams milestone titles
  → FIRST milestone created
  → CODE CONTEXT auto-collapses to one-liner
  → "▸ Code Context (125 files, 1820 symbols)"
     (click to re-expand anytime)
```

## Location

Inside `MissionPipeline.tsx`, between the mission header bar and the milestone rail. Replaces the "Planning milestones…" spinner during the indexing + planning phase.

## Sections

### 1. Architecture Summary

A text blurb with key stats. Monospace, label-value pairs.

```
125 files · 1820 symbols · 713 import edges
Modules: backend, frontend, shared
Entry points: server.ts, App.tsx
Cycles: 2 detected (clients → routes → clients)
```

**Data source:** New `GET /code/summary/:repo` endpoint returns:
- `files`, `symbols`, `edges` counts
- `modules` — directory grouping of files (monorepo-aware: uses `packages/` children, or `src/` children, or top-level dirs)
- `entryPoints` — files with highest afferent coupling (most imported-by count)
- `cycles` — count + top cycle path (shortest cycle found)

### 2. Dependency Graph

Animated SVG rendered with anime.js. Read-only — no drag, zoom, or click.

**Layout algorithm:** Simple layered layout computed at render time:
1. Detect module grouping — if monorepo (has `packages/`, `apps/`, `libs/`), use second-level directory name (e.g. `packages/backend` → `backend`). Otherwise use top-level `src/` children.
2. Arrange modules as columns (120px wide, 40px gap between columns)
3. Place files as nodes within columns (sorted by importance descending, 40px vertical gap per node)
4. Draw edges as quadratic bezier SVG paths between node centers. Curve offset = ±20px to reduce overlap; direction alternates to spread parallel edges.

**Node encoding:**
- Size: proportional to symbol count (small/medium/large)
- Color: importance score gradient from `--text-muted` (low) to `--accent` (high)
- Border: `--border` default, `--error` glow for hotspot files

**Edge encoding:**
- Stroke: `--border` with low opacity
- Animated: SVG dash-offset animation (anime.js) — edges "draw" themselves
- Direction: slight curve so overlapping edges are distinguishable

**Animation sequence (anime.js):**
1. Nodes stagger in by module group (delay 80ms per group)
2. Edges draw after all nodes visible (dash-offset 0→length, 600ms)
3. Hotspot nodes pulse glow (continuous, `createPulse`)
4. Cycle edges flash `--error` color (continuous subtle blink)

**Data source:** New `GET /code/graph/:repo` endpoint returns:
```json
{
  "nodes": [
    { "id": "server.ts", "module": "backend", "symbols": 45, "importance": 0.92 }
  ],
  "edges": [
    { "from": "server.ts", "to": "routes/missions.ts", "kind": "import" }
  ],
  "cycles": [
    ["clients/lapis-client.ts", "routes/missions.ts", "clients/lapis-client.ts"]
  ]
}
```

**Scale limit:** Cap at 50 nodes (top by importance). Files beyond the cap are grouped into a single "other" node per module (e.g. "23 more files"). Edges to/from aggregated files are **dropped** — the "other" node is a dead-end indicator, not a connected node.

### 3. Hotspot Heatmap

Grid of colored blocks. Each block = one file. Rows = modules. Color intensity = complexity score.

**Layout:**
```
backend/
  ████████████ server.ts      42
  ██████████   planner.ts     38
  ██████       missions.ts    24
frontend/
  ████████     App.tsx        31
  █████        StatusBoard    19
shared/
  ███          types.ts       12
```

**Encoding:**
- Block width: proportional to complexity score (normalized to max)
- Color: gradient from `--bg-elevated` (low) through `--accent-dim` (mid) to `--accent` (high)
- Number: complexity score right-aligned
- Font: mono-value token (JetBrains Mono 11px)

**Data source:** New `GET /code/hotspots/:repo` endpoint returns:
```json
{
  "files": [
    { "path": "src/server.ts", "module": "backend", "complexity": 42, "symbols": 45 },
    { "path": "src/planner.ts", "module": "backend", "complexity": 38, "symbols": 22 }
  ]
}
```

**Scale limit:** Top 20 files by complexity. Max 5 per module row.

## Auto-Collapse Behavior

- Panel starts expanded when indexing completes
- Collapses (animated, 300ms) when `milestones.length` goes from 0 to 1
- Collapsed state shows one-liner: `▸ Code Context (125 files, 1820 symbols)` in `--text-muted` mono
- Click to re-expand (toggles)
- Re-expanding replays the entrance animations

## Backend Changes

### New LaPis Endpoints

Three new routes in `src/http/handlers/code-index.js`:

1. `GET /code/summary/:repo` — architecture summary
2. `GET /code/graph/:repo` — dependency graph nodes + edges
3. `GET /code/hotspots/:repo` — top files by complexity

Each queries the existing LaPis SQLite tables (`code_repos`, `code_files`, `code_symbols`, `code_edges`).

### Aurex Backend Proxy

New route in `packages/backend/src/routes/lapis.ts`:
- `GET /api/missions/:missionId/code/summary` — looks up repo name from mission's indexed repo record, proxies to LaPis
- `GET /api/missions/:missionId/code/graph` — same
- `GET /api/missions/:missionId/code/hotspots` — same

The mission runner stores the indexed repo name in the mission's `configJson.repoName` field after indexing completes. The proxy route reads this to know which LaPis repo to query.

### Aurex Frontend

- `packages/frontend/src/api.ts` — three new fetch calls
- `packages/frontend/src/passive/CodeContextPanel.tsx` — new component with three sub-components:
  - `ArchitectureSummary`
  - `DependencyGraph`
  - `HotspotHeatmap`
- `MissionPipeline.tsx` — integrates CodeContextPanel, passes indexing result and collapse trigger

### WS Events

The mission runner already emits `mission_log` events during indexing. The frontend uses these to know when indexing is complete:

**Indexing started:**
```
{ type: "mission_log", missionId, phase: "indexing", message: "Indexing repo Aurex for code context…" }
```

**Indexing complete:**
```
{ type: "mission_log", missionId, phase: "indexing", message: "Indexed 125 files, 1820 symbols", data: { indexingDone: true, files: 125, symbols: 1820, edges: 713 } }
```

The `data.indexingDone: true` field is the signal — when the frontend sees this, it sets `showContextPanel = true` to mount the panel. The panel's `useEffect` then fires three REST calls in parallel:
- `GET /api/missions/:missionId/code/summary` → Architecture Summary
- `GET /api/missions/:missionId/code/graph` → Dependency Graph
- `GET /api/missions/:missionId/code/hotspots` → Hotspot Heatmap

All three sections show loading skeletons until their data arrives. The WS `data` counts are **not used** for rendering — the REST endpoint is the single source of truth. The WS event is purely a trigger.

**Indexing failed:** No `indexingDone` field. Panel does not render. The log entry is the only indication.

## Animation Tokens

All animations use anime.js v4 and respect the DESIGN.md motion guidelines:

| Animation | Duration | Easing | Trigger |
|---|---|---|---|
| Panel slide-in | 400ms | outExpo | Indexing complete |
| Summary text fade | 300ms | outExpo | Panel visible |
| Graph nodes stagger | 80ms delay | outExpo | Summary visible |
| Graph edges draw | 600ms | linear | Nodes complete |
| Hotspot glow pulse | continuous | inOutSine | Always |
| Cycle edge blink | continuous | inOutSine | Always |
| Heatmap blocks stagger | 50ms delay | outExpo | Graph complete |
| Collapse | 300ms | inOutQuad | First milestone |
| Expand | 300ms | outExpo | User click |

## Files to Create/Modify

| File | Action |
|---|---|
| `LaPis/src/http/handlers/code-index.js` | Add 3 GET endpoints |
| `LaPis/src/http/server.js` | Register 3 new routes |
| `Aurex/packages/backend/src/routes/lapis.ts` | New proxy routes |
| `Aurex/packages/backend/src/server.ts` | Register lapis routes |
| `Aurex/packages/backend/src/orchestrator/mission-runner.ts` | Store repo name in mission configJson after indexing |
| `Aurex/packages/frontend/src/api.ts` | 3 new fetch calls |
| `Aurex/packages/frontend/src/passive/CodeContextPanel.tsx` | New component |
| `Aurex/packages/frontend/src/passive/MissionPipeline.tsx` | Integrate panel |
| `Aurex/packages/shared/src/events.ts` | Extend mission_log data field |

## Error States

- **Indexing fails** (LaPis down, path error): Panel does not render. Log shows the error message. Mission continues to planning without code context.
- **Graph/hotspot fetch fails**: Section shows "Unavailable" in `--text-muted`. Other sections still render.
- **Empty repo** (0 code files): Panel renders with "No code files found" message instead of graph/heatmap. Architecture summary shows all zeros.

## Out of Scope

- File-level code viewing (use LaPis source retrieval directly, not in this panel)
- Interactive graph manipulation
- Search/filter within the graph
- Cross-mission code comparison
- Real-time graph updates during execution
