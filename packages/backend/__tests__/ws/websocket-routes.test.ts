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

describe("websocket routes", () => {
  it("streams event bus events to /ws clients", async () => {
    const { app, eventBus } = await createApp();
    const ws = await app.injectWS("/ws");

    const received = new Promise<unknown>((resolve) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
    });

    eventBus.emit({
      type: "agent_status",
      agentId: "worker-1",
      agentType: "worker",
      status: "working",
      milestoneId: "ms-1",
    });

    await expect(received).resolves.toEqual({
      event: {
        type: "agent_status",
        agentId: "worker-1",
        agentType: "worker",
        status: "working",
        milestoneId: "ms-1",
      },
    });

    ws.close();
    await app.close();
  });
});
