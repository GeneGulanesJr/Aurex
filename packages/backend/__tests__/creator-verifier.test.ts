import { describe, it, expect } from "vitest";
import { verifyCreatorSession } from "../src/enforcement/creator-verifier";
import type { AgentSessionRecord } from "@aurex/shared";

describe("creator-verifier", () => {
  const sessions: AgentSessionRecord[] = [
    { sessionId: "sess-worker-1", agentType: "worker", missionId: "m-1", milestoneId: "ms-1", unitId: "unit-1", spawnedAt: "2026-01-01", terminatedAt: null },
    { sessionId: "sess-validator-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", unitId: null, spawnedAt: "2026-01-01", terminatedAt: null },
    { sessionId: "sess-orchestrator-1", agentType: "orchestrator", missionId: "m-1", milestoneId: null, unitId: null, spawnedAt: "2026-01-01", terminatedAt: null },
  ];

  it("accepts handoff from a registered worker session", () => {
    const result = verifyCreatorSession("sess-worker-1", "worker", sessions);
    expect(result.valid).toBe(true);
  });

  it("accepts verdict from a registered validator session", () => {
    const result = verifyCreatorSession("sess-validator-1", "validator_scrutiny", sessions);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff from an unregistered session", () => {
    const result = verifyCreatorSession("unknown-session", "worker", sessions);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not registered");
  });

  it("rejects handoff from wrong agent type", () => {
    const result = verifyCreatorSession("sess-validator-1", "worker", sessions);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("type mismatch");
  });

  it("exempts human from session checks", () => {
    const result = verifyCreatorSession("human", "orchestrator", sessions);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("known non-session actor");
  });

  it("rejects terminated session", () => {
    const terminated: AgentSessionRecord[] = [
      { ...sessions[0], terminatedAt: "2026-01-02" },
    ];
    const result = verifyCreatorSession("sess-worker-1", "worker", terminated);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("terminated");
  });
});
