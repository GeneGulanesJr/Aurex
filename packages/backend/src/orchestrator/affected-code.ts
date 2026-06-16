// packages/backend/src/orchestrator/affected-code.ts
//
// Pure reducer that turns a repo's full LaPis code graph + hotspots into a
// compact, ranked scaffold scoped to a single working unit's declared paths
// and modules. The scaffold is a NAVIGATION MAP (no source bodies) injected
// into worker context so the coding agent does not cold-start — it then
// fetches full file bodies on demand via its read/grep tools.
//
// Design (Aurex issue #114):
//   - Graph nodes are filtered to the unit's declared modules, then ranked by
//     `importance` desc. `importance` is reliable — the frontend
//     `DependencyGraph.tsx` sorts nodes by `b.importance - a.importance`.
//   - Edges are kept only when `from` OR `to` touches a selected node, capped.
//   - Hotspots are filtered to declared paths, ranked by `complexity` desc.
//   - A soft token budget trims sections (hotspots first, then nodes, then
//     edges) so the rendered scaffold stays near the configured budget.
//   - `truncated` is true iff any cap or budget actually dropped an item.
//
// This module is pure and has no LaPis/config imports so it is trivially
// unit-testable. The caller passes the graph/hotspots it already fetched.

import type {
  AffectedCodeEdge,
  AffectedCodeHotspot,
  AffectedCodeNode,
  AffectedCodeScaffold,
} from "@aurex/shared";

