import { describe, it, expect, vi } from "vitest";
import { createNegotiator } from "../src/orchestrator/negotiator";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { ValidationVerdict } from "@aurex/shared";

describe("negotiator", () => {
  it("escalates instead of passing when no validators have written verdicts", async () => {
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue([]),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validation verdicts");
  });

  it("returns pass when all verdicts pass", async () => {
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue([
        { verdict: "pass", validatorType: "validator_scrutiny" },
        { verdict: "pass", validatorType: "validator_user_testing" },
      ] as ValidationVerdict[]),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
  });

  it("returns retry when scrutiny fails with patchable classification", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "Missing test", failedUnitIds: ["unit-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
  });

  it("returns rescope when retry limit exceeded", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
  });

  it("returns escalate when rescope limit exceeded", async () => {
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue([{ verdict: "fail", classification: "blocking" }]),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 5, 2, 5);

    expect(result.decision).toBe("escalate");
  });

  it("always blocks on user testing failure", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "User flow broken", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("user_testing");
  });
});
