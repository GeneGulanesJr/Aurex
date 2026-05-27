// packages/backend/src/orchestrator/negotiator.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { ValidationVerdict, NegotiatorVerdict } from "@aurex/shared";

interface NegotiateResult {
  decision: NegotiatorVerdict;
  reason: string;
  failedUnitIds?: string[];
}

export function createNegotiator(lapis: LaPisClient) {
  return {
    async negotiate(
      milestoneId: string,
      retryCount: number,
      rescopeCount: number,
      maxRetries: number,
      maxRescopes: number,
    ): Promise<NegotiateResult> {
      const verdicts: ValidationVerdict[] = await lapis.getVerdicts(milestoneId);

      if (verdicts.length === 0) {
        return { decision: "escalate", reason: "No validator verdicts were recorded" };
      }

      const scrutinyVerdict = verdicts.find((v) => v.validatorType === "validator_scrutiny");
      if (!scrutinyVerdict) {
        return { decision: "escalate", reason: "Missing scrutiny validator verdict" };
      }

      // Check if all verdicts pass
      const allPass = verdicts.every((v) => v.verdict === "pass");
      if (allPass) {
        return { decision: "pass", reason: "All validators passed" };
      }

      // User testing failure always blocks (override authority)
      const userTestFailure = verdicts.find(
        (v) => v.validatorType === "validator_user_testing" && v.verdict === "fail",
      );
      if (userTestFailure) {
        if (retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: "user_testing failed — always blocks",
            failedUnitIds: userTestFailure.failedUnitIds,
          };
        }
        if (rescopeCount < maxRescopes) {
          return {
            decision: "rescope",
            reason: "user_testing failed, retries exhausted — rescope needed",
          };
        }
        return { decision: "escalate", reason: "user_testing failed, all limits exhausted" };
      }

      // Scrutiny-only failure — classify
      const scrutinyFailure = verdicts.find(
        (v) => v.validatorType === "validator_scrutiny" && v.verdict === "fail",
      );
      if (scrutinyFailure) {
        const classification = scrutinyFailure.classification || "blocking";

        if (classification === "patchable" && retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: `scrutiny patchable: ${scrutinyFailure.findings}`,
            failedUnitIds: scrutinyFailure.failedUnitIds,
          };
        }

        if (retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: "scrutiny blocking — full retry",
            failedUnitIds: scrutinyFailure.failedUnitIds,
          };
        }

        if (rescopeCount < maxRescopes) {
          return { decision: "rescope", reason: "scrutiny failed, retries exhausted" };
        }

        return { decision: "escalate", reason: "scrutiny failed, all limits exhausted" };
      }

      return { decision: "escalate", reason: "Unknown verdict state" };
    },
  };
}
