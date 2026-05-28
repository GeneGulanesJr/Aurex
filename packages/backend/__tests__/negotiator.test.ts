import { describe, it, expect, vi } from "vitest";
import { createNegotiator } from "../src/orchestrator/negotiator";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { ValidationVerdict } from "@aurex/shared";

// Helper: standard sessions mock for creator verification
const validSessions = [
  { sessionId: "s-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
  { sessionId: "s-2", agentType: "validator_user_testing", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
];

function mockLapisWithSessions(verdicts: ValidationVerdict[], sessions = validSessions) {
  return {
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    getSessionsForMilestone: vi.fn().mockResolvedValue(sessions),
  } as unknown as LaPisClient;
}

describe("negotiator", () => {
  it("escalates when no validator verdicts were recorded", async () => {
    const mockLapis = mockLapisWithSessions([]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validator verdicts");
  });

  it("returns pass when all verdicts pass", async () => {
    const mockLapis = mockLapisWithSessions([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s-1" },
      { verdict: "pass", validatorType: "validator_user_testing", sessionId: "s-2" },
    ] as ValidationVerdict[]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
  });

  it("returns retry when scrutiny fails with patchable classification", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "Missing test", failedUnitIds: ["unit-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
  });

  it("returns rescope when retry limit exceeded", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
  });

  it("returns escalate when rescope limit exceeded", async () => {
    const mockLapis = mockLapisWithSessions([{ verdict: "fail", classification: "blocking", sessionId: "s-1", validatorType: "validator_scrutiny" }] as any);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 5, 2, 5);

    expect(result.decision).toBe("escalate");
  });

  it("always blocks on user testing failure", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "User flow broken", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("user_testing");
  });

  it("discards verdicts from invalid creator sessions", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "bad-session", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    // Only s-1 is registered
    const sessions = [
      { sessionId: "s-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ];

    const mockLapis = mockLapisWithSessions(verdicts, sessions);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    // The bad-session verdict is discarded, but s-1 still passes
    expect(result.decision).toBe("pass");
  });

  it("escalates when all verdict sessions are invalid", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "unknown", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    // No matching sessions
    const sessions: any[] = [];

    const mockLapis = mockLapisWithSessions(verdicts, sessions);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validator verdicts");
  });
});
