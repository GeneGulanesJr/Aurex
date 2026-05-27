import { describe, it, expect, vi } from "vitest";
import { createValidatorTools } from "../../src/agents/validator-tools";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis() {
  return {
    writeVerdict: vi.fn().mockResolvedValue({
      id: "v-1",
      verdict: "pass",
      sessionId: "session-1",
    }),
  } as unknown as LaPisClient;
}

describe("validator tools", () => {
  it("creates write_verdict tool", () => {
    const tools = createValidatorTools(createMockLapis(), {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      getSessionId: () => "session-1",
    });

    const tool = tools.find((t) => t.name === "write_verdict");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("validation verdict");
  });

  it("writes verdict with automatic validator context", async () => {
    const lapis = createMockLapis();
    const tools = createValidatorTools(lapis, {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      getSessionId: () => "session-1",
    });
    const tool = tools.find((t) => t.name === "write_verdict")!;

    await (tool as any).execute("tc-1", {
      verdict: "pass",
      findings: "Tests and diff look correct",
      failedUnitIds: [],
    });

    expect(lapis.writeVerdict).toHaveBeenCalledWith("session-1", expect.objectContaining({
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      verdict: "pass",
      failedUnitIds: [],
    }));
  });

  it("rejects verdict before session id is available", async () => {
    const lapis = createMockLapis();
    const tools = createValidatorTools(lapis, {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      getSessionId: () => "",
    });
    const tool = tools.find((t) => t.name === "write_verdict")!;

    const result = await (tool as any).execute("tc-1", {
      verdict: "fail",
      findings: "No session",
      failedUnitIds: ["unit-1"],
    });

    expect(lapis.writeVerdict).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("rejected");
  });
});
