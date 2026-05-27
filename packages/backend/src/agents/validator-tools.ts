import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentType, ValidationVerdict } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface ValidatorToolContext {
  milestoneId: string;
  contractId: string;
  validatorType: Extract<AgentType, "validator_scrutiny" | "validator_user_testing">;
  getSessionId: () => string;
}

export function createValidatorTools(lapis: LaPisClient, context: ValidatorToolContext) {
  const writeVerdict = defineTool({
    name: "write_verdict",
    label: "Write Verdict",
    description:
      "Submit the required validation verdict for this milestone. Use exactly once when validation is complete.",
    parameters: Type.Object({
      verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail")], {
        description: "Whether the milestone passed validation",
      }),
      findings: Type.String({
        description: "Detailed validation findings. For pass, summarize what was checked.",
      }),
      failedUnitIds: Type.Array(Type.String(), {
        description: "Working unit IDs that failed validation. Empty when passing.",
      }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const sessionId = context.getSessionId();
      if (!sessionId) {
        return {
          content: [{ type: "text" as const, text: "Verdict rejected: validator session is not registered yet." }],
          details: {},
        };
      }

      const verdict: Omit<ValidationVerdict, "id" | "sessionId"> = {
        milestoneId: context.milestoneId,
        contractId: context.contractId,
        validatorType: context.validatorType,
        verdict: params.verdict as "pass" | "fail",
        findings: params.findings as string,
        failedUnitIds: Array.isArray(params.failedUnitIds)
          ? (params.failedUnitIds as string[])
          : [],
        timestamp: new Date().toISOString(),
      };

      const written = await lapis.writeVerdict(sessionId, verdict);

      return {
        content: [
          {
            type: "text" as const,
            text: `Verdict accepted: ${written.verdict}. Your validation result has been recorded.`,
          },
        ],
        details: { verdictId: written.id } as Record<string, unknown>,
      };
    },
  });

  return [writeVerdict];
}
