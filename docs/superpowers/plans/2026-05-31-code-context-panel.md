# Code Context Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a collapsible Code Context panel inside MissionPipeline after LaPis indexing, displaying architecture summary, dependency graph (anime.js SVG), and hotspot heatmap.

**Architecture:** Three new LaPis GET endpoints query existing SQLite tables. Aurex backend proxies them. Frontend component fetches on panel mount, animates with anime.js v4, auto-collapses when first milestone appears.

**Tech Stack:** LaPis (Node.js/SQLite), Aurex backend (Fastify/TypeScript), Aurex frontend (React/anime.js v4), SVG for graph rendering.

---

## Task 1: LaPis `GET /code/summary/:repo` Endpoint

**Files:**
- Modify: `LaPis/src/http/handlers/code-index.js`
- Modify: `LaPis/src/http/server.js`

- [ ] **Step 1: Add the summary handler to code-index.js**

Append to the existing `module.exports` in `LaPis/src/http/handlers/code-index.js`:

```javascript
function codeRepoSummary(deps) {
  return async (req, res, { params }) => {
    const { repo } = params;
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo is required' }));
    }
    const db = getDb();

    // Repo stats
    const repoRow = db.prepare('SELECT id, file_count, symbol_count FROM code_repos WHERE name = ?').get(repo);
    if (!repoRow) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo not found' }));
    }

    // Edge count (import relationships)
    const edgeRow = db.prepare('SELECT COUNT(*) as count FROM code_imports WHERE repo_id = ? AND target_file_id IS NOT NULL').get(repoRow.id);

    // Module grouping: detect monorepo (packages/) or src/ children or top-level dirs
    const fileRows = db.prepare('SELECT path FROM code_files WHERE repo_id = ?').all(repoRow.id);
    const modules = new Map();
    for (const f of fileRows) {
      const parts = f.path.split('/');
      let mod;
      if (parts[0] === 'packages' && parts.length > 1) {
        mod = parts[1]; // packages/backend -> backend
      } else if (parts[0] === 'src' && parts.length > 1) {
        mod = parts[1]; // src/server -> server
      } else if (parts[0] === 'apps' && parts.length > 1) {
        mod = parts[1];
      } else if (parts[0] === 'libs' && parts.length > 1) {
        mod = parts[1];
      } else {
        mod = parts[0] || 'root';
      }
      modules.set(mod, (modules.get(mod) || 0) + 1);
    }
    const moduleList = [...modules.entries()]
      .map(([name, fileCount]) => ({ name, fileCount }))
      .sort((a, b) => b.fileCount - a.fileCount);

    // Entry points: files with most importers (afferent coupling)
    const entryRows = db.prepare(`
      SELECT cf.path, COUNT(DISTINCT ci.source_file_id) as importer_count
      FROM code_imports ci
      JOIN code_files cf ON cf.id = ci.target_file_id
      WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
      GROUP BY ci.target_file_id
      ORDER BY importer_count DESC
      LIMIT 5
    `).all(repoRow.id);
    const entryPoints = entryRows.map(r => r.path.split('/').pop());

    // Cycles: find shortest cycle via scope_resolution (simplified — check file_scope_bindings self-references)
    // For now, return 0 cycles. Full cycle detection is expensive; can be enhanced later.
    const cycles = [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      files: repoRow.file_count,
      symbols: repoRow.symbol_count,
      edges: edgeRow.count,
      modules: moduleList,
      entryPoints,
      cycles: { count: cycles.length, paths: cycles },
    }));
  };
}
```

Add to `module.exports`:
```javascript
module.exports = { indexRepo, reindexRepo, codeRepoHealthHandler, codeRepoSummary };
```

- [ ] **Step 2: Register the route in server.js**

In `LaPis/src/http/server.js`, add to the code indexing route block:

```javascript
{ method: 'GET', pattern: '/code/summary/:repo', handler: codeIndex.codeRepoSummary(deps) },
```

