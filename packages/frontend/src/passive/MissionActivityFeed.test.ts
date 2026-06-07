import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WsClientEvent } from "@aurex/shared";
import { MissionActivityFeed } from "./MissionActivityFeed";

describe("MissionActivityFeed", () => {
  it("renders an empty activity state", () => {
    const html = renderToStaticMarkup(createElement(MissionActivityFeed, { logs: [], events: [], active: false }));

    expect(html).toContain("Activity");
    expect(html).toContain("Awaiting mission activity");
  });

  it("shows live for timestamp-less websocket events without logs", () => {
    const html = renderToStaticMarkup(createElement(MissionActivityFeed, {
      logs: [],
      events: [{ type: "mission_started", missionId: "m1" } as WsClientEvent],
      active: true,
      limit: 1,
    }));

    expect(html).toContain("live");
    expect(html).toContain("mission started");
  });

  it("renders normalized logs and websocket events", () => {
    const events: WsClientEvent[] = [
      { type: "mission_started", missionId: "m1" },
      { type: "cost_update", missionId: "m1", totalCost: 0.25, totalTokens: 2000, delta: 0.25 },
    ];

    const html = renderToStaticMarkup(createElement(MissionActivityFeed, {
      logs: [{ phase: "planning", message: "Created plan", timestamp: 1000 }],
      events,
      active: true,
      limit: 3,
    }));

    expect(html).toContain("COST");
    expect(html).toContain("$0.25 · 2K tokens");
    expect(html).toContain("START");
    expect(html).toContain("mission started");
    expect(html).toContain("PLANNING");
    expect(html).toContain("Created plan");
  });
});
