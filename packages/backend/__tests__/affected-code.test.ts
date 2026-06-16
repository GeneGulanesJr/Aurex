import { describe, it, expect } from "vitest";
import {
  buildAffectedCodeScaffold,
  DEFAULT_AFFECTED_CODE_TOKEN_BUDGET,
  type CodeGraphInput,
  type HotspotsInput,
} from "../src/orchestrator/affected-code";

const baseGraph: CodeGraphInput = {
  nodes: [
    { id: "src/a.ts", module: "a", symbols: 5, importance: 10 },
    { id: "src/b.ts", module: "a", symbols: 3, importance: 50 },
    { id: "src/c.ts", module: "b", symbols: 2, importance: 1 },
    { id: "src/d.ts", module: "a", symbols: 1, importance: 30 },
  ],
  edges: [
    { from: "src/a.ts", to: "src/b.ts", kind: "imports" },
    { from: "src/c.ts", to: "src/a.ts", kind: "imports" },
    { from: "src/x.ts", to: "src/y.ts", kind: "imports" }, // neither endpoint in node set
  ],
};

const baseHotspots: HotspotsInput = {
  files: [
    { path: "src/a.ts", module: "a", complexity: 12, symbols: 5 },
    { path: "src/sub/c.ts", module: "a", complexity: 99, symbols: 2 },
    { path: "other/z.ts", module: "b", complexity: 1000, symbols: 1 }, // outside declared paths
  ],
};