- [ ] **Step 3: Rebuild LaPis and test**

Run:
```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
docker compose build --no-cache lapis && docker compose up -d lapis
sleep 5
curl -s http://localhost:9100/code/summary/aurex | jq .
```

Expected: JSON with `files`, `symbols`, `edges`, `modules` array, `entryPoints` array.

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add -A
git commit -m "feat: GET /code/summary/:repo endpoint"
git push origin main
```

---

## Task 2: LaPis `GET /code/graph/:repo` Endpoint

**Files:**
- Modify: `LaPis/src/http/handlers/code-index.js`
- Modify: `LaPis/src/http/server.js`

- [ ] **Step 1: Add the graph handler**

Append to `LaPis/src/http/handlers/code-index.js`:

```javascript
function codeRepoGraph(deps) {
  return async (req, res, { params }) => {
    const { repo } = params;
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo is required' }));
    }
    const db = getDb();

    const repoRow = db.prepare('SELECT id FROM code_repos WHERE name = ?').get(repo);
    if (!repoRow) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo not found' }));
    }

    // Get top 50 files by symbol count (proxy for importance)
    const fileRows = db.prepare(`
      SELECT cf.id, cf.path, COUNT(cs.id) as symbol_count
      FROM code_files cf
      LEFT JOIN code_symbols cs ON cs.file_id = cf.id
      WHERE cf.repo_id = ?
      GROUP BY cf.id
      ORDER BY symbol_count DESC
      LIMIT 50
    `).all(repoRow.id);

    const fileIds = new Set(fileRows.map(f => f.id));

    // Module grouping (same logic as summary)
    const nodes = fileRows.map(f => {
      const parts = f.path.split('/');
      let mod;
      if (parts[0] === 'packages' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'src' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'apps' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'libs' && parts.length > 1) mod = parts[1];
      else mod = parts[0] || 'root';
      return {
        id: f.path.split('/').pop(),
        fullPath: f.path,
        module: mod,
        symbols: f.symbol_count,
        importance: Math.min(1, f.symbol_count / 50), // normalize to 0-1
      };
    });

    // Get import edges between the top files
    const edgeRows = db.prepare(`
      SELECT sf.path as from_path, tf.path as to_path
      FROM code_imports ci
      JOIN code_files sf ON sf.id = ci.source_file_id
      JOIN code_files tf ON tf.id = ci.target_file_id
      WHERE ci.repo_id = ? AND ci.target_file_id IS NOT NULL
        AND ci.source_file_id IN (${fileIds.size > 0 ? fileIds.join(',') : '0'})
        AND ci.target_file_id IN (${fileIds.size > 0 ? fileIds.join(',') : '0'})
    `).all(repoRow.id);

    const nodePaths = new Set(nodes.map(n => n.fullPath));
    const edges = edgeRows
      .filter(e => nodePaths.has(e.from_path) && nodePaths.has(e.to_path))
      .map(e => ({
        from: e.from_path.split('/').pop(),
        to: e.to_path.split('/').pop(),
        kind: 'import',
      }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ nodes, edges, cycles: [] }));
  };
}
```

Add to `module.exports`:
```javascript
module.exports = { indexRepo, reindexRepo, codeRepoHealthHandler, codeRepoSummary, codeRepoGraph };
```

- [ ] **Step 2: Register the route**

In `LaPis/src/http/server.js`:
```javascript
{ method: 'GET', pattern: '/code/graph/:repo', handler: codeIndex.codeRepoGraph(deps) },
```

- [ ] **Step 3: Rebuild and test**

```bash
docker compose build --no-cache lapis && docker compose up -d lapis
sleep 5
curl -s http://localhost:9100/code/graph/aurex | jq '.nodes | length'
```

Expected: up to 50 nodes.

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add -A
git commit -m "feat: GET /code/graph/:repo endpoint"
git push origin main
```

---

## Task 3: LaPis `GET /code/hotspots/:repo` Endpoint

