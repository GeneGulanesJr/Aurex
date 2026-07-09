import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  evidence: [],
  labels: [],
  fixPrompt: "## Issue\nRefactor heavy.ts\n\n## Proposed fix\nExtract helpers.",
  fixPromptVersion: "1.0-template",
  status: "open" as const,
};

const report = {
  id: "review-abc",
  repoName: "aurex",
  status: "complete" as const,
  createdAt: "2026-07-09T00:00:00.000Z",
  summary: { files: 42, symbols: 200, edges: 80, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } },
  issues: [baseIssue],
  recommended: {},
} as any;

describe("RepoScanDashboard", () => {
  it("renders loading state", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: null,
      loading: true,
    }));

    expect(html).toContain("SCANNING REPOSITORY");
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

  it("renders issue list and fix prompt panel", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report,
      loading: false,
    }));

    expect(html).toContain("REPO SCAN");
    expect(html).toContain("GeneGulanesJr/Aurex");
    expect(html).toContain("1 isolated issue");
    expect(html).toContain("scanned");
    expect(html).toContain("Refactor heavy.ts");
    expect(html).toContain("FIX PROMPT");
    expect(html).toContain("Copy fix prompt");
    expect(html).toContain("Export all");
    expect(html).toContain("Extract helpers.");
  });

  it("renders empty state when no issues", () => {
    const html = renderToStaticMarkup(createElement(RepoScanDashboard, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      report: { ...report, issues: [] },
      loading: false,
    }));

    expect(html).toContain("No issues detected");
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
