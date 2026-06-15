import { describe, it, expect } from "vitest";
import {
  canRetryHandoffs,
  canRetryWorkers,
  canResetStaleUnits,
  createRetryBudget,
  markHandoffRetry,
  markStaleUnitReset,
  markWorkerRetry,
} from "../src/orchestrator/milestone-retry-budget";

describe("milestone-retry-budget", () => {
  it("tracks worker and handoff retries independently", () => {
    const budget = createRetryBudget();
    expect(canRetryWorkers(budget)).toBe(true);
    expect(canRetryHandoffs(budget)).toBe(true);

    markWorkerRetry(budget);
    expect(canRetryWorkers(budget)).toBe(false);
    expect(canRetryHandoffs(budget)).toBe(true);

    markHandoffRetry(budget);
    expect(canRetryHandoffs(budget)).toBe(false);
  });

  it("tracks stale unit resets per phase", () => {
    const budget = createRetryBudget();
    expect(canResetStaleUnits(budget, "worker")).toBe(true);
    expect(canResetStaleUnits(budget, "validation")).toBe(true);

    markStaleUnitReset(budget, "worker");
    expect(canResetStaleUnits(budget, "worker")).toBe(false);
    expect(canResetStaleUnits(budget, "validation")).toBe(true);

    markStaleUnitReset(budget, "validation");
    expect(canResetStaleUnits(budget, "validation")).toBe(false);
  });
});