**Files:**
- Modify: `LaPis/src/http/handlers/code-index.js`
- Modify: `LaPis/src/http/server.js`

- [ ] **Step 1: Add the hotspots handler**

Append to `LaPis/src/http/handlers/code-index.js`:

```javascript
function codeRepoHotspots(deps) {
  return async (req, res, { params }) => {
    const { repo } = params;
    if (!repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo is required' }));
    }
    const db = getDb();

    const repoRow = db.prepare('SELECT id FROM code_repos WHERE name = ?').get(repo);
    if (!repoRow) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'repo not found' }));
    }

    // Aggregate cyclomatic complexity per file
    const fileRows = db.prepare(`
      SELECT cf.path, SUM(sc.cyclomatic) as complexity, COUNT(cs.id) as symbols
      FROM code_files cf
      JOIN code_symbols cs ON cs.file_id = cf.id
      JOIN symbol_complexity sc ON sc.symbol_id = cs.id
      WHERE cf.repo_id = ?
      GROUP BY cf.id
      ORDER BY complexity DESC
      LIMIT 20
    `).all(repoRow.id);

    const files = fileRows.map(f => {
      const parts = f.path.split('/');
      let mod;
      if (parts[0] === 'packages' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'src' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'apps' && parts.length > 1) mod = parts[1];
      else if (parts[0] === 'libs' && parts.length > 1) mod = parts[1];
      else mod = parts[0] || 'root';
      return {
        path: f.path,
        module: mod,
        complexity: f.complexity || 0,
        symbols: f.symbols || 0,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files }));
  };
}
```

Add to `module.exports`:
```javascript
module.exports = { indexRepo, reindexRepo, codeRepoHealthHandler, codeRepoSummary, codeRepoGraph, codeRepoHotspots };
```

- [ ] **Step 2: Register the route**

```javascript
{ method: 'GET', pattern: '/code/hotspots/:repo', handler: codeIndex.codeRepoHotspots(deps) },
```

- [ ] **Step 3: Rebuild and test**

```bash
docker compose build --no-cache lapis && docker compose up -d lapis
sleep 5
curl -s http://localhost:9100/code/hotspots/aurex | jq '.files | length'
```

Expected: up to 20 files with complexity scores.

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/LaPis
git add -A
git commit -m "feat: GET /code/hotspots/:repo endpoint"
git push origin main
```

---

## Task 4: Extend `mission_log` WS Event with Indexing Data

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`
- Modify: `packages/frontend/src/hooks/useMission.ts`

- [ ] **Step 1: Update the mission_log event type to carry optional data**

In `packages/shared/src/events.ts`, change:

```typescript
  | { type: "mission_log"; missionId: string; phase: string; message: string };
```

To:

```typescript
  | { type: "mission_log"; missionId: string; phase: string; message: string; data?: Record<string, unknown> };
```

- [ ] **Step 2: Update the mission runner to emit indexingDone data**

In `packages/backend/src/orchestrator/mission-runner.ts`, change the success case:

```typescript
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexed ${indexResult.files ?? 0} files, ${indexResult.symbols ?? 0} symbols` });
```

To:

```typescript
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexed ${indexResult.files ?? 0} files, ${indexResult.symbols ?? 0} symbols`, data: { indexingDone: true, files: indexResult.files ?? 0, symbols: indexResult.symbols ?? 0, edges: indexResult.import_edges ?? 0 } });
```

- [ ] **Step 3: Update useMission reducer to preserve data on logs**

In `packages/frontend/src/hooks/useMission.ts`, change:

```typescript
interface MissionState {
  ...
  logs: Array<{ phase: string; message: string; timestamp: number }>;
}
```

To:

```typescript
interface MissionState {
  ...
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
}
```

Update the `MISSION_LOG` action type:

```typescript
  | { type: "MISSION_LOG"; phase: string; message: string; data?: Record<string, unknown> };
```

Update the reducer case:

