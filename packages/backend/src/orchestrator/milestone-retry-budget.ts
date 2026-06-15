export type StaleUnitResetPhase = "worker" | "validation";

export interface MilestoneRetryBudget {
  workerRetriesUsed: number;
  handoffRetriesUsed: number;
  workerStaleResetUsed: boolean;
  validationStaleResetUsed: boolean;
}

export function createRetryBudget(): MilestoneRetryBudget {
  return {
    workerRetriesUsed: 0,
    handoffRetriesUsed: 0,
    workerStaleResetUsed: false,
    validationStaleResetUsed: false,
  };
}

export function canRetryWorkers(budget: MilestoneRetryBudget, maxRetries = 1): boolean {
  return budget.workerRetriesUsed < maxRetries;
}

export function canRetryHandoffs(budget: MilestoneRetryBudget, maxRetries = 1): boolean {
  return budget.handoffRetriesUsed < maxRetries;
}

export function markWorkerRetry(budget: MilestoneRetryBudget): void {
  budget.workerRetriesUsed += 1;
}

export function markHandoffRetry(budget: MilestoneRetryBudget): void {
  budget.handoffRetriesUsed += 1;
}

export function canResetStaleUnits(budget: MilestoneRetryBudget, phase: StaleUnitResetPhase): boolean {
  return phase === "worker" ? !budget.workerStaleResetUsed : !budget.validationStaleResetUsed;
}

export function markStaleUnitReset(budget: MilestoneRetryBudget, phase: StaleUnitResetPhase): void {
  if (phase === "worker") {
    budget.workerStaleResetUsed = true;
    return;
  }
  budget.validationStaleResetUsed = true;
}
