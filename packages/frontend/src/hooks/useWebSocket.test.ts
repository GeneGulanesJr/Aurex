import { describe, it, expect } from "vitest";
import { buildWsUrl, parseWsMessage, buildPostAuthMessages, classifyMessage } from "./useWebSocket";

describe("buildWsUrl", () => {
  it("uses ws: for http", () => {
    expect(buildWsUrl("localhost:3000", "http:")).toBe("ws://localhost:3000/ws");
  });

  it("uses wss: for https", () => {
    expect(buildWsUrl("example.com", "https:")).toBe("wss://example.com/ws");
  });
});

describe("parseWsMessage", () => {
  it("parses valid JSON with event", () => {
    const result = parseWsMessage(JSON.stringify({ seq: 5, event: { type: "cost_update", missionId: "m1", totalCost: 1, totalTokens: 100, delta: 0.1 } }));
    expect(result?.seq).toBe(5);
    expect(result?.event?.type).toBe("cost_update");
  });

  it("parses protocol messages without event", () => {
    const result = parseWsMessage(JSON.stringify({ type: "auth_ok" }));
    expect(result?.type).toBe("auth_ok");
    expect(result?.event).toBeUndefined();
  });

  it("returns null for invalid JSON", () => {
    expect(parseWsMessage("not json")).toBeNull();
  });
});


describe("buildPostAuthMessages", () => {
  it("defers replay and mission subscription until after auth acknowledgement", () => {
    expect(buildPostAuthMessages("7", "mission-1").map((message) => JSON.parse(message))).toEqual([
      { type: "replay", lastSeq: 7 },
      { event: "subscribe_mission", missionId: "mission-1" },
    ]);
  });

  it("omits replay when the stored sequence is invalid", () => {
    expect(buildPostAuthMessages("not-a-number", "mission-1").map((message) => JSON.parse(message))).toEqual([
      { event: "subscribe_mission", missionId: "mission-1" },
    ]);
  });
});

describe("classifyMessage", () => {
  it("classifies a WsClientEvent payload", () => {
    const raw = JSON.stringify({ seq: 3, event: { type: "cost_update", missionId: "m1", totalCost: 1, totalTokens: 100 } });
    const m = classifyMessage(raw);
    expect(m?.kind).toBe("event");
    expect(m?.seq).toBe(3);
  });

  it("classifies auth_ok as control", () => {
    const m = classifyMessage(JSON.stringify({ type: "auth_ok" }));
    expect(m).not.toBeNull();
    if (m?.kind !== "control") throw new Error("expected control kind");
    expect(m.control.type).toBe("auth_ok");
  });

  it("classifies checkpoint_resolved as control", () => {
    const raw = JSON.stringify({ type: "checkpoint_resolved", checkpointId: "cp1", accepted: true, duplicate: false });
    const m = classifyMessage(raw);
    expect(m).not.toBeNull();
    if (m?.kind !== "control") throw new Error("expected control kind");
    expect(m.control.type).toBe("checkpoint_resolved");
  });

  it("classifies checkpoint_resolved failure with error/status", () => {
    const raw = JSON.stringify({ type: "checkpoint_resolved", checkpointId: "cp1", accepted: false, error: "not found", status: 404 });
    const m = classifyMessage(raw);
    expect(m).not.toBeNull();
    if (m?.kind !== "control") throw new Error("expected control kind");
    expect(m.control).toMatchObject({ type: "checkpoint_resolved", accepted: false, error: "not found", status: 404 });
  });

  it("returns null for malformed JSON", () => {
    expect(classifyMessage("not json")).toBeNull();
  });

  it("returns unknown for neither event nor recognized control type", () => {
    const m = classifyMessage(JSON.stringify({ type: "future_message" }));
    expect(m).not.toBeNull();
    if (m?.kind !== "unknown") throw new Error("expected unknown kind");
    expect(m.raw).toBeDefined();
  });
});