```typescript
    case "MISSION_LOG": {
      const log = { phase: action.phase, message: action.message, timestamp: Date.now(), data: action.data };
      return { ...state, logs: [...state.logs.slice(-49), log] };
    }
```

Update the WS handler to pass data:

```typescript
      case "mission_log":
        dispatch({ type: "MISSION_LOG", phase: event.phase, message: event.message, data: event.data });
        break;
```

- [ ] **Step 4: Run tests**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
npx vitest run
```

Expected: All 322 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: extend mission_log event with data field for indexingDone signal"
```

---

## Task 5: Aurex Backend Proxy Routes for Code Context

**Files:**
- Create: `packages/backend/src/routes/code-context.ts`
- Modify: `packages/backend/src/server.ts`

- [ ] **Step 1: Create the proxy route file**

Create `packages/backend/src/routes/code-context.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface CodeContextDeps {
  lapis: LaPisClient;
}

export function registerCodeContextRoutes(app: FastifyInstance, deps: CodeContextDeps) {
  const { lapis } = deps;

  // Proxy code summary from LaPis
  app.get("/api/missions/:missionId/code/summary", async (req) => {
    const { missionId } = req.params as { missionId: string };
    // Get the mission to find the repoName
    const mission = await lapis.getMission(missionId);
    const repoName = mission.configJson?.repoName;
    if (!repoName) {
      return { files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } };
    }
    return lapis.getCodeSummary(repoName);
  });

  // Proxy dependency graph from LaPis
  app.get("/api/missions/:missionId/code/graph", async (req) => {
    const { missionId } = req.params as { missionId: string };
    const mission = await lapis.getMission(missionId);
    const repoName = mission.configJson?.repoName;
    if (!repoName) {
      return { nodes: [], edges: [], cycles: [] };
    }
    return lapis.getCodeGraph(repoName);
  });

  // Proxy hotspots from LaPis
  app.get("/api/missions/:missionId/code/hotspots", async (req) => {
    const { missionId } = req.params as { missionId: string };
    const mission = await lapis.getMission(missionId);
    const repoName = mission.configJson?.repoName;
    if (!repoName) {
      return { files: [] };
    }
    return lapis.getCodeHotspots(repoName);
  });
}
```

- [ ] **Step 2: Add client methods to LaPisClient**

In `packages/backend/src/clients/lapis-client.ts`, add to the interface:

```typescript
  // Code context
  getCodeSummary(repo: string): Promise<{ files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; entryPoints: string[]; cycles: { count: number; paths: string[][] } }>;
  getCodeGraph(repo: string): Promise<{ nodes: Array<{ id: string; module: string; symbols: number; importance: number }>; edges: Array<{ from: string; to: string; kind: string }>; cycles: string[][] }>;
  getCodeHotspots(repo: string): Promise<{ files: Array<{ path: string; module: string; complexity: number; symbols: number }> }>;
```

Add implementations in the factory:

```typescript
    getCodeSummary(repo) {
      return get(`/code/summary/${encodeURIComponent(repo)}`);
    },
    getCodeGraph(repo) {
      return get(`/code/graph/${encodeURIComponent(repo)}`);
    },
    getCodeHotspots(repo) {
      return get(`/code/hotspots/${encodeURIComponent(repo)}`);
    },
```

- [ ] **Step 3: Store repoName in LaPis settings after indexing**

In the mission runner's indexing success block, after the "Indexed…" log emit, add:

```typescript
        // Store repo name for code context proxy
        await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
```

The proxy route in this file reads it with:
```typescript
    const repoName = await lapis.getSetting(`mission:${missionId}:repoName`) as string | null;
```

- [ ] **Step 4: Register routes in server.ts**

In `packages/backend/src/server.ts`, add the import and registration:

```typescript
import { registerCodeContextRoutes } from "./routes/code-context.js";
```

After the GitHub routes registration:

```typescript
  registerCodeContextRoutes(app, { lapis });
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: backend proxy routes for code context (summary, graph, hotspots)"
```

