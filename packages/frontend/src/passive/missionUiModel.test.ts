import { describe, expect, it } from "vitest";
import type { WsClientEvent } from "@aurex/shared";
import {
  buildActivityFeedItems,
  buildMissionSnapshot,
  shouldShowSupplyChainTab,
  summarizeSupplyChainRisk,
} from "./missionUiModel";

describe("missionUiModel", () => {
  it("builds a compact mission snapshot", () => {
    const snapshot = buildMissionSnapshot({
      missionStatus: "running",
      milestoneStatuses: ["completed", "in_progress", "planned"],
      cost: { totalCost: 1.234, totalTokens: 45200 },
      workerStatuses: ["working", "completed", "failed"],
    });

    expect(snapshot.statusLabel).toBe("EXECUTING");
    expect(snapshot.completedMilestones).toBe(1);
    expect(snapshot.totalMilestones).toBe(3);
    expect(snapshot.progressLabel).toBe("1/3 milestones");
    expect(snapshot.costLabel).toBe("$1.23");
    expect(snapshot.tokensLabel).toBe("45.2K tokens");
    expect(snapshot.activeWorkers).toBe(1);
    expect(snapshot.failedWorkers).toBe(1);
  });

  it("uses a planning progress label before milestones exist", () => {
    const snapshot = buildMissionSnapshot({
      missionStatus: "planning",
      milestoneStatuses: [],
      cost: null,
      workerStatuses: [],
    });

    expect(snapshot.statusLabel).toBe("PLANNING");
    expect(snapshot.progressLabel).toBe("Planning milestones…");
  });

  it("merges mission logs and websocket events into stable newest-first activity items", () => {
    const events: WsClientEvent[] = [
      { type: "mission_started", missionId: "m1" } as WsClientEvent,
      { type: "cost_update", missionId: "m1", totalCost: 0.25, totalTokens: 2000, delta: 0.25 } as WsClientEvent,
      { type: "agent_output", missionId: "m1", agentId: "a1", agentType: "worker", eventType: "tool_call", message: "read src/App.tsx", timestamp: "2026-06-07T12:00:05.000Z" } as WsClientEvent,
    ];

    const items = buildActivityFeedItems({
      logs: [{ phase: "planning", message: "Created plan", timestamp: 1_000 }],
      events,
      limit: 4,
    });

    expect(items.map((item) => item.kind)).toEqual(["agent", "cost", "event", "log"]);
    expect(items[0].label).toBe("TOOL");
    expect(items[0].timestamp).toBe(Date.parse("2026-06-07T12:00:05.000Z"));
    expect(items[1].timestamp).toBe(1_002);
    expect(items[2].timestamp).toBe(1_001);
    expect(items[3].timestamp).toBe(1_000);
    expect(items.map((item) => item.id)).toEqual(["event-2-agent_output", "event-1-cost_update", "event-0-mission_started", "log-0-1000"]);
  });

  it("only shows supply chain tab when it has useful content", () => {
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 0, hasLatestSummary: false })).toBe(false);
    expect(shouldShowSupplyChainTab({ isScanning: true, findingCount: 0, scanCount: 0, hasLatestSummary: false })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 2, scanCount: 1, hasLatestSummary: true })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 1, hasLatestSummary: true })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 1, hasLatestSummary: false })).toBe(false);
  });

  it("summarizes supply chain risk with severity priority", () => {
    expect(summarizeSupplyChainRisk([])).toEqual({ label: "CLEAN", color: "var(--success)", findingCount: 0 });
    expect(summarizeSupplyChainRisk([
      { id: "1", severity: "medium" } as any,
      { id: "2", severity: "critical" } as any,
    ])).toEqual({ label: "CRITICAL", color: "var(--error)", findingCount: 2 });
  });
});
