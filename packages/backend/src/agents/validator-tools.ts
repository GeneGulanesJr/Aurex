// packages/backend/src/agents/validator-tools.ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface ValidatorToolContext {
  milestoneId: string;
  contractId: string;
  validatorType: "validator_scrutiny" | "validator_user_testing";
  sessionId: string;
}

export function createValidatorTools(lapis: LaPisClient, ctx: ValidatorToolContext) {
  const writeVerdict = defineTool({
    name: "write_verdict",
    label: "Write Verdict",
    description:
      "Submit your validation verdict. You must evaluate the implementation against the validation contract and report pass or fail with detailed findings.",
    parameters: Type.Object({
      verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail")], {
        description: "Your verdict: pass or fail",
      }),
      findings: Type.String({
        description: "Detailed explanation of your evaluation. For failures, explain what is wrong and why.",
      }),
      failedUnitIds: Type.String({
        description: 'JSON array of working unit IDs that failed. Use "[]" if all passed.',
      }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      let failedUnitIds: string[];
      try {
        failedUnitIds = JSON.parse(params.failedUnitIds as string);
        if (!Array.isArray(failedUnitIds)) failedUnitIds = [];
      } catch {
        failedUnitIds = [];
      }

      await lapis.writeVerdict(ctx.sessionId, {
        milestoneId: ctx.milestoneId,
        contractId: ctx.contractId,
        validatorType: ctx.validatorType,
        verdict: params.verdict as "pass" | "fail",
        findings: params.findings as string,
        failedUnitIds,
        timestamp: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Verdict (${params.verdict}) accepted and recorded.`,
          },
        ],
        details: {},
      };
    },
  });

  return [writeVerdict];
}
