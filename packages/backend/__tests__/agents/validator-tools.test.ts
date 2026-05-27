import { describe, it, expect, vi } from "vitest";
import { createValidatorTools } from "../../src/agents/validator-tools";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis() {
  return {
    writeVerdict: vi.fn().mockResolvedValue({
      id: "v-1",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-1",
      verdict: "pass",
      findings: "All criteria met",
      failedUnitIds: [],
      timestamp: "2026-01-01",
    }),
    getContractHistory: vi.fn().mockResolvedValue([
      {
        id: "c-1",
        content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" },
      },
    ]),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue([]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

describe("validator tools", () => {
  it("creates write_verdict tool", () => {
    const tools = createValidatorTools(createMockLapis(), {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-1",
    });
    const tool = tools.find((t) => t.name === "write_verdict");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("verdict");
  });

  it("write_verdict submits a pass verdict to LaPis", async () => {
    const lapis = createMockLapis();
    const tools = createValidatorTools(lapis, {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-1",
    });
    const tool = tools.find((t) => t.name === "write_verdict")!;

    const result = await (tool as any).execute("tc-1", {
      verdict: "pass",
      findings: "All criteria met",
      failedUnitIds: "[]",
    });

    expect(lapis.writeVerdict).toHaveBeenCalledWith("sess-1", expect.objectContaining({
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      verdict: "pass",
      findings: "All criteria met",
      failedUnitIds: [],
    }));

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("accepted");
  });

  it("write_verdict submits a fail verdict with failed unit IDs", async () => {
    const lapis = createMockLapis();
    const tools = createValidatorTools(lapis, {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_user_testing",
      sessionId: "sess-2",
    });
    const tool = tools.find((t) => t.name === "write_verdict")!;

    await (tool as any).execute("tc-1", {
      verdict: "fail",
      findings: "Login flow broken",
      failedUnitIds: '["unit-1", "unit-2"]',
    });

    expect(lapis.writeVerdict).toHaveBeenCalledWith("sess-2", expect.objectContaining({
      verdict: "fail",
      failedUnitIds: ["unit-1", "unit-2"],
    }));
  });

  it("write_verdict handles malformed failedUnitIds JSON gracefully", async () => {
    const lapis = createMockLapis();
    const tools = createValidatorTools(lapis, {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-3",
    });
    const tool = tools.find((t) => t.name === "write_verdict")!;

    await (tool as any).execute("tc-1", {
      verdict: "fail",
      findings: "Bad",
      failedUnitIds: "not-json",
    });

    expect(lapis.writeVerdict).toHaveBeenCalledWith("sess-3", expect.objectContaining({
      failedUnitIds: [],
    }));
  });
});
