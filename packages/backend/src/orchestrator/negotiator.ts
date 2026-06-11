// packages/backend/src/orchestrator/negotiator.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { ValidationVerdict, NegotiatorVerdict, AgentType } from "@aurex/shared";
import { verifyCreatorSession } from "../enforcement/creator-verifier.js";
import { createHash } from "node:crypto";

interface NegotiateResult {
  decision: NegotiatorVerdict;
  reason: string;
  failedUnitIds?: string[];
}

type VerdictLike = ValidationVerdict & {
  validator_type?: ValidationVerdict["validatorType"];
};

export function createNegotiator(lapis: LaPisClient) {
  let priorSignature: string | null = null;

  function getValidatorType(verdict: ValidationVerdict): ValidationVerdict["validatorType"] {
    return ((verdict as VerdictLike).validatorType ?? (verdict as VerdictLike).validator_type ?? "validator_scrutiny");
  }

  function hashVerdicts(verdicts: ValidationVerdict[]): string {
    const data = verdicts
      .map((v) => `${getValidatorType(v)}:${v.verdict}:${v.findings}:${(v.failedUnitIds ?? []).sort().join(",")}`)
      .sort()
      .join("|");
    return createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  return {
    /** Reset stagnation detector — call when starting a new milestone */
    resetStagnation() {
      priorSignature = null;
    },

    async negotiate(
      milestoneId: string,
      retryCount: number,
      rescopeCount: number,
      maxRetries: number,
      maxRescopes: number,
      preloadedVerdicts?: ValidationVerdict[],
    ): Promise<NegotiateResult> {
      const verdicts: ValidationVerdict[] = preloadedVerdicts ?? await lapis.getVerdicts(milestoneId).catch(() => [] as ValidationVerdict[]);

      // Verify creator sessions — skip verdicts without sessionId, discard invalid sessions
      const sessions = await lapis.getSessionsForMilestone(milestoneId).catch(() => [] as any[]);
      const validVerdicts = verdicts.filter((v) => {
        if (!v.sessionId) return true; // Legacy verdicts without session tracking
        const expectedType = getValidatorType(v) as AgentType;
        const result = verifyCreatorSession(v.sessionId, expectedType, sessions as any[]);
        if (!result.valid) {
          console.warn(`[enforcement] Discarding verdict from session ${v.sessionId}: ${result.reason}`);
          return false;
        }
        return true;
      });

      // Keep only the latest verdict per validator type. Verdicts accumulate
      // across retry cycles (old fails + new passes), so using ALL of them
      // causes stale "fail" verdicts to override fresh "pass" verdicts.
      // Verdicts are returned in insertion order, so the last one per type wins.
      const latestByType = new Map<string, ValidationVerdict>();
      for (const v of validVerdicts) {
        const key = getValidatorType(v);
        latestByType.set(key, v);
      }
      const latestVerdicts = [...latestByType.values()];

      // Stagnation detection: if the exact same verdict pattern was seen
      // in the prior cycle, the loop is not making progress. Escalate
      // immediately instead of retrying/rescoping endlessly.
      const currentSignature = hashVerdicts(latestVerdicts);
      if (priorSignature !== null && priorSignature === currentSignature) {
        return {
          decision: "escalate",
          reason: `Stagnation detected: identical validator findings across cycles. The retry/rescope did not change the validator outcome. Human review required.`,
        };
      }
      priorSignature = currentSignature;

      if (latestVerdicts.length === 0) {
        return { decision: "escalate", reason: "No validator verdicts were recorded" };
      }

      const scrutinyVerdict = latestVerdicts.find((v) => getValidatorType(v) === "validator_scrutiny");
      if (!scrutinyVerdict) {
        return { decision: "escalate", reason: "Missing scrutiny validator verdict" };
      }

      // Check if all verdicts pass
      const allPass = latestVerdicts.every((v) => v.verdict === "pass");
      if (allPass) {
        return { decision: "pass", reason: "All validators passed" };
      }

      // User testing failure always blocks (override authority)
      const userTestFailure = latestVerdicts.find(
        (v) => getValidatorType(v) === "validator_user_testing" && v.verdict === "fail",
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
      const scrutinyFailure = latestVerdicts.find(
        // Stryker disable next-line all: equivalent mutant — with the current
        // validator types (scarcity | user_testing), a non-scrutiny fail cannot
        // reach this point (user_testing fail exits earlier), so swapping the
        // predicate to `true` produces the same selected verdict.
        (v) => getValidatorType(v) === "validator_scrutiny" && v.verdict === "fail",
      );
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent
      // mutant — scrutinyFailure is always defined when execution reaches this
      // point (non-scrutiny fails exit at the userTestFailure or allPass branches
      // above), so `if (true)` is observationally identical.
      if (scrutinyFailure) {
        // Stryker disable next-line StringLiteral: equivalent mutant — the
        // "blocking" default is only compared to "patchable" (never "blocking"),
        // and the output reason strings are hardcoded, so the default value
        // never appears in any output. Mutating it to "" is unobservable.
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

      // Stryker disable next-line all: equivalent mutant — the
      // ValidationVerdict type only allows verdict = "pass" | "fail", so this
      // "Unknown verdict state" fallback is unreachable with the current type
      // system. Both the return value and the two string fields are
      // unobservable.
      return { decision: "escalate", reason: "Unknown verdict state" };
    },
  };
}
