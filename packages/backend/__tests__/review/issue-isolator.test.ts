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

  it("creates repo-level test coverage issue when no tests exist", () => {
    const summary = {
      files: 50,
      symbols: 200,
      edges: 100,
      modules: [
        { name: "src", fileCount: 40 },
        { name: "lib", fileCount: 10 },
      ],
      entryPoints: ["src/index.ts"],
      cycles: { count: 0, paths: [] },
    };
    const issues = isolateIssues(summary, { files: [] }, emptyGraph, null, null);
    const testIssue = issues.find((i) => i.id === "test-coverage-none");
    expect(testIssue?.category).toBe("test_coverage");
    expect(testIssue?.tier).toBe("P3");
    expect(testIssue?.labels).toContain("safest-first");
  });

  it("creates one documentation issue per entry point (capped at 5)", () => {
    const entryPoints = Array.from({ length: 8 }, (_, i) => `src/ep-${i}.ts`);
    const summary = {
      files: 30,
      symbols: 100,
      edges: 50,
      modules: [{ name: "src", fileCount: 30 }],
      entryPoints,
      cycles: { count: 0, paths: [] },
    };
    const issues = isolateIssues(summary, { files: [] }, emptyGraph, null, null);
    const docIssues = issues.filter((i) => i.category === "documentation" && i.id.startsWith("documentation-"));
    expect(docIssues).toHaveLength(5);
    expect(new Set(docIssues.map((d) => d.id)).size).toBe(5);
    expect(docIssues.every((d) => d.scopePaths.length === 1)).toBe(true);
  });

  it("creates performance issue for high import density", () => {
    const summary = {
      files: 10,
      symbols: 50,
      edges: 60,
      modules: [{ name: "src", fileCount: 10 }],
      entryPoints: ["index.ts"],
      cycles: { count: 0, paths: [] },
    };
    const issues = isolateIssues(summary, { files: [] }, emptyGraph, null, null);
    expect(issues.some((i) => i.id === "performance-import-density")).toBe(true);
  });

  it("assigns unique IDs when catalogId is empty", () => {
    const scan = {
      id: "scan-1",
      missionId: "repo:test",
      profile: "project" as const,
      status: "completed" as const,
      startedAt: "",
      completedAt: new Date().toISOString(),
      summary: { totalPackages: 2, totalFindings: 2, criticalCount: 0, highCount: 2, mediumCount: 0, lowCount: 0, ecosystems: ["npm"] },
      findings: [
        {
          id: "finding-a",
          scanId: "scan-1",
          missionId: "repo:test",
          findingType: "typosquat",
          severity: "high" as const,
          catalogId: "",
          catalogName: "Typosquat",
          ecosystem: "npm",
          packageName: "lodash",
          normalizedName: "lodash",
          version: "1.0.0",
          sourceType: "dependency",
          sourceFile: "package.json",
          confidence: "high" as const,
          evidence: "evidence a",
        },
        {
          id: "finding-b",
          scanId: "scan-1",
          missionId: "repo:test",
          findingType: "malware",
          severity: "high" as const,
          catalogId: "",
          catalogName: "Malware",
          ecosystem: "npm",
          packageName: "lodash",
          normalizedName: "lodash",
          version: "1.0.0",
          sourceType: "dependency",
          sourceFile: "package.json",
          confidence: "high" as const,
          evidence: "evidence b",
        },
      ],
    };
    const issues = isolateIssues(
      { files: 5, symbols: 10, edges: 5, modules: [{ name: "src", fileCount: 5 }], entryPoints: [], cycles: { count: 0, paths: [] } },
      { files: [] },
      emptyGraph,
      scan,
      null,
    );
    const security = issues.filter((i) => i.category === "security");
    expect(security).toHaveLength(2);
    expect(new Set(security.map((i) => i.id)).size).toBe(2);
  });

  it("scopes lockfile findings to manifest when sourceFile is empty", () => {
    const scan = {
      id: "scan-1",
      missionId: "repo:test",
      profile: "project" as const,
      status: "completed" as const,
      startedAt: "",
      completedAt: new Date().toISOString(),
      summary: { totalPackages: 1, totalFindings: 1, criticalCount: 1, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: ["npm"] },
      findings: [{
        id: "finding-lock",
        scanId: "scan-1",
        missionId: "repo:test",
        findingType: "cve",
        severity: "critical" as const,
        catalogId: "",
        catalogName: "CVE",
        ecosystem: "npm",
        packageName: "bad-pkg",
        normalizedName: "bad-pkg",
        version: "9.9.9",
        sourceType: "lockfile",
        sourceFile: "",
        confidence: "high" as const,
        evidence: "lockfile match",
      }],
    };
    const issues = isolateIssues(
      { files: 5, symbols: 10, edges: 5, modules: [{ name: "src", fileCount: 5 }], entryPoints: [], cycles: { count: 0, paths: [] } },
      { files: [] },
      emptyGraph,
      scan,
      null,
    );
    expect(issues[0].scopePaths).toEqual(["package.json"]);
  });

  it("resolves basename entry points to qualified hotspot paths", () => {
    const summary = {
      files: 30,
      symbols: 100,
      edges: 50,
      modules: [{ name: "src", fileCount: 30 }],
      entryPoints: ["index.ts"],
      cycles: { count: 0, paths: [] },
    };
    const hotspots = {
      files: [{ path: "src/index.ts", module: "src", complexity: 5, symbols: 10 }],
    };
    const graph = {
      nodes: [{ id: "src/index.ts", module: "src", symbols: 10, importance: 5 }],
      edges: [],
    };
    const issues = isolateIssues(summary, hotspots, graph, null, null);
    const doc = issues.find((i) => i.category === "documentation");
    expect(doc?.scopePaths).toEqual(["src/index.ts"]);
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
