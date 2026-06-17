import type { ValidationVerdict } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import { TOOL_CALL_CAP_EXCEEDED, type SpawnResult } from "../agents/agent-spawner.js";

export type ValidatorType = "validator_scrutiny" | "validator_user_testing";

export interface ValidatorRunResult {
  validatorType: ValidatorType;
  sessionId: string;
  result: SpawnResult;
}

export interface EnsureValidatorVerdictsResult {
  verdicts: ValidationVerdict[];
  runtimeFailures: string[];
}

export function selectValidatorTypes(
  acceptanceBehavior: string,
): ValidatorType[] {
  const types: ValidatorType[] = ["validator_scrutiny"];
  if (acceptanceBehavior.trim().length > 0 && acceptanceBehavior.trim().toLowerCase() !== "none") {
    types.push("validator_user_testing");
  }
  return types;
}

export async function ensureValidatorVerdicts(
  lapis: LaPisClient,
  milestoneId: string,
  contractId: string,
  validatorResults: ValidatorRunResult[],
): Promise<EnsureValidatorVerdictsResult> {
  const runtimeFailures: string[] = [];
  const runtimeFailureTypes = new Set<ValidatorType>();

  const recordRuntimeFailure = (validatorType: ValidatorType, message: string) => {
    if (runtimeFailureTypes.has(validatorType)) return;
    runtimeFailureTypes.add(validatorType);
    runtimeFailures.push(message);
  };

  const writeSyntheticValidatorVerdict = async (
    sessionId: string,
    validatorType: ValidatorType,
    findings: string,
  ) => {
    try {
      await lapis.writeVerdict(sessionId, {
        milestoneId,
        contractId,
        validatorType,
        verdict: "fail",
        findings,
        failedUnitIds: [],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[milestone-loop] Failed to write synthetic validator verdict:`, err instanceof Error ? err.message : err);
    }
  };

  let verdicts = await lapis.getVerdicts(milestoneId).catch(() => [] as ValidationVerdict[]);
  let wroteSyntheticMissingVerdict = false;
  const currentValidatorSessionIds = new Set(
    validatorResults.map((result) => result.sessionId).filter((sessionId) => sessionId.length > 0),
  );
  let currentRunVerdicts = verdicts.filter(
    (verdict) => verdict.sessionId && currentValidatorSessionIds.has(verdict.sessionId),
  );
  const verdictTypes = new Set(currentRunVerdicts.map((v) => v.validatorType ?? "validator_scrutiny"));

  for (const validatorResult of validatorResults) {
    if (verdictTypes.has(validatorResult.validatorType)) continue;

    let findings: string;
    if (validatorResult.result.status === "timed_out") {
      findings = `Validator auto-failed: timed out before calling write_verdict. The model may have continued gathering context, but it did not submit a formal verdict before the validator timeout.`;
      recordRuntimeFailure(
        validatorResult.validatorType,
        `${validatorResult.validatorType} timed out before submitting write_verdict.`,
      );
    } else if (validatorResult.result.status === "failed" && validatorResult.result.error?.includes(TOOL_CALL_CAP_EXCEEDED)) {
      findings = `Validator auto-failed: exceeded tool-call cap without producing a verdict. The model exhausted its configured tool-call budget.`;
      recordRuntimeFailure(
        validatorResult.validatorType,
        `${validatorResult.validatorType} exceeded the configured validator tool-call cap.`,
      );
    } else if (validatorResult.result.status === "failed") {
      findings = `Validator auto-failed: session failed before calling write_verdict. Error: ${validatorResult.result.error ?? "unknown error"}.`;
      recordRuntimeFailure(
        validatorResult.validatorType,
        `${validatorResult.validatorType} failed before submitting write_verdict.`,
      );
    } else {
      findings = `Validator completed session without calling write_verdict. The model finished its review but did not submit a formal verdict. This is a model compliance issue — the validator skill instructs using write_verdict exactly once.`;
      recordRuntimeFailure(
        validatorResult.validatorType,
        `${validatorResult.validatorType} completed without submitting write_verdict.`,
      );
    }

    await writeSyntheticValidatorVerdict(validatorResult.sessionId, validatorResult.validatorType, findings);
    wroteSyntheticMissingVerdict = true;
  }

  if (wroteSyntheticMissingVerdict) {
    verdicts = await lapis.getVerdicts(milestoneId).catch(() => [] as ValidationVerdict[]);
    currentRunVerdicts = verdicts.filter(
      (verdict) => verdict.sessionId && currentValidatorSessionIds.has(verdict.sessionId),
    );
  }

  return { verdicts: currentRunVerdicts, runtimeFailures };
}
