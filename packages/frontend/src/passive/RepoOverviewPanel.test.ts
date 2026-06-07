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
});
