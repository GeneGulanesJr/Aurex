import { describe, it, expect } from "vitest";
import { isolateIssues, countIssuesByTier } from "../../src/review/issue-isolator.js";
import { attachFixPrompts } from "../../src/review/fix-prompt-builder.js";

const emptyGraph = { nodes: [], edges: [], cycles: [] as string[][] };

describe("isolateIssues", () => {
  it("creates one issue per dependency cycle path", () => {
    const summary = {
      files: 10,
      symbols: 50,
      edges: 20,
      modules: [{ name: "auth", fileCount: 3 }, { name: "billing", fileCount: 2 }],
      entryPoints: ["index.ts"],
      cycles: {
        count: 2,
        paths: [["auth", "billing", "auth"], ["ui", "data", "ui"]],
      },
    };
    const issues = isolateIssues(summary, { files: [] }, emptyGraph, null, null);
    const cycleIssues = issues.filter((i) => i.category === "critical_path");
    expect(cycleIssues).toHaveLength(2);
    expect(cycleIssues[0].title).toContain("auth → billing → auth");
  });

  it("creates per-file dead code issues instead of one bundle", () => {
    const summary = {
      files: 20,
      symbols: 100,
      edges: 40,
      modules: [{ name: "src", fileCount: 20 }],
      entryPoints: ["main.ts"],
      cycles: { count: 0, paths: [] },
    };
    const hotspots = {
      files: [
        { path: "src/orphan-a.ts", module: "src", complexity: 5, symbols: 3 },
        { path: "src/orphan-b.ts", module: "src", complexity: 4, symbols: 2 },
        { path: "src/orphan-c.ts", module: "src", complexity: 3, symbols: 1 },
      ],
    };
    const issues = isolateIssues(summary, hotspots, emptyGraph, null, null);
    const dead = issues.filter((i) => i.category === "dead_code");
    expect(dead.length).toBeGreaterThanOrEqual(3);
    expect(dead.length).toBeLessThanOrEqual(5);
    expect(dead.every((d) => d.scopePaths.length === 1)).toBe(true);
  });

  it("skips dead-code for files with inbound import edges", () => {
    const summary = {
      files: 10,
      symbols: 50,
      edges: 5,
      modules: [{ name: "src", fileCount: 10 }],
      entryPoints: ["main.ts"],
      cycles: { count: 0, paths: [] },
    };
    const hotspots = {
      files: [{ path: "src/used.ts", module: "src", complexity: 5, symbols: 3 }],
    };
    const graph = {
      nodes: [{ id: "src/used.ts", module: "src", symbols: 3, importance: 1 }],
      edges: [{ from: "src/main.ts", to: "src/used.ts", kind: "static" }],
    };
    const issues = isolateIssues(summary, hotspots, graph, null, null);
    expect(issues.filter((i) => i.category === "dead_code")).toHaveLength(0);
  });

  it("limits scope paths to at most 3", () => {
    const graph = {
      nodes: [
        { id: "a.ts", module: "m", symbols: 1, importance: 10 },
        { id: "b.ts", module: "m", symbols: 1, importance: 9 },
        { id: "c.ts", module: "m", symbols: 1, importance: 8 },
        { id: "d.ts", module: "m", symbols: 1, importance: 7 },
      ],
      edges: [],
    };
    const summary = {
      files: 4,
      symbols: 4,
      edges: 4,
      modules: [{ name: "m", fileCount: 4 }],
      entryPoints: [],
      cycles: { count: 1, paths: [["a.ts", "b.ts", "c.ts", "d.ts", "a.ts"]] },
    };
    const issues = isolateIssues(summary, { files: [] }, graph, null, null);
    expect(issues[0].scopePaths.length).toBeLessThanOrEqual(3);
  });
});

describe("fix prompts", () => {
  it("attaches fixPrompt with LaPis context and verification", () => {
    const drafts = isolateIssues(
      {
        files: 5,
        symbols: 20,
        edges: 10,
        modules: [{ name: "src", fileCount: 5 }],
        entryPoints: ["index.ts"],
        cycles: { count: 0, paths: [] },
      },
      {
        files: [{ path: "src/heavy.ts", module: "src", complexity: 35, symbols: 10 }],
      },
      emptyGraph,
      null,
      {
        repoName: "test",
        profile: "node",
        packageManager: "pnpm",
        languages: ["TypeScript"],
        frameworks: [],
        monorepo: false,
        lockfiles: [],
        commands: [{ name: "test", command: "pnpm test", confidence: "high", source: "package.json" }],
        blockers: [],
        warnings: [],
        confidence: "high",
        generatedAt: new Date().toISOString(),
      },
    );
    const issues = attachFixPrompts(drafts, {
      graph: emptyGraph,
      hotspots: { files: [{ path: "src/heavy.ts", module: "src", complexity: 35, symbols: 10 }] },
      readiness: null,
    });
    const complexity = issues.find((i) => i.category === "complexity");
    expect(complexity?.fixPrompt).toContain("## Issue");
    expect(complexity?.fixPrompt).toContain("src/heavy.ts");
    expect(complexity?.fixPrompt).toContain("## Proposed fix");
    expect(complexity?.fixPrompt).toContain("## Verification");
  });

  it("countIssuesByTier aggregates correctly", () => {
    const issues = attachFixPrompts(
      [{ id: "a", tier: "P0", category: "security", title: "t", description: "d", detail: "", scopePaths: [], scopeModules: [], confidence: "high", estimatedEffort: "small", estimatedRisk: "low", evidence: [], labels: [] }],
      { graph: emptyGraph, hotspots: { files: [] }, readiness: null },
    );
    expect(countIssuesByTier(issues)).toEqual({ P0: 1 });
  });
});
