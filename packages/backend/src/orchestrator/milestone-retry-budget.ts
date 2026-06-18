/**
 * Per-unit retry budget for the v1 sequential milestone loop (issue #119).
 *
 * The old budget tracked separate worker/handoff/stale-reset counters across
 * a whole milestone because workers ran in parallel batches and had to be
 * retried in groups. v1 runs one unit at a time on a shared feature branch,
 * so retry is inherently per-unit: a unit that fails its worker run or smoke
 * check is retried (with feedback) up to `maxRetries` times before the
 * milestone escalates to a human.
 */
export interface MilestoneRetryBudget {
  retriesByUnit: Map<string, number>;
}

export function createRetryBudget(): MilestoneRetryBudget {
  return { retriesByUnit: new Map() };
}

export function canRetryUnit(budget: MilestoneRetryBudget, unitId: string, maxRetries = 2): boolean {
  const used = budget.retriesByUnit.get(unitId) ?? 0;
  return used < maxRetries;
}

export function markUnitRetry(budget: MilestoneRetryBudget, unitId: string): void {
  budget.retriesByUnit.set(unitId, (budget.retriesByUnit.get(unitId) ?? 0) + 1);
}
