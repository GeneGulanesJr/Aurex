import { describe, it, expect } from "vitest";
import { scoreBand, bandColorVar, SCORE_BANDS } from "./mutation-score.js";

describe("scoreBand", () => {
  it("returns 'none' for null", () => {
    expect(scoreBand(null)).toBe("none");
  });

  it("returns 'high' for score >= SCORE_BANDS.HIGH", () => {
    expect(scoreBand(SCORE_BANDS.HIGH)).toBe("high");
    expect(scoreBand(87.5)).toBe("high");
    expect(scoreBand(100)).toBe("high");
  });

  it("returns 'medium' for score >= SCORE_BANDS.MEDIUM but < SCORE_BANDS.HIGH", () => {
    expect(scoreBand(SCORE_BANDS.MEDIUM)).toBe("medium");
    expect(scoreBand(70)).toBe("medium");
    expect(scoreBand(SCORE_BANDS.HIGH - 0.01)).toBe("medium");
  });

  it("returns 'low' for score < SCORE_BANDS.MEDIUM", () => {
    expect(scoreBand(0)).toBe("low");
    expect(scoreBand(47)).toBe("low");
    expect(scoreBand(SCORE_BANDS.MEDIUM - 0.01)).toBe("low");
  });
});

describe("bandColorVar", () => {
  it("returns success token for high", () => {
    expect(bandColorVar("high")).toBe("var(--success)");
  });

  it("returns warning token for medium", () => {
    expect(bandColorVar("medium")).toBe("var(--warning)");
  });

  it("returns error token for low", () => {
    expect(bandColorVar("low")).toBe("var(--error)");
  });

  it("returns muted text token for none", () => {
    expect(bandColorVar("none")).toBe("var(--text-muted)");
  });
});

describe("SCORE_BANDS", () => {
  it("uses the Stryker threshold defaults (80/60)", () => {
    expect(SCORE_BANDS.HIGH).toBe(80);
    expect(SCORE_BANDS.MEDIUM).toBe(60);
  });
});
