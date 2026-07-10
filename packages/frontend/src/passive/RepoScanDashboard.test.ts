import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewReport } from "@aurex/shared";
import { RepoScanDashboard } from "./RepoScanDashboard";

vi.mock("../api", () => ({
  exportRepoReview: vi.fn(),
}));

const baseIssue = {
  id: "issue-1",
  tier: "P1" as const,
  category: "complexity" as const,
  title: "Refactor heavy.ts — complexity 35",
  description: "High complexity file.",
  detail: "Complexity: 35",
  scopePaths: ["src/heavy.ts"],
  scopeModules: ["src"],
  confidence: "high" as const,
  estimatedEffort: "medium" as const,
  estimatedRisk: "medium" as const,
  evidence: [{ type: "lapis" as const, message: "Complexity 35", file: "src/heavy.ts" }],
  labels: [],
  fixPrompt: "## Issue\nRefactor heavy.ts\n\n## Proposed fix\nExtract helpers.",
  fixPromptVersion: "1.0-template",
  status: "open" as const,
};

const dismissedIssue = {
  ...baseIssue,
  id: "issue-2",
  title: "Dismissed issue",
  status: "dismissed" as const,
};

const report = {
  id: "review-abc",
  repoName: "aurex",
  status: "completed" as const,
  createdAt: "2026-07-09T00:00:00.000Z",
  analysisVersion: "3.0",
  summary: {
    files: 42,
    symbols: 200,
    modules: 3,
    cycleCount: 0,
    issueCounts: { P1: 1 },
    supplyChainSeverity: {
      totalPackages: 5,
      totalFindings: 2,
      criticalCount: 0,
      highCount: 1,
      mediumCount: 1,
      lowCount: 0,
      ecosystems: ["npm"],
    },
  },
  issues: [baseIssue],
  architecture: {
    modules: [{ name: "src", fileCount: 10 }],
    cycles: [["a", "b", "a"]],
    entryPoints: ["src/index.ts"],
  },
  recommended: { highestImpact: "issue-1", safestFirst: "issue-1" },
  readiness: null,
} satisfies ReviewReport;

describe("RepoScanDashboard", () => {
  it("renders loading state with scan phase", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: null,
      loading: true,
    }));

    expect(html).toContain("INDEXING REPOSITORY");
    expect(html).toContain("Step 1 of 5");
  });

  it("renders scan failed when error and no report", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: null,
      loading: false,
      error: "Index unavailable",
      onRescan: () => undefined,
    }));

    expect(html).toContain("SCAN FAILED");
    expect(html).toContain("Index unavailable");
    expect(html).toContain("Retry scan");
  });

  it("renders issue list, filters, recommended pins, and fix prompt panel", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report,
      loading: false,
    }));

    expect(html).toContain("REPO SCAN");
    expect(html).toContain("supply-chain finding");
    expect(html).toContain("START HERE");
    expect(html).toContain("Highest impact");
    expect(html).toContain("Search suggestions");
    expect(html).toContain("All tiers");
    expect(html).toContain("SUGGESTIONS");
    expect(html).toContain("ARCHITECTURE");
    expect(html).toContain("Refactor heavy.ts");
    expect(html).toContain("complexity");
    expect(html).toContain("Acknowledge");
    expect(html).toContain("Copy fix prompt");
    expect(html).toContain("Export all");
    expect(html).toContain("Extract helpers.");
  });

  it("renders clean empty state when no issues", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: { ...report, issues: [] },
      loading: false,
    }));

    expect(html).toContain("No issues detected");
  });

  it("renders partial empty state when scan is partial", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: { ...report, status: "partial", issues: [] },
      loading: false,
      error: "Hotspots unavailable",
    }));

    expect(html).toContain("Partial scan");
    expect(html).toContain("Hotspots unavailable");
  });

  it("hides dismissed issues from open filter by default", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: { ...report, issues: [baseIssue, dismissedIssue] },
      loading: false,
    }));

    expect(html).toContain("Refactor heavy.ts");
    expect(html).not.toContain("Dismissed issue");
  });

  it("shows non-blocking error banner when report exists", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report,
      loading: false,
      error: "Package scan skipped",
    }));

    expect(html).not.toContain("SCAN FAILED");
    expect(html).toContain("Package scan skipped");
    expect(html).toContain("Refactor heavy.ts");
  });
});
