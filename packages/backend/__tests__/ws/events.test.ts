import { describe, it, expect } from "vitest";
import { createEventBus } from "../../src/ws/events";
import type { WsClientEvent } from "@aurex/shared";

describe("event bus", () => {
  it("broadcasts agent_status events", () => {
    const bus = createEventBus();
    const received: WsClientEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({
      type: "agent_status",
      agentId: "worker-1",
      agentType: "worker",
      status: "working",
      milestoneId: "ms-1",
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent_status");
  });

  it("broadcasts escalation events", () => {
    const bus = createEventBus();
    const received: WsClientEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({
      type: "escalation",
      missionId: "m-1",
      trigger: { kind: "milestone_complete", milestoneId: "ms-1", releaseBranch: "release/milestone-1" },
      context: { trigger: "milestone_complete", milestoneId: "ms-1", summary: "Done" },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("escalation");
  });

  it("supports multiple subscribers", () => {
    const bus = createEventBus();
    let count = 0;
    bus.subscribe(() => count++);
    bus.subscribe(() => count++);

    bus.emit({
      type: "cost_update",
      missionId: "m-1",
      totalCost: 5.0,
      totalTokens: 1000,
      delta: 0.5,
    });

    expect(count).toBe(2);
  });

  it("unsubscribe stops events", () => {
    const bus = createEventBus();
    let count = 0;
    const unsub = bus.subscribe(() => count++);

    bus.emit({ type: "milestone_progress", milestoneId: "ms-1", status: "completed", completedUnits: 1, totalUnits: 1 });
    expect(count).toBe(1);

    unsub();
    bus.emit({ type: "milestone_progress", milestoneId: "ms-2", status: "in_progress", completedUnits: 0, totalUnits: 2 });
    expect(count).toBe(1);
  });
});