---

## Task 6: Frontend API Functions

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Add the three fetch functions**

In `packages/frontend/src/api.ts`, append:

```typescript
// Code Context
export async function getCodeSummary(missionId: string) {
  const res = await apiFetch(`/api/missions/${missionId}/code/summary`);
  return res.json();
}

export async function getCodeGraph(missionId: string) {
  const res = await apiFetch(`/api/missions/${missionId}/code/graph`);
  return res.json();
}

export async function getCodeHotspots(missionId: string) {
  const res = await apiFetch(`/api/missions/${missionId}/code/hotspots`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: frontend API functions for code context"
```

---

## Task 7: Architecture Summary Component

**Files:**
- Create: `packages/frontend/src/passive/ArchitectureSummary.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/passive/ArchitectureSummary.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { animate } from "animejs";

interface SummaryData {
  files: number;
  symbols: number;
  edges: number;
  modules: Array<{ name: string; fileCount: number }>;
  entryPoints: string[];
  cycles: { count: number; paths: string[][] };
}

export function ArchitectureSummary({ data }: { data: SummaryData | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;
    animate(el.querySelectorAll(".summary-line"), {
      opacity: [0, 1],
      translateY: [8, 0],
      delay: (_el: Element, i: number) => i * 80,
      duration: 400,
      ease: "outExpo",
    });
  }, [data]);

  if (!data) {
    return (
      <div style={{ padding: "12px 0" }}>
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div ref={ref} style={{ padding: "12px 0" }}>
      <div className="summary-line" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        {data.files} files · {data.symbols} symbols · {data.edges} import edges
      </div>
      <div className="summary-line" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        Modules: {data.modules.map(m => m.name).join(", ")}
      </div>
      <div className="summary-line" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        Entry points: {data.entryPoints.join(", ") || "none detected"}
      </div>
      {data.cycles.count > 0 && (
        <div className="summary-line" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--warning)", lineHeight: 1.8 }}>
          Cycles: {data.cycles.count} detected
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {[80, 60, 45].map((w, i) => (
        <div key={i} style={{ width: `${w}%`, height: "14px", background: "var(--bg-elevated)", borderRadius: "3px" }} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: ArchitectureSummary component with anime.js stagger"
```

---

## Task 8: Dependency Graph Component

**Files:**
- Create: `packages/frontend/src/passive/DependencyGraph.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/passive/DependencyGraph.tsx`:

