import { describe, it, expect } from "vitest";
import { validateBroadcastTransition, canAuthorTransition } from "../src/enforcement/broadcast-lifecycle";

describe("broadcast lifecycle", () => {
  it("allows active → superseded", () => {
    expect(validateBroadcastTransition("active", "superseded").valid).toBe(true);
  });

  it("allows active → archived", () => {
    expect(validateBroadcastTransition("active", "archived").valid).toBe(true);
  });

  it("allows active → expired", () => {
    expect(validateBroadcastTransition("active", "expired").valid).toBe(true);
  });

  it("rejects superseded → active", () => {
    expect(validateBroadcastTransition("superseded", "active").valid).toBe(false);
  });

  it("rejects expired → active", () => {
    expect(validateBroadcastTransition("expired", "active").valid).toBe(false);
  });

  it("rejects archived → active", () => {
    expect(validateBroadcastTransition("archived", "active").valid).toBe(false);
  });

  it("allows author to self-supersede", () => {
    expect(canAuthorTransition("worker-1", "worker-1", "active", "superseded")).toBe(true);
  });

  it("allows Orchestrator to archive any broadcast", () => {
    expect(canAuthorTransition("orchestrator-1", "worker-1", "active", "archived")).toBe(true);
  });

  it("rejects worker archiving another agent broadcast", () => {
    expect(canAuthorTransition("worker-1", "worker-2", "active", "archived")).toBe(false);
  });

  it("allows human guidance broadcasts (special case)", () => {
    expect(canAuthorTransition("human", "human", "active", "superseded")).toBe(true);
  });
});
