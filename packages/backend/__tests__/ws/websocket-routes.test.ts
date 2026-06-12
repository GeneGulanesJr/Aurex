import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createEventBus, registerWebSocketRoutes } from "../../src/ws/events";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => "mocked-jwks"),
}));

import { jwtVerify } from "jose";
const mockedJwtVerify = vi.mocked(jwtVerify);

const TEST_AUTH_CONFIG = {
  auth0Domain: "test.us.auth0.com",
  auth0Audience: "https://api.test.io",
};

async function createApp() {
  const app = Fastify();
  const eventBus = createEventBus();
  await app.register(websocket);
  registerWebSocketRoutes(app, eventBus, TEST_AUTH_CONFIG);
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends hello and streams events with sequence numbers after auth", async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: { sub: "auth0|test", email: "test@example.com" },
      protectedHeader: {},
    } as any);

    const { app, eventBus } = await createApp();
    const ws = await app.injectWS("/ws");

    // Authenticate the WS connection
    ws.send(JSON.stringify({ type: "auth", token: "valid.jwt.token" }));

    // Wait for hello message (sent after successful auth)
    const initial = await waitForMessages(ws, 2);
    const authOk = initial.find((m) => m.type === "auth_ok");
    expect(authOk).toBeDefined();
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

  it("supports replay of missed events after auth", async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: { sub: "auth0|test", email: "test@example.com" },
      protectedHeader: {},
    } as any);

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

    // Authenticate first
    ws.send(JSON.stringify({ type: "auth", token: "valid.jwt.token" }));

    // Wait for hello
    await waitForMessages(ws, 2);

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

  it("closes connection with invalid auth token", async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error("Invalid JWT"));

    const { app } = await createApp();
    const ws = await app.injectWS("/ws");

    ws.send(JSON.stringify({ type: "auth", token: "bad-token" }));

    // Wait briefly for the close to occur
    await new Promise((resolve) => setTimeout(resolve, 200));

    ws.close();
    await app.close();
  });
});
