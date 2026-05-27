import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createEventBus, registerWebSocketRoutes } from "../../src/ws/events";

async function createApp() {
  const app = Fastify();
  const eventBus = createEventBus();
  await app.register(websocket);
  registerWebSocketRoutes(app, eventBus);
  await app.ready();
  return { app, eventBus };
}

function waitForMessages(ws: any, count: number, timeoutMs = 2000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const msgs: any[] = [];
    const timeout = setTimeout(() => {
      resolve(msgs);
    }, timeoutMs);
    ws.on("message", (data: Buffer) => {
      msgs.push(JSON.parse(data.toString()));
      if (msgs.length >= count) {
        clearTimeout(timeout);
        resolve(msgs);
      }
    });
    ws.on("error", reject);
  });
}

describe("websocket routes", () => {
  it("sends hello and streams events with sequence numbers", async () => {
    const { app, eventBus } = await createApp();
    const ws = await app.injectWS("/ws");

    // Wait for hello message
    const initial = await waitForMessages(ws, 1);
    const hello = initial.find((m) => m.type === "hello");
    expect(hello).toBeDefined();
    expect(typeof hello.seq).toBe("number");

    // Emit an event
    eventBus.emit({
      type: "agent_status",
      agentId: "worker-1",
      agentType: "worker",
      status: "working",
      milestoneId: "ms-1",
    });

    const eventMsgs = await waitForMessages(ws, 1);
    const eventMsg = eventMsgs.find((m) => m.event?.type === "agent_status");
    expect(eventMsg).toBeDefined();
    expect(eventMsg.event.agentId).toBe("worker-1");
    expect(typeof eventMsg.seq).toBe("number");

    ws.close();
    await app.close();
  });

  it("supports replay of missed events", async () => {
    const { app, eventBus } = await createApp();

    // Emit events before connecting
    eventBus.emit({
      type: "cost_update",
      missionId: "m-1",
      totalCost: 1,
      totalTokens: 100,
      delta: 1,
    });

    const ws = await app.injectWS("/ws");

    // Wait for hello
    await waitForMessages(ws, 1);

    // Request replay from seq 0
    ws.send(JSON.stringify({ type: "replay", lastSeq: 0 }));

    const replayMsgs = await waitForMessages(ws, 3);
    const replayDone = replayMsgs.find((m) => m.type === "replay_done");
    expect(replayDone).toBeDefined();
    expect(replayDone.count).toBeGreaterThanOrEqual(1);

    const replayedEvent = replayMsgs.find((m) => m.replayed === true);
    expect(replayedEvent).toBeDefined();

    ws.close();
    await app.close();
  });
});
