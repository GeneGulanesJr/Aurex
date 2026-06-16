import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepoOverviewPanel } from "./RepoOverviewPanel";

const suggestion = {
  id: "s1",
  tier: "P1",
  category: "security",
  title: "Fix auth bypass",
  description: "Harden authentication guard",
  prefill: "Fix auth bypass",
  confidence: "high",
  estimatedEffort: "medium",
  estimatedRisk: "low",
};

const readiness = {
  profile: "ready",
  packageManager: "pnpm",
  monorepo: true,
  languages: ["TypeScript"],
  commands: [],
  blockers: [],
  warnings: [],
};

describe("RepoOverviewPanel", () => {
  it("puts next best missions before reference cards", () => {
    const html = renderToStaticMarkup(createElement(RepoOverviewPanel, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      summary: null,
      hotspots: null,
      suggestions: [suggestion],
      readiness,
      packageScan: null,
      packageFindings: [],
      loading: false,
      onStartMission: () => undefined,
    } as any));

    expect(html).toContain("NEXT BEST MISSIONS");
    expect(html.indexOf("NEXT BEST MISSIONS")).toBeLessThan(html.indexOf("READINESS PROFILE"));
    expect(html).toContain("1 actionable · 1 priority bands");
    expect(html).toContain("background:var(--accent)");
  });

  it("renders the full ANALYSIS FAILED screen when error is set and everything is empty", () => {
    const html = renderToStaticMarkup(createElement(RepoOverviewPanel, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      summary: null,
      hotspots: null,
      suggestions: [],
      readiness: null,
      packageScan: null,
      packageFindings: [],
      loading: false,
      error: "All analysis sections failed.",
      onStartMission: () => undefined,
    } as any));

    expect(html).toContain("ANALYSIS FAILED");
    expect(html).toContain("All analysis sections failed.");
  });

  it("renders a non-blocking error banner for partial failures (error set but data present)", () => {
    const html = renderToStaticMarkup(createElement(RepoOverviewPanel, {
      repoName: "aurex",
      fullName: "GeneGulanesJr/Aurex",
      summary: null,
      hotspots: null,
      suggestions: [suggestion],
      readiness,
      packageScan: null,
      packageFindings: [],
      loading: false,
      error: "Some analysis sections could not be loaded (hotspots).",
      onStartMission: () => undefined,
    } as any));

    // Non-blocking banner: the full failure screen must NOT render.
    expect(html).not.toContain("ANALYSIS FAILED");
    // The banner surfaces the partial-failure message and the rest of the panel
    // (suggestions, readiness) still renders.
    expect(html).toContain("Some analysis sections could not be loaded (hotspots).");
    expect(html).toContain("NEXT BEST MISSIONS");
    expect(html).toContain("READINESS PROFILE");
  });
});
