import { describe, it, expect } from "vitest";

/** Mirrors App.tsx rehydration decision for unit testing. */
export function shouldRunFreshReview(opts: {
  forceRescan?: boolean;
  freshIndex?: boolean;
}): boolean {
  return Boolean(opts.forceRescan || opts.freshIndex);
}

describe("review flow helpers", () => {
  it("runs fresh review on forceRescan", () => {
    expect(shouldRunFreshReview({ forceRescan: true })).toBe(true);
  });

  it("runs fresh review after fresh index", () => {
    expect(shouldRunFreshReview({ freshIndex: true })).toBe(true);
  });

  it("rehydrates cached review on normal prepare", () => {
    expect(shouldRunFreshReview({})).toBe(false);
  });
});