describe("buildAffectedCodeScaffold", () => {
  it("filters nodes to declared modules and ranks by importance desc", () => {
    // declaredPaths empty so this isolates module-only filtering (path-based
    // inclusion is exercised by the dedicated mismatch test below).
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: [],
      declaredModules: ["a"],
      graph: baseGraph,
      hotspots: { files: [] },
    });
    const ids = scaffold.nodes.map((n) => n.id);
    expect(ids).toEqual(["src/b.ts", "src/d.ts", "src/a.ts"]); // 50, 30, 10
    // module "b" node (src/c.ts) is excluded
    expect(ids).not.toContain("src/c.ts");
  });

  it("keeps all nodes when declaredModules is empty", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: [],
      graph: baseGraph,
      hotspots: { files: [] },
    });
    expect(scaffold.nodes).toHaveLength(4);
  });

  it("includes nodes whose id (path) falls under a declared path even when module names do not match", () => {
    // Simulates a module-naming mismatch: planner emits declaredModules
    // ["auth"] but LaPis graph nodes carry module "src/auth". Path-based
    // inclusion must still surface those nodes so the scaffold is not empty.
    const graph: CodeGraphInput = {
      nodes: [
        { id: "src/auth/login.ts", module: "src/auth", symbols: 3, importance: 8 },
        { id: "src/auth/token.ts", module: "src/auth", symbols: 2, importance: 5 },
        { id: "src/billing/invoice.ts", module: "src/billing", symbols: 4, importance: 99 },
      ],
      edges: [],
    };
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src/auth"],
      declaredModules: ["auth"], // does NOT match graph module "src/auth"
      graph,
      hotspots: { files: [] },
    });
    const ids = scaffold.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["src/auth/login.ts", "src/auth/token.ts"]);
    // billing node is outside declared path -> excluded despite high importance
    expect(ids).not.toContain("src/billing/invoice.ts");
  });

  it("keeps edges only where from OR to is in the selected node set", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: baseGraph,
      hotspots: { files: [] },
    });
    // selected nodes: a,b,d (all in module "a"). src/c.ts excluded.
    // edge a->b kept; c->a kept (a is selected); x->y dropped.
    expect(scaffold.edges).toHaveLength(2);
    expect(scaffold.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      "src/a.ts->src/b.ts",
      "src/c.ts->src/a.ts",
    ]);
  });

  it("filters hotspots to declared paths and ranks by complexity desc", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: { nodes: [], edges: [] },
      hotspots: baseHotspots,
    });
    // src/a.ts and src/sub/c.ts match "src"; other/z.ts does not.
    expect(scaffold.hotspots.map((h) => h.path)).toEqual(["src/sub/c.ts", "src/a.ts"]); // 99 then 12
  });

  it("returns no hotspots when declaredPaths is empty", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: [],
      declaredModules: ["a"],
      graph: { nodes: [], edges: [] },
      hotspots: baseHotspots,
    });
    expect(scaffold.hotspots).toHaveLength(0);
  });

  it("respects maxNodes / maxEdges / maxHotspots caps and sets truncated", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: baseGraph,
      hotspots: baseHotspots,
      maxNodes: 1,
      maxEdges: 1,
      maxHotspots: 1,
      tokenBudget: DEFAULT_AFFECTED_CODE_TOKEN_BUDGET,
    });
    expect(scaffold.nodes).toHaveLength(1);
    expect(scaffold.edges).toHaveLength(1);
    expect(scaffold.hotspots).toHaveLength(1);
    expect(scaffold.truncated).toBe(true);
  });

  it("does not set truncated when nothing is dropped", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: { nodes: [{ id: "src/a.ts", module: "a", symbols: 1, importance: 1 }], edges: [] },
      hotspots: { files: [{ path: "src/a.ts", module: "a", complexity: 1, symbols: 1 }] },
    });
    expect(scaffold.truncated).toBe(false);
  });

  it("trims to token budget: hotspots first, then nodes, then edges", () => {
    // Many nodes + hotspots; tiny budget forces trimming.
    const manyNodes = Array.from({ length: 50 }, (_, i) => ({
      id: `src/n${i}.ts`,
      module: "a",
      symbols: 1,
      importance: 100 - i,
    }));
    const manyHotspots = Array.from({ length: 30 }, (_, i) => ({
      path: `src/h${i}.ts`,
      module: "a",
      complexity: 200 - i,
      symbols: 1,
    }));
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: { nodes: manyNodes, edges: [] },
      hotspots: { files: manyHotspots },
      tokenBudget: 60, // very tight
    });
    expect(scaffold.truncated).toBe(true);
    // Estimate must be within budget (or as close as possible with at least the overhead).
    expect(scaffold.tokenBudget).toBeLessThanOrEqual(60);
    // Hotspots are dropped first under tight budget.
    expect(scaffold.hotspots.length).toBeLessThan(manyHotspots.length);
  });

  it("re-filters edges when budget trimming drops nodes", () => {
    // Three nodes with one edge per node. A budget that fits only ONE node
    // forces the other two nodes to drop, and their exclusive edges must go
    // with them (an edge is kept only if from OR to is still listed).
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: {
        nodes: [
          { id: "src/keep.ts", module: "a", symbols: 1, importance: 100 },
          { id: "src/drop1.ts", module: "a", symbols: 1, importance: 5 },
          { id: "src/drop2.ts", module: "a", symbols: 1, importance: 1 },
        ],
        edges: [
          // both endpoints dropped after trim — must disappear
          { from: "src/drop1.ts", to: "src/drop2.ts", kind: "imports" },
        ],
      },
      hotspots: { files: [] },
      tokenBudget: 44, // overhead(40) + 1 node(4) = 44 fits; 2 nodes = 48 > 44
    });
    expect(scaffold.nodes).toHaveLength(1);
    expect(scaffold.nodes[0].id).toBe("src/keep.ts");
    // the only edge referenced two dropped nodes, so it must be removed.
    expect(scaffold.edges).toHaveLength(0);
    expect(scaffold.truncated).toBe(true);
  });

  it("falls back gracefully on empty graph and hotspots", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["src"],
      declaredModules: ["a"],
      graph: { nodes: [], edges: [] },
      hotspots: { files: [] },
    });
    expect(scaffold.nodes).toHaveLength(0);
    expect(scaffold.edges).toHaveLength(0);
    expect(scaffold.hotspots).toHaveLength(0);
    expect(scaffold.truncated).toBe(false);
  });

  it("matches nested paths under a declared directory", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "u1",
      declaredPaths: ["packages/backend/src"],
      declaredModules: [],
      graph: { nodes: [], edges: [] },
      hotspots: {
        files: [
          { path: "packages/backend/src/foo.ts", module: "x", complexity: 1, symbols: 1 },
          { path: "packages/frontend/src/bar.ts", module: "y", complexity: 1, symbols: 1 },
          { path: "packages/backend/src/nested/baz.ts", module: "z", complexity: 5, symbols: 1 },
        ],
      },
    });
    const paths = scaffold.hotspots.map((h) => h.path).sort();
    expect(paths).toEqual(["packages/backend/src/foo.ts", "packages/backend/src/nested/baz.ts"]);
  });

  it("carries the unitId through", () => {
    const scaffold = buildAffectedCodeScaffold({
      unitId: "unit-xyz",
      declaredPaths: [],
      declaredModules: [],
      graph: { nodes: [], edges: [] },
      hotspots: { files: [] },
    });
    expect(scaffold.unitId).toBe("unit-xyz");
  });
});
