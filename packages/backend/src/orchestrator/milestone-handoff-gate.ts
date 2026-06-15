import type { HandoffRecord } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import { validateHandoff } from "../enforcement/handoff-validator.js";
import type { ValidatorUnitContext } from "../agents/context-builder.js";

export interface ValidatorHandoffLoadResult {
  fetchFailed: boolean;
  fetchError?: string;
}

export interface HandoffGateResult {
  invalidUnitIds: string[];
  fetchFailed: boolean;
  fetchError?: string;
}

export async function resolveValidatorHandoffs(
  lapis: LaPisClient,
  milestoneId: string,
  validatorUnits: ValidatorUnitContext[],
): Promise<ValidatorHandoffLoadResult> {
  let handoffsByUnitId = new Map<string, HandoffRecord>();
  let fetchFailed = false;
  let fetchError: string | undefined;

  try {
    const handoffs = await lapis.getHandoffsForMilestone(milestoneId);
    handoffsByUnitId = new Map(handoffs.map((handoff) => [handoff.unitId, handoff]));
  } catch (err) {
    fetchFailed = true;
    fetchError = err instanceof Error ? err.message : String(err);
    console.error(`[enforcement] Failed to fetch handoffs for milestone ${milestoneId}:`, fetchError);
  }

  for (const unit of validatorUnits) {
    unit.handoff = handoffsByUnitId.get(unit.id);
  }

  if (!fetchFailed) {
    for (const unit of validatorUnits) {
      if (unit.handoff) continue;
      try {
        const handoff = await lapis.getHandoffForUnit(unit.id);
        if (handoff) unit.handoff = handoff;
      } catch (err) {
        console.warn(
          `[enforcement] Per-unit handoff fetch failed for unit ${unit.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { fetchFailed, fetchError };
}

export function validateWorkerHandoffs(
  validatorUnits: ValidatorUnitContext[],
  handoffLoad: ValidatorHandoffLoadResult,
): HandoffGateResult {
  const invalidUnitIds: string[] = [];

  for (const unit of validatorUnits) {
    let errors: string[];
    try {
      if (handoffLoad.fetchFailed) {
        errors = [`handoff fetch failed: ${handoffLoad.fetchError ?? "unknown error"}`];
      } else if (unit.handoff) {
        errors = validateHandoff(unit.handoff).errors;
      } else {
        errors = ["worker completed without submitting write_handoff"];
      }
    } catch (err) {
      errors = [`handoff validation threw: ${err instanceof Error ? err.message : String(err)}`];
    }

    if (errors.length > 0) {
      console.warn(`[enforcement] Invalid handoff for unit ${unit.id}:`, errors);
      invalidUnitIds.push(unit.id);
    }
  }

  return {
    invalidUnitIds,
    fetchFailed: handoffLoad.fetchFailed,
    fetchError: handoffLoad.fetchError,
  };
}