```tsx
import { useEffect, useRef, useMemo } from "react";
import { animate, stagger } from "animejs";
import { createPulse } from "../animations/agent-animations";

interface GraphNode {
  id: string;
  module: string;
  symbols: number;
  importance: number;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
}

const COL_WIDTH = 120;
const COL_GAP = 40;
const ROW_HEIGHT = 40;
const NODE_RADIUS_MIN = 6;
const NODE_RADIUS_MAX = 14;
const SVG_PADDING = 20;

export function DependencyGraph({ data }: { data: GraphData | null }) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Compute layout
  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;

    // Group nodes by module
    const moduleMap = new Map<string, GraphNode[]>();
    for (const node of data.nodes) {
      const list = moduleMap.get(node.module) || [];
      list.push(node);
      moduleMap.set(node.module, list);
    }
    const modules = [...moduleMap.keys()];

    // Position: module = column, sorted by importance within column
    const positions = new Map<string, { x: number; y: number; r: number }>();
    let maxColHeight = 0;

    modules.forEach((mod, colIdx) => {
      const nodes = moduleMap.get(mod)!.sort((a, b) => b.importance - a.importance);
      nodes.forEach((node, rowIdx) => {
        const x = SVG_PADDING + colIdx * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2;
        const y = SVG_PADDING + rowIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
        const r = NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * node.importance;
        positions.set(node.id, { x, y, r });
        maxColHeight = Math.max(maxColHeight, y + ROW_HEIGHT / 2);
      });
    });

    const svgWidth = SVG_PADDING * 2 + modules.length * COL_WIDTH + (modules.length - 1) * COL_GAP;
    const svgHeight = SVG_PADDING * 2 + maxColHeight;

    return { positions, modules, svgWidth, svgHeight };
  }, [data]);

  // Animate nodes then edges
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout || !data) return;

    // Animate nodes: stagger by module
    const nodes = svg.querySelectorAll<SVGElement>(".graph-node");
    animate(nodes, {
      opacity: [0, 1],
      scale: [0.6, 1],
      delay: stagger(80),
      duration: 500,
      ease: "outExpo",
      onComplete: () => {
        // Then animate edges: draw via dash-offset
        const edges = svg.querySelectorAll<SVGElement>(".graph-edge");
        animate(edges, {
          strokeDashoffset: [(_el: SVGElement) => {
            const len = _el.getTotalLength ? _el.getTotalLength() : 200;
            _el.setAttribute("stroke-dasharray", `${len}`);
            return len;
          }, 0],
          duration: 600,
          delay: stagger(15),
          ease: "linear",
        });
      },
    });
  }, [data, layout]);

  if (!data || !layout) {
    return (
      <div style={{ padding: "12px 0" }}>
        <GraphSkeleton />
      </div>
    );
  }

  if (data.nodes.length === 0) {
    return <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>No files to graph</div>;
  }

  const nodeIds = new Set(data.nodes.map(n => n.id));
  const cycleEdges = new Set(
    data.cycles.flatMap(cycle => {
      const edges: string[] = [];
      for (let i = 0; i < cycle.length - 1; i++) edges.push(`${cycle[i]}→${cycle[i + 1]}`);
      return edges;
    })
  );

  return (
    <div style={{ padding: "12px 0" }}>
      <svg
        ref={svgRef}
        width={layout.svgWidth}
        height={layout.svgHeight}
        viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}
        style={{ display: "block", maxWidth: "100%" }}
      >
        {/* Module labels */}
        {layout.modules.map((mod, i) => (
          <text
            key={mod}
            x={SVG_PADDING + i * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2}
            y={12}
            textAnchor="middle"
            fill="var(--text-muted)"
            style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase" }}
          >
            {mod}
          </text>
        ))}

        {/* Edges */}
        {data.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)).map((edge, i) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2 + (i % 2 === 0 ? 20 : -20);
          const isCycle = cycleEdges.has(`${edge.from}→${edge.to}`);
          return (
            <path
              key={`e-${i}`}
              className="graph-edge"
              d={`M${from.x},${from.y} Q${midX},${(from.y + to.y) / 2} ${to.x},${to.y}`}
              fill="none"
              stroke={isCycle ? "var(--error)" : "var(--border)"}
              strokeWidth={isCycle ? 1.5 : 1}
              opacity={isCycle ? 0.8 : 0.4}
            />
          );
        })}

        {/* Nodes */}
        {data.nodes.map(node => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const importanceColor = node.importance > 0.7 ? "var(--accent)" : node.importance > 0.4 ? "var(--accent-dim)" : "var(--text-muted)";
          return (
            <g key={node.id} className="graph-node" opacity={0}>
              <circle cx={pos.x} cy={pos.y} r={pos.r} fill={importanceColor} stroke="var(--border)" strokeWidth={1} />
              <text x={pos.x} y={pos.y + pos.r + 10} textAnchor="middle" fill="var(--text-secondary)" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "8px" }}>
                {node.id.length > 14 ? node.id.slice(0, 12) + "…" : node.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div style={{ height: "120px", background: "var(--bg-elevated)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", letterSpacing: "2px" }}>LOADING GRAPH…</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: DependencyGraph component with anime.js SVG animations"
```

---

## Task 9: Hotspot Heatmap Component

