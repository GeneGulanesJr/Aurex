import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeContextPanel } from "./CodeContextPanel";
import { SupplyChainPanel } from "./SupplyChainPanel";

describe("mission side panel variants", () => {
  it("shows a code context pending state in inspector mode before indexing is done", () => {
    const html = renderToStaticMarkup(createElement(CodeContextPanel, {
      missionId: "m1",
      logs: [],
      milestones: [],
      variant: "inspector",
      autoCollapse: false,
      showCollapsedSummary: false,
    }));

    expect(html).toContain("Code context pending indexing");
  });

  it("keeps inline code context hidden before indexing is done", () => {
    const html = renderToStaticMarkup(createElement(CodeContextPanel, {
      missionId: "m1",
      logs: [],
      milestones: [],
    }));

    expect(html).toBe("");
  });

  it("hides empty supply chain content when requested", () => {
    const html = renderToStaticMarkup(createElement(SupplyChainPanel, {
      findings: [],
      scans: [],
      isScanning: false,
      hideWhenEmpty: true,
      variant: "inspector",
    }));

    expect(html).toBe("");
  });

  it("keeps supply chain visible for a clean completed scan with summary", () => {
    const html = renderToStaticMarkup(createElement(SupplyChainPanel, {
      findings: [],
      scans: [{
        id: "scan-1",
        missionId: "m1",
        profile: "project",
        status: "completed",
        startedAt: "2026-06-07T12:00:00.000Z",
        completedAt: "2026-06-07T12:00:01.000Z",
        findings: [],
        summary: {
          totalPackages: 12,
          totalFindings: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          ecosystems: ["npm"],
        },
      }],
      isScanning: false,
      hideWhenEmpty: true,
      variant: "inspector",
    }));

    expect(html).toContain("SUPPLY CHAIN");
    expect(html).toContain("No findings");
  });
});
