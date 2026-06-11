import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WsClientEvent } from "@aurex/shared";
import { MissionInspectorPanel } from "./MissionInspectorPanel";

const baseProps = {
  mission: { id: "m1", description: "Debug a mission", status: "running" },
  missionId: "m1",
  missionStatus: "running",
  milestones: [],
  logs: [{ phase: "planning", message: "Created plan", timestamp: 1000 }],
  events: [{ type: "mission_started", missionId: "m1" } as WsClientEvent],
  errors: [],
  agentLogs: {},
  eventStreamCount: 8,
  scanFindings: [],
  isScanning: false,
  scans: [],
};

describe("MissionInspectorPanel", () => {
  it("defaults to the activity tab and hides empty supply tab", () => {
    const html = renderToStaticMarkup(createElement(MissionInspectorPanel, baseProps));

    expect(html).toContain("Activity");
    expect(html).toContain("Debug");
    expect(html).toContain("Mission Debug Log");
    expect(html).toContain("Copy");
    expect(html).toContain("Code");
    expect(html).not.toContain("Supply");
    expect(html).toContain("Created plan");
    expect(html).toContain("missionId: m1");
  });

  it("shows a supply tab when the latest scan has a summary", () => {
    const html = renderToStaticMarkup(createElement(MissionInspectorPanel, {
      ...baseProps,
      scans: [{
        id: "scan-1",
        missionId: "m1",
        profile: "project",
        status: "completed",
        startedAt: "2026-06-07T12:00:00.000Z",
        completedAt: "2026-06-07T12:00:01.000Z",
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
    }));

    expect(html).toContain("Supply");
    expect(html).toContain("CLEAN");
  });
});
