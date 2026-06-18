import { describe, it, expect } from "vitest";
import {
  canRetryUnit,
  createRetryBudget,
  markUnitRetry,
} from "../src/orchestrator/milestone-retry-budget";

describe("milestone-retry-budget", () => {
  it("tracks retries per unit independently up to the budget", () => {
    const budget = createRetryBudget();
    expect(canRetryUnit(budget, "u-1")).toBe(true);
    expect(canRetryUnit(budget, "u-2")).toBe(true);

    markUnitRetry(budget, "u-1");
    expect(canRetryUnit(budget, "u-1")).toBe(true);
    expect(canRetryUnit(budget, "u-2")).toBe(true);

    markUnitRetry(budget, "u-1");
    expect(canRetryUnit(budget, "u-1")).toBe(false);
    expect(canRetryUnit(budget, "u-2")).toBe(true);
  });

  it("respects a custom max-retries budget", () => {
    const budget = createRetryBudget();
    expect(canRetryUnit(budget, "u-1", 1)).toBe(true);
    markUnitRetry(budget, "u-1");
    expect(canRetryUnit(budget, "u-1", 1)).toBe(false);
  });
});