**Files:**
- Create: `packages/frontend/src/passive/HotspotHeatmap.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/passive/HotspotHeatmap.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";

interface HotspotFile {
  path: string;
  module: string;
  complexity: number;
  symbols: number;
}

interface HotspotData {
  files: HotspotFile[];
}

export function HotspotHeatmap({ data }: { data: HotspotData | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data || data.files.length === 0) return;
    animate(el.querySelectorAll<HTMLElement>(".hotspot-row"), {
      opacity: [0, 1],
      translateX: [-12, 0],
      delay: stagger(50),
      duration: 400,
      ease: "outExpo",
    });
  }, [data]);

  if (!data) {
    return (
      <div style={{ padding: "12px 0" }}>
        <HeatmapSkeleton />
      </div>
    );
  }

  if (data.files.length === 0) {
    return <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>No complexity data available</div>;
  }

  const maxComplexity = Math.max(...data.files.map(f => f.complexity), 1);

  // Group by module, max 5 per module
  const grouped = new Map<string, HotspotFile[]>();
  for (const f of data.files) {
    const list = grouped.get(f.module) || [];
    if (list.length < 5) list.push(f);
    grouped.set(f.module, list);
  }

  return (
    <div ref={ref} style={{ padding: "12px 0" }}>
      {[...grouped.entries()].map(([mod, files]) => (
        <div key={mod} style={{ marginBottom: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
            {mod}
          </div>
          {files.map(f => {
            const ratio = f.complexity / maxComplexity;
            const color = ratio > 0.7 ? "var(--accent)" : ratio > 0.4 ? "var(--accent-dim)" : "var(--bg-elevated)";
            return (
              <div key={f.path} className="hotspot-row" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", opacity: 0 }}>
                <div style={{ width: `${Math.max(4, ratio * 120)}px`, height: "12px", background: color, borderRadius: "2px", transition: "width 0.3s" }} />
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.path.split("/").pop()}
                </span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", minWidth: "28px", textAlign: "right" }}>
                  {f.complexity}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {[100, 80, 60, 45, 30].map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: `${w}px`, height: "12px", background: "var(--bg-elevated)", borderRadius: "2px" }} />
          <div style={{ width: "60px", height: "12px", background: "var(--bg-elevated)", borderRadius: "2px" }} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: HotspotHeatmap component with anime.js stagger"
```

---

## Task 10: CodeContextPanel Container Component

**Files:**
- Create: `packages/frontend/src/passive/CodeContextPanel.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/passive/CodeContextPanel.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import { animate } from "animejs";
import { getCodeSummary, getCodeGraph, getCodeHotspots } from "../api";
import { ArchitectureSummary } from "./ArchitectureSummary";
import { DependencyGraph } from "./DependencyGraph";
import { HotspotHeatmap } from "./HotspotHeatmap";

interface CodeContextPanelProps {
  missionId: string;
  indexingDone: boolean;
  filesCount: number;
  symbolsCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function CodeContextPanel({ missionId, indexingDone, filesCount, symbolsCount, collapsed, onToggleCollapse }: CodeContextPanelProps) {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [hotspots, setHotspots] = useState<Record<string, unknown> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch data when panel mounts (triggered by indexingDone)
  useEffect(() => {
    if (!indexingDone || !missionId) return;
    getCodeSummary(missionId).then(setSummary).catch(() => {});
    getCodeGraph(missionId).then(setGraph).catch(() => {});
    getCodeHotspots(missionId).then(setHotspots).catch(() => {});
  }, [indexingDone, missionId]);

  // Animate collapse/expand
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (collapsed) {
      animate(el, { height: [el.scrollHeight, 0], opacity: [1, 0], duration: 300, ease: "inOutQuad" });
    } else if (summary || graph || hotspots) {
      animate(el, { height: [0, el.scrollHeight], opacity: [0, 1], duration: 300, ease: "outExpo" });
    }
  }, [collapsed]);

  if (!indexingDone) return null;

  // Collapsed state: one-liner
  if (collapsed && !summary && !graph && !hotspots) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          padding: "8px 0",
          cursor: "pointer",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          color: "var(--text-muted)",
          letterSpacing: "1px",
        }}
      >
        ▸ Code Context ({filesCount} files, {symbolsCount} symbols)
      </div>
    );
  }

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          padding: "8px 0",
          cursor: "pointer",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          color: "var(--text-muted)",
          letterSpacing: "1px",
        }}
      >
        ▸ Code Context ({filesCount} files, {symbolsCount} symbols)
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Code Context
        </span>
        <span
          onClick={onToggleCollapse}
          style={{ cursor: "pointer", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}
        >
          ▾ collapse
        </span>
      </div>
      <div ref={panelRef}>
        <ArchitectureSummary data={summary as any} />
        <DependencyGraph data={graph as any} />
        <HotspotHeatmap data={hotspots as any} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: CodeContextPanel container with fetch + collapse logic"
```