/** Shape returned by LaPis `getCodeGraph`. */
export interface CodeGraphInput {
  nodes: Array<{ id: string; module: string; symbols: number; importance: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  cycles?: string[][];
}

/** Shape returned by LaPis `getCodeHotspots`. */
export interface HotspotsInput {
  files: Array<{ path: string; module: string; complexity: number; symbols: number }>;
}

export interface BuildAffectedCodeScaffoldInput {
  unitId: string;
  declaredPaths: string[];
  declaredModules: string[];
  graph: CodeGraphInput;
  hotspots: HotspotsInput;
  /** Soft token budget for the rendered scaffold. Default 1200. */
  tokenBudget?: number;
  /** Max graph nodes to keep (post module-filter, pre budget). Default 25. */
  maxNodes?: number;
  /** Max import edges to keep. Default 20. */
  maxEdges?: number;
  /** Max hotspot files to keep. Default 10. */
  maxHotspots?: number;
}

/** Default soft token budget for the rendered scaffold. */
export const DEFAULT_AFFECTED_CODE_TOKEN_BUDGET = 1200;
export const DEFAULT_MAX_NODES = 25;
export const DEFAULT_MAX_EDGES = 20;
export const DEFAULT_MAX_HOTSPOTS = 10;

// Rough per-item token estimates. The scaffold is paths + small records, so
// these are conservative averages measured against typical graph/hotspot rows.
const TOKENS_PER_NODE = 4;
const TOKENS_PER_EDGE = 4;
const TOKENS_PER_HOTSPOT = 6;
// Fixed overhead for the section header + framing prose in context-builder.
const SECTION_OVERHEAD_TOKENS = 40;

/**
 * Build a compact, ranked affected-code scaffold for one working unit.
 *
 * Ordering guarantees (stable):
 *   - nodes: importance desc
 *   - edges: original order (LaPis already returns them grouped)
 *   - hotspots: complexity desc
 *
 * Budget trimming order (when the rendered estimate exceeds the budget):
 *   hotspots first (drop lowest-complexity), then nodes (drop lowest
 *   importance), then edges. Edges are cheapest and most useful, so trimmed
 *   last. `truncated` reflects whether ANY trim happened.
 */
export function buildAffectedCodeScaffold(
  input: BuildAffectedCodeScaffoldInput,
): AffectedCodeScaffold {
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = input.maxEdges ?? DEFAULT_MAX_EDGES;
  const maxHotspots = input.maxHotspots ?? DEFAULT_MAX_HOTSPOTS;
  const tokenBudget = input.tokenBudget ?? DEFAULT_AFFECTED_CODE_TOKEN_BUDGET;

  const declaredModuleSet = new Set(
    (input.declaredModules ?? []).map((m) => m.trim()).filter(Boolean),
  );
  const declaredPathList = (input.declaredPaths ?? []).filter(Boolean);

  // 1. Nodes: keep a node if its module is declared OR its id (file path)
  //    falls under a declared path. Module names from the planner and from
  //    LaPis can disagree (e.g. "auth" vs "src/auth"), so path-based
  //    inclusion makes node selection resilient to that mismatch and keeps
  //    it consistent with the path-based hotspot selection below. When the
  //    unit declares NO scope at all, keep every node (broadest map) — this
  //    preserves the original behavior and avoids an empty scaffold for
  //    under-specified units.
  const noScopeDeclared = declaredModuleSet.size === 0 && declaredPathList.length === 0;
  let truncated = false;
  let nodes: AffectedCodeNode[] = input.graph.nodes
    .filter((n) => {
      if (noScopeDeclared) return true;
      if (declaredModuleSet.size > 0 && n.module != null && declaredModuleSet.has(n.module)) return true;
      return pathMatchesDeclared(n.id, declaredPathList);
    })
    .map((n) => ({ id: n.id, module: n.module, symbols: n.symbols, importance: n.importance }))
    .sort((a, b) => b.importance - a.importance);
  if (nodes.length > maxNodes) {
    nodes = nodes.slice(0, maxNodes);
    truncated = true;
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 2. Edges: keep where from OR to is in the selected node set, cap.
  let edges: AffectedCodeEdge[] = input.graph.edges
    .filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
  if (edges.length > maxEdges) {
    edges = edges.slice(0, maxEdges);
    truncated = true;
  }

  // 3. Hotspots: filter to declared paths, rank by complexity desc.
  let hotspots: AffectedCodeHotspot[] = input.hotspots.files
    .filter((f) => pathMatchesDeclared(f.path, declaredPathList))
    .map((f) => ({ path: f.path, module: f.module, complexity: f.complexity, symbols: f.symbols }))
    .sort((a, b) => b.complexity - a.complexity);
  if (hotspots.length > maxHotspots) {
    hotspots = hotspots.slice(0, maxHotspots);
    truncated = true;
  }

  // 4. Soft budget trim. Compute rendered estimate and drop the lowest-value
  //    items until we are within budget. Order: hotspots -> nodes -> edges.
  let consumed = estimateTokens(nodes.length, edges.length, hotspots.length);
  if (consumed > tokenBudget) {
    // Trim hotspots (drop from the end = lowest complexity).
    while (hotspots.length > 0 && consumed > tokenBudget) {
      hotspots.pop();
      truncated = true;
      consumed = estimateTokens(nodes.length, edges.length, hotspots.length);
    }
    // Trim nodes (drop from the end = lowest importance). Keep edges consistent.
    while (nodes.length > 0 && consumed > tokenBudget) {
      nodes.pop();
      truncated = true;
      // Re-filter edges against the shrunk node set so we don't render edges
      // to nodes that are no longer listed.
      const liveIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => liveIds.has(e.from) || liveIds.has(e.to));
      consumed = estimateTokens(nodes.length, edges.length, hotspots.length);
    }
    // Trim edges last.
    while (edges.length > 0 && consumed > tokenBudget) {
      edges.pop();
      truncated = true;
      consumed = estimateTokens(nodes.length, edges.length, hotspots.length);
    }
  }

  return {
    unitId: input.unitId,
    nodes,
    edges,
    hotspots,
    tokenBudget: consumed,
    truncated,
  };
}

function estimateTokens(nodes: number, edges: number, hotspots: number): number {
  return SECTION_OVERHEAD_TOKENS
    + nodes * TOKENS_PER_NODE
    + edges * TOKENS_PER_EDGE
    + hotspots * TOKENS_PER_HOTSPOT;
}

/**
 * A hotspot path matches the declared scope if it equals or is nested under
 * any declared path. Declared paths may be directories (no trailing slash
 * required) or exact file paths. When no declared paths are present, nothing
 * matches (the scaffold's hotspot section is intentionally empty rather than
 * dumping the whole repo).
 */
function pathMatchesDeclared(path: string, declaredPaths: string[]): boolean {
  if (declaredPaths.length === 0) return false;
  const norm = path.replace(/\/+$/, "");
  for (const declared of declaredPaths) {
    const d = declared.replace(/\/+$/, "");
    if (d.length === 0) continue;
    if (norm === d || norm.startsWith(d + "/")) return true;
  }
  return false;
}