---

## Task 11: Integrate CodeContextPanel into MissionPipeline

**Files:**
- Modify: `packages/frontend/src/passive/MissionPipeline.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `MissionPipeline.tsx`, add:

```tsx
import { useState, useMemo } from "react"; // add useState if not imported
import { CodeContextPanel } from "./CodeContextPanel";
```

- [ ] **Step 2: Add indexing detection and collapse state**

Inside the `MissionPipeline` function, add after existing hooks:

```tsx
  // Detect indexing done from logs
  const indexingDone = useMemo(() => {
    const doneLog = logs.find(l => l.phase === "indexing" && l.data?.indexingDone === true);
    return !!doneLog;
  }, [logs]);

  const indexCounts = useMemo(() => {
    const doneLog = logs.find(l => l.phase === "indexing" && l.data?.indexingDone === true);
    return { files: (doneLog?.data?.files as number) ?? 0, symbols: (doneLog?.data?.symbols as number) ?? 0 };
  }, [logs]);

  const [contextCollapsed, setContextCollapsed] = useState(false);

  // Auto-collapse when first milestone appears
  useEffect(() => {
    if (milestones.length > 0 && indexingDone && !contextCollapsed) {
      setContextCollapsed(true);
    }
  }, [milestones.length, indexingDone]);
```

- [ ] **Step 3: Insert the panel into the render**

Between the mission header section and the milestone pipeline `<div ref={pipelineRef}>`, insert:

```tsx
      {/* Code Context Panel */}
      <CodeContextPanel
        missionId={mission.id}
        indexingDone={indexingDone}
        filesCount={indexCounts.files}
        symbolsCount={indexCounts.symbols}
        collapsed={contextCollapsed}
        onToggleCollapse={() => setContextCollapsed(c => !c)}
      />
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: integrate CodeContextPanel into MissionPipeline"
```

---

## Task 12: End-to-End Test and Push

**Files:**
- None (verification only)

- [ ] **Step 1: Rebuild all services**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
docker compose build --no-cache
docker compose up -d
```

- [ ] **Step 2: Wait for health checks**

```bash
sleep 10
curl -s http://localhost:9100/health | jq .
curl -s http://localhost:3000/health | jq .
```

Expected: Both return `{"status":"ok"}`.

- [ ] **Step 3: Create a test mission**

Open http://localhost:8080, create a mission "Review this repo". Watch the Code Context panel appear after indexing, show the three sections, then auto-collapse when milestones appear.

- [ ] **Step 4: Verify the proxy routes work**

```bash
# Get a mission ID from the running mission
curl -s http://localhost:3000/api/missions/active | jq '.missions[0].id'
# Then test each endpoint
curl -s http://localhost:3000/api/missions/<MISSION_ID>/code/summary | jq .
curl -s http://localhost:3000/api/missions/<MISSION_ID>/code/graph | jq '.nodes | length'
curl -s http://localhost:3000/api/missions/<MISSION_ID>/code/hotspots | jq '.files | length'
```

- [ ] **Step 5: Push everything**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add -A
git commit -m "feat: Code Context Panel — complete implementation"
git push origin main
```
