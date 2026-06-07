import { describe, it, expect } from "vitest";
import {
  validateQuotaDurations,
  createQuotaWindow,
  prefire,
  recordFirstLLMCall,
  checkQuota,
  getQuotaStatusDisplay,
  calculatePrefireTime,
  buildPrefireTimeline,
  resetWindow,
  getEffectiveProviderConfig,
  getProviderStatusDisplay,
  extractProviderIdFromModel,
  DEFAULT_WINDOW_DURATION_MS,
  DEFAULT_BURN_DURATION_MS,
} from "../src/enforcement/quota-gate.js";
import type { QuotaConfig } from "@aurex/shared";

const HOUR = 60 * 60 * 1000;

function dateAt(hour: number, minute = 0): Date {
  const d = new Date("2026-06-03T00:00:00Z");
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

describe("createQuotaWindow", () => {
  it("creates a window with default durations", () => {
    const now = new Date();
    const w = createQuotaWindow({ now });
    expect(w.windowDurationMs).toBe(DEFAULT_WINDOW_DURATION_MS);
    expect(w.burnDurationMs).toBe(DEFAULT_BURN_DURATION_MS);
    expect(w.windowStart).toBe(now.toISOString());
    expect(w.firstLLMCallAt).toBeNull();
    expect(w.isActive).toBe(false);
  });

  it("creates a window with custom durations", () => {
    const now = new Date();
    const w = createQuotaWindow({ windowDurationMs: 4 * HOUR, burnDurationMs: 2 * HOUR, now });
    expect(w.windowDurationMs).toBe(4 * HOUR);
    expect(w.burnDurationMs).toBe(2 * HOUR);
  });
});

describe("prefire", () => {
  it("creates a new window at the prefire time", () => {
    const now = dateAt(14, 0);
    const w = prefire(null, now);
    expect(w.windowStart).toBe(now.toISOString());
    expect(w.firstLLMCallAt).toBeNull();
  });

  it("replaces an existing window", () => {
    const existing = createQuotaWindow({ now: dateAt(10, 0) });
    existing.firstLLMCallAt = dateAt(10, 30).toISOString();
    const now = dateAt(14, 0);
    const w = prefire(existing, now);
    expect(w.windowStart).toBe(now.toISOString());
    expect(w.firstLLMCallAt).toBeNull();
  });

  it("inherits durations from existing window when not specified", () => {
    const existing = createQuotaWindow({ windowDurationMs: 3 * HOUR, burnDurationMs: 30 * 60 * 1000 });
    const w = prefire(existing, new Date());
    expect(w.windowDurationMs).toBe(3 * HOUR);
    expect(w.burnDurationMs).toBe(30 * 60 * 1000);
  });
});

describe("recordFirstLLMCall", () => {
  it("sets firstLLMCallAt on first call", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const callTime = dateAt(18, 0);
    const updated = recordFirstLLMCall(w, callTime);
    expect(updated.firstLLMCallAt).toBe(callTime.toISOString());
    expect(updated.isActive).toBe(true);
    expect(updated.lastActiveAt).toBe(callTime.toISOString());
  });

  it("does not overwrite existing firstLLMCallAt", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const first = recordFirstLLMCall(w, dateAt(18, 0));
    const second = recordFirstLLMCall(first, dateAt(18, 30));
    expect(second.firstLLMCallAt).toBe(dateAt(18, 0).toISOString());
  });
});

describe("checkQuota", () => {
  it("returns ok when no window exists (unlimited)", () => {
    const result = checkQuota(null, new Date());
    expect(result.ok).toBe(true);
    expect(result.remainingBurnMs).toBe(Infinity);
  });

  it("returns ok when window exists but no LLM call yet", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const result = checkQuota(w, dateAt(15, 0));
    expect(result.ok).toBe(true);
    expect(result.remainingBurnMs).toBe(DEFAULT_BURN_DURATION_MS);
  });

  it("returns ok within burn duration after first LLM call", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const result = checkQuota(withCall, dateAt(18, 30));
    expect(result.ok).toBe(true);
    expect(result.remainingBurnMs).toBe(30 * 60 * 1000);
  });

  it("returns not ok when burn duration exhausted (window still active)", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const result = checkQuota(withCall, dateAt(19, 0));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("quota_exhausted");
    expect(result.remainingBurnMs).toBe(0);
    const expectedReset = new Date(dateAt(14, 0).getTime() + 10 * HOUR);
    expect(result.windowResetsAt).toBe(expectedReset.toISOString());
  });

  it("auto-resets (returns ok with window_expired) when window duration passes", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const result = checkQuota(withCall, dateAt(19, 1));
    expect(result.reason).toBe("window_expired");
    expect(result.ok).toBe(true);
    expect(result.remainingBurnMs).toBe(DEFAULT_BURN_DURATION_MS);
  });

  it("returns not ok at exact burn duration boundary (window still active)", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const result = checkQuota(withCall, dateAt(19, 0));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("quota_exhausted");
  });

  it("returns ok 1ms before burn duration boundary", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const justBefore = new Date(dateAt(19, 0).getTime() - 1);
    const result = checkQuota(withCall, justBefore);
    expect(result.ok).toBe(true);
    expect(result.remainingBurnMs).toBe(1);
  });
});

describe("spec scenario: 2PM prefire, 6PM coding, 7PM reset", () => {
  it("full timeline from the user spec", () => {
    const burnDurationMs = HOUR;
    const windowDurationMs = 5 * HOUR;

    const prefireTime = dateAt(14, 0);
    const w = prefire(null, prefireTime, { windowDurationMs, burnDurationMs });
    expect(w.windowStart).toBe(prefireTime.toISOString());
    expect(w.firstLLMCallAt).toBeNull();

    const result1 = checkQuota(w, dateAt(15, 0));
    expect(result1.ok).toBe(true);

    const codingStart = dateAt(18, 0);
    const withCall = recordFirstLLMCall(w, codingStart);

    const result2 = checkQuota(withCall, dateAt(18, 30));
    expect(result2.ok).toBe(true);
    expect(result2.remainingBurnMs).toBe(30 * 60 * 1000);

    const result3 = checkQuota(withCall, dateAt(19, 0));
    expect(result3.ok).toBe(true);
    expect(result3.reason).toBe("window_expired");

    const result4 = checkQuota(withCall, dateAt(19, 1));
    expect(result4.reason).toBe("window_expired");
    expect(result4.ok).toBe(true);
  });
});

describe("calculatePrefireTime", () => {
  it("P = N + B - W: 6PM start, 1hr burn, 5hr window → 2PM prefire", () => {
    const desiredStart = dateAt(18, 0);
    const prefireTime = calculatePrefireTime(desiredStart, HOUR, 5 * HOUR);
    expect(prefireTime.getUTCHours()).toBe(14);
    expect(prefireTime.getUTCMinutes()).toBe(0);
  });

  it("P = N + B - W: 8PM start, 30min burn, 5hr window → 3:30PM prefire", () => {
    const desiredStart = dateAt(20, 0);
    const prefireTime = calculatePrefireTime(desiredStart, 30 * 60 * 1000, 5 * HOUR);
    expect(prefireTime.getUTCHours()).toBe(15);
    expect(prefireTime.getUTCMinutes()).toBe(30);
  });
});

describe("buildPrefireTimeline", () => {
  it("builds a 5-entry timeline", () => {
    const prefireTime = dateAt(14, 0);
    const desiredStart = dateAt(18, 0);
    const timeline = buildPrefireTimeline(prefireTime, desiredStart, HOUR, 5 * HOUR);
    expect(timeline).toHaveLength(5);
    expect(timeline[0].event).toContain("Prefire");
    expect(timeline[1].event).toContain("Start serious coding");
    expect(timeline[2].event).toContain("Burn first quota");
    expect(timeline[3].event).toContain("Burn duration ends");
    expect(timeline[4].event).toContain("Window resets");
  });
});

describe("resetWindow", () => {
  it("resets the window at the given time", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const reset = resetWindow(withCall, dateAt(19, 0));
    expect(reset.windowStart).toBe(dateAt(19, 0).toISOString());
    expect(reset.firstLLMCallAt).toBeNull();
    expect(reset.isActive).toBe(false);
  });
});

describe("getQuotaStatusDisplay", () => {
  it("returns disabled when not enabled", () => {
    const display = getQuotaStatusDisplay(null, new Date(), false);
    expect(display.enabled).toBe(false);
    expect(display.status).toBe("unlimited");
  });

  it("returns unlimited when enabled but no window", () => {
    const display = getQuotaStatusDisplay(null, new Date(), true);
    expect(display.enabled).toBe(true);
    expect(display.status).toBe("unlimited");
  });

  it("returns active when window has first LLM call and within burn", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const display = getQuotaStatusDisplay(withCall, dateAt(18, 30), true);
    expect(display.status).toBe("active");
    expect(display.remainingBurnMs).toBe(30 * 60 * 1000);
    expect(display.burnExpiresAt).toBe(dateAt(19, 0).toISOString());
  });

  it("returns exhausted when burn used up (window still active)", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const display = getQuotaStatusDisplay(withCall, dateAt(19, 0), true);
    expect(display.status).toBe("exhausted");
  });
});

describe("getEffectiveProviderConfig", () => {
  const baseConfig: QuotaConfig = {
    enabled: true,
    windowDurationMs: 5 * HOUR,
    burnDurationMs: HOUR,
    providers: [
      { providerId: "kilo", tracked: true, burnDurationMs: 2 * HOUR },
      { providerId: "zai", tracked: false },
    ],
  };

  it("returns tracked config for a tracked provider", () => {
    const result = getEffectiveProviderConfig(baseConfig, "kilo");
    expect(result.tracked).toBe(true);
    expect(result.burnDurationMs).toBe(2 * HOUR);
    expect(result.windowDurationMs).toBe(5 * HOUR);
  });

  it("returns untracked for an untracked provider", () => {
    const result = getEffectiveProviderConfig(baseConfig, "zai");
    expect(result.tracked).toBe(false);
  });

  it("returns untracked for an unknown provider", () => {
    const result = getEffectiveProviderConfig(baseConfig, "unknown");
    expect(result.tracked).toBe(false);
  });

  it("uses global defaults when provider has no overrides", () => {
    const config: QuotaConfig = {
      enabled: true,
      windowDurationMs: 4 * HOUR,
      burnDurationMs: 30 * 60 * 1000,
      providers: [{ providerId: "kilo", tracked: true }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.tracked).toBe(true);
    expect(result.windowDurationMs).toBe(4 * HOUR);
    expect(result.burnDurationMs).toBe(30 * 60 * 1000);
  });
});

describe("getProviderStatusDisplay", () => {
  it("returns unlimited when global is disabled", () => {
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: HOUR },
      null,
      false,
      new Date(),
    );
    expect(status.enabled).toBe(false);
    expect(status.status).toBe("unlimited");
    expect(status.providerId).toBe("kilo");
  });

  it("returns unlimited when provider is untracked", () => {
    const status = getProviderStatusDisplay(
      "zai",
      { tracked: false, windowDurationMs: 5 * HOUR, burnDurationMs: HOUR },
      null,
      true,
      new Date(),
    );
    expect(status.enabled).toBe(false);
    expect(status.tracked).toBe(false);
  });

  it("returns active with no window when enabled+tracked but no window", () => {
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: HOUR },
      null,
      true,
      new Date(),
    );
    expect(status.enabled).toBe(true);
    expect(status.status).toBe("active");
    expect(status.windowStart).toBeNull();
  });

  it("returns active within burn", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: HOUR },
      withCall,
      true,
      dateAt(18, 30),
    );
    expect(status.status).toBe("active");
    expect(status.remainingBurnMs).toBe(30 * 60 * 1000);
    expect(status.burnExpiresAt).toBe(dateAt(19, 0).toISOString());
  });

  it("returns exhausted when burn used up", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 10 * HOUR, burnDurationMs: HOUR },
      withCall,
      true,
      dateAt(19, 0),
    );
    expect(status.status).toBe("exhausted");
  });
});

describe("extractProviderIdFromModel", () => {
  it("extracts provider from 'kilo/kilo-auto/free'", () => {
    expect(extractProviderIdFromModel("kilo/kilo-auto/free")).toBe("kilo");
  });

  it("extracts provider from 'zai/glm-5'", () => {
    expect(extractProviderIdFromModel("zai/glm-5")).toBe("zai");
  });

  it("returns full string when no slash", () => {
    expect(extractProviderIdFromModel("default")).toBe("default");
  });
});

// ============================================================================
// Mutation testing additions — kills surviving and NoCoverage mutants.
// ============================================================================

describe("validateQuotaDurations", () => {
  // Kills ~13 NoCoverage mutants on L28-L31. The function was never called
  // by any test, so all its branches were completely untested.
  it("accepts valid positive durations where burn < window", () => {
    expect(validateQuotaDurations(5 * HOUR, 1 * HOUR)).toBe(true);
  });

  it("accepts burn exactly equal to window (boundary)", () => {
    // Kills `burnDurationMs < windowDurationMs` off-by-one mutant
    expect(validateQuotaDurations(5 * HOUR, 5 * HOUR)).toBe(true);
  });

  it("rejects zero window duration", () => {
    // Kills `windowDurationMs > 0` → `>= 0` mutant
    expect(validateQuotaDurations(0, 1 * HOUR)).toBe(false);
  });

  it("rejects negative window duration", () => {
    expect(validateQuotaDurations(-1, 1 * HOUR)).toBe(false);
  });

  it("rejects NaN window duration", () => {
    expect(validateQuotaDurations(NaN, 1 * HOUR)).toBe(false);
  });

  it("rejects Infinity window duration", () => {
    expect(validateQuotaDurations(Infinity, 1 * HOUR)).toBe(false);
  });

  it("rejects zero burn duration", () => {
    // Kills `burnDurationMs > 0` → `>= 0` mutant
    expect(validateQuotaDurations(5 * HOUR, 0)).toBe(false);
  });

  it("rejects negative burn duration", () => {
    expect(validateQuotaDurations(5 * HOUR, -1)).toBe(false);
  });

  it("rejects NaN burn duration", () => {
    expect(validateQuotaDurations(5 * HOUR, NaN)).toBe(false);
  });

  it("rejects burn duration greater than window duration", () => {
    // Kills `burnDurationMs <= windowDurationMs` → `<` mutant
    expect(validateQuotaDurations(1 * HOUR, 5 * HOUR)).toBe(false);
  });

  it("rejects when both durations are invalid", () => {
    expect(validateQuotaDurations(0, 0)).toBe(false);
  });

  it("rejects windowDurationMs of exactly 0 (kills >= 0 off-by-one)", () => {
    // Direct assertion on the `> 0` vs `>= 0` boundary.
    // With the mutant `>= 0`, this returns true; original returns false.
    const result = validateQuotaDurations(0, 1 * HOUR);
    expect(result).toBe(false);
  });

  it("rejects burnDurationMs of exactly 0 (kills >= 0 off-by-one)", () => {
    const result = validateQuotaDurations(5 * HOUR, 0);
    expect(result).toBe(false);
  });

  it("accepts windowDurationMs of exactly 1ms (smallest positive)", () => {
    // Boundary: 1ms is > 0, so valid. With mutant `> 1`, would be false.
    expect(validateQuotaDurations(1, 1)).toBe(true);
  });
});

describe("createQuotaWindow with no opts", () => {
  // Kills L39, L42, L43 OptionalChaining mutants. With the mutants,
  // calling createQuotaWindow() with no argument would throw because
  // opts would be undefined and opts.now / opts.windowDurationMs / etc.
  // would throw a TypeError.
  it("works when called with no argument", () => {
    const w = createQuotaWindow();
    expect(w.windowDurationMs).toBe(DEFAULT_WINDOW_DURATION_MS);
    expect(w.burnDurationMs).toBe(DEFAULT_BURN_DURATION_MS);
    expect(w.firstLLMCallAt).toBeNull();
  });

  it("uses current time as windowStart when no opts provided", () => {
    const before = Date.now();
    const w = createQuotaWindow();
    const after = Date.now();
    const startMs = new Date(w.windowStart).getTime();
    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(after);
  });
});

describe("prefire isActive", () => {
  // Kills L60:15 BooleanLiteral false → true. The mutant would set
  // isActive: true on a freshly prefired window.
  it("sets isActive to false in new prefire window", () => {
    const w = prefire(null, dateAt(14, 0));
    expect(w.isActive).toBe(false);
  });
});

describe("checkQuota boundary conditions (no LLM call)", () => {
  // Kills L87 mutants: `elapsedWindowMs >= window.windowDurationMs` → `true`,
  // `false`, `>`, `<`. These are the off-by-one and boundary mutants on
  // the window-expired check when firstLLMCallAt is null.
  it("returns window_expired at exact window boundary (1ms past)", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    // 1 hour + 1ms past window start
    const justPast = new Date(dateAt(14, 0).getTime() + HOUR + 1);
    const result = checkQuota(w, justPast);
    expect(result.reason).toBe("window_expired");
    expect(result.ok).toBe(true);
  });

  it("returns window_expired well past window boundary", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const way = new Date(dateAt(14, 0).getTime() + 2 * HOUR);
    const result = checkQuota(w, way);
    expect(result.reason).toBe("window_expired");
  });

  it("returns ok at exact window boundary (1ms before)", () => {
    // At elapsedWindowMs == windowDurationMs, the `>=` is true (expired).
    // At 1ms before, elapsed < windowDurationMs, so ok (not expired).
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const justBefore = new Date(dateAt(14, 0).getTime() + HOUR - 1);
    const result = checkQuota(w, justBefore);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns remainingWindowMs = full window duration when window has expired (no LLM call)", () => {
    // When the window has expired and no LLM call was made, the result
    // returns the full window duration (as if the window just reset).
    // This kills L84:29 Math.max → Math.min mutant — with Math.min(0, ...),
    // the result would be the negative difference.
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const way = new Date(dateAt(14, 0).getTime() + 2 * HOUR);
    const result = checkQuota(w, way);
    expect(result.remainingWindowMs).toBe(HOUR);
  });

  it("returns correct remainingWindowMs at midpoint", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const mid = new Date(dateAt(14, 0).getTime() + 30 * 60 * 1000);
    const result = checkQuota(w, mid);
    expect(result.remainingWindowMs).toBe(30 * 60 * 1000);
  });

  it("returns window_expired at EXACT boundary (elapsed == windowDurationMs)", () => {
    // Kills L87:9 `elapsedWindowMs > window.windowDurationMs` off-by-one.
    // At exact equality, `>=` fires (expired) but `>` does not.
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const exactBoundary = new Date(dateAt(14, 0).getTime() + HOUR);
    const result = checkQuota(w, exactBoundary);
    expect(result.reason).toBe("window_expired");
  });
});

describe("getQuotaStatusDisplay", () => {
  // Kills L168, L170, L175, L179, L186, L192 mutants + NoCoverage mutants
  // on L175, L181, L182.
  it("returns status 'window_expired' when checkQuota returns window_expired", () => {
    // Kills L175:7 (condition → false) and L176:14 (status string → "")
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const way = new Date(dateAt(14, 0).getTime() + 2 * HOUR);
    const display = getQuotaStatusDisplay(w, way, true);
    expect(display.status).toBe("window_expired");
  });

  it("returns status 'exhausted' when quota is exhausted (burn done, window alive)", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const result = checkQuota(withCall, dateAt(19, 0));
    expect(result.reason).toBe("quota_exhausted");
    const display = getQuotaStatusDisplay(withCall, dateAt(19, 0), true);
    expect(display.status).toBe("exhausted");
  });

  it("returns status 'active' when firstLLMCallAt is set and within burn", () => {
    // Kills L179 mutants: condition → true, false, === null
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const display = getQuotaStatusDisplay(withCall, dateAt(18, 30), true);
    expect(display.status).toBe("active");
  });

  it("returns status 'active' when firstLLMCallAt is null and window not expired", () => {
    // Kills L186 mutants: else if (true) — would skip the else branch
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const display = getQuotaStatusDisplay(w, dateAt(15, 0), true);
    expect(display.status).toBe("active");
  });

  it("computes correct windowEnd from windowStart + windowDurationMs", () => {
    // Kills L168:30 ArithmeticOperator (+ → -) mutant
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 3 * HOUR });
    const display = getQuotaStatusDisplay(w, dateAt(14, 0), true);
    const expectedEnd = new Date(dateAt(14, 0).getTime() + 3 * HOUR).toISOString();
    expect(display.windowEnd).toBe(expectedEnd);
  });

  it("computes correct elapsedWindowMs as nowMs - windowStartMs", () => {
    // Kills L170:27 ArithmeticOperator (- → +) mutant.
    // The mutant would make elapsedWindowMs = nowMs + windowStartMs,
    // which is a huge positive number, causing remainingWindowMs to
    // be clamped to 0 immediately.
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const display = getQuotaStatusDisplay(w, dateAt(15, 0), true);
    // 1 hour elapsed, 4 hours remaining in default 5-hour window
    expect(display.remainingWindowMs).toBe(4 * HOUR);
  });

  it("returns enabled: true in the active window return", () => {
    // Kills L193:14 BooleanLiteral true → false in getQuotaStatusDisplay
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const display = getQuotaStatusDisplay(withCall, dateAt(18, 30), true);
    expect(display.enabled).toBe(true);
  });

  it("includes burnExpiresAt when firstLLMCallAt is set", () => {
    // Kills L229 NoCoverage mutants on the burnExpiresAt computation
    const w = createQuotaWindow({ now: dateAt(14, 0), burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const display = getQuotaStatusDisplay(withCall, dateAt(18, 30), true);
    const expected = new Date(dateAt(18, 0).getTime() + HOUR).toISOString();
    expect(display.burnExpiresAt).toBe(expected);
  });

  it("includes null burnExpiresAt when firstLLMCallAt is null", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const display = getQuotaStatusDisplay(w, dateAt(15, 0), true);
    expect(display.burnExpiresAt).toBeNull();
  });
});

describe("calculatePrefireTime", () => {
  // Kills L212, L214 mutants + NoCoverage mutants on L214
  it("returns desiredStart when burn duration >= window duration", () => {
    // Kills L212:7 condition → false mutant
    const desired = dateAt(18, 0);
    const result = calculatePrefireTime(desired, 5 * HOUR, 5 * HOUR);
    expect(result.getTime()).toBe(desired.getTime());
  });

  it("returns desiredStart when burn > window", () => {
    const desired = dateAt(18, 0);
    const result = calculatePrefireTime(desired, 10 * HOUR, 5 * HOUR);
    expect(result.getTime()).toBe(desired.getTime());
  });

  it("returns prefire time when burn < window and not in the past", () => {
    // offset = burnDurationMs - windowDurationMs = 1hr - 5hr = -4hr
    // prefire = desiredStart - 4hr
    const desired = dateAt(18, 0);
    const result = calculatePrefireTime(desired, 1 * HOUR, 5 * HOUR);
    const expected = new Date(desired.getTime() - 4 * HOUR);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("clamps to now when prefire time would be in the past", () => {
    // Kills L214:14 mutants (condition, <, <=, >=)
    const desired = dateAt(18, 0);
    const now = dateAt(20, 0); // 2 hours after desired
    const result = calculatePrefireTime(desired, 1 * HOUR, 5 * HOUR, now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it("does NOT clamp when prefire time is exactly now", () => {
    // Kills L214:14 `<` → `<=` mutant. At exact boundary, `<` is false
    // (so the clamp doesn't fire), but `<=` is true (so it does clamp).
    const desired = dateAt(18, 0);
    const prefireMs = desired.getTime() - 4 * HOUR;
    const now = new Date(prefireMs); // exactly at prefire time
    const result = calculatePrefireTime(desired, 1 * HOUR, 5 * HOUR, now);
    expect(result.getTime()).toBe(prefireMs);
  });

  it("does NOT clamp when prefire time is 1ms in the future relative to now", () => {
    // Kills L214:14 ConditionalExpression → true mutant. With the mutant,
    // the condition always fires, so it always clamps to now even when
    // the prefire time is in the future.
    const desired = dateAt(18, 0);
    const prefireMs = desired.getTime() - 4 * HOUR; // 2PM
    const now = new Date(prefireMs - 60 * 1000); // 1 minute before prefire
    const result = calculatePrefireTime(desired, 1 * HOUR, 5 * HOUR, now);
    expect(result.getTime()).toBe(prefireMs);
  });

  it("clamps to now when prefire time is 1ms in the past relative to now", () => {
    // Kills L214:14 EqualityOperator `<` → `<=` mutant. At exact boundary
    // (prefire == now), `<` is false (no clamp), `<=` is true (clamp).
    // 1ms past boundary: `<` is true (clamp), `<=` is also true (clamp).
    // This test ensures the clamp fires when prefire is 1ms past now.
    const desired = dateAt(18, 0);
    const prefireMs = desired.getTime() - 4 * HOUR; // 2PM
    const now = new Date(prefireMs + 1); // 1ms after prefire
    const result = calculatePrefireTime(desired, 1 * HOUR, 5 * HOUR, now);
    expect(result.getTime()).toBe(now.getTime());
  });
});

describe("buildPrefireTimeline", () => {
  // Kills L224, L225, L229 mutants
  it("returns exactly 5 timeline events", () => {
    const prefire = dateAt(14, 0);
    const desired = dateAt(18, 0);
    const timeline = buildPrefireTimeline(prefire, desired, 1 * HOUR, 5 * HOUR);
    expect(timeline).toHaveLength(5);
  });

  it("first event is the prefire time with correct label", () => {
    // Kills L229:13 StringLiteral → "" mutant
    const prefire = dateAt(14, 0);
    const desired = dateAt(18, 0);
    const timeline = buildPrefireTimeline(prefire, desired, 1 * HOUR, 5 * HOUR);
    expect(timeline[0].time).toBe(prefire.toISOString());
    expect(timeline[0].event).toBe("Prefire / start 5-hour timer");
  });

  it("computes burnEnd as desiredStart + burnDurationMs", () => {
    // Kills L224:28 ArithmeticOperator (+ → -) mutant
    const prefire = dateAt(14, 0);
    const desired = dateAt(18, 0);
    const timeline = buildPrefireTimeline(prefire, desired, 1 * HOUR, 5 * HOUR);
    const expectedBurnEnd = new Date(desired.getTime() + 1 * HOUR).toISOString();
    expect(timeline[3].time).toBe(expectedBurnEnd);
  });

  it("computes windowEnd as prefireTime + windowDurationMs", () => {
    // Kills L225:30 ArithmeticOperator (+ → -) mutant
    const prefire = dateAt(14, 0);
    const desired = dateAt(18, 0);
    const timeline = buildPrefireTimeline(prefire, desired, 1 * HOUR, 5 * HOUR);
    const expectedWindowEnd = new Date(prefire.getTime() + 5 * HOUR).toISOString();
    expect(timeline[4].time).toBe(expectedWindowEnd);
  });
});

describe("getEffectiveProviderConfig", () => {
  // Kills L293:16 BooleanLiteral true → false mutant
  const baseConfig: QuotaConfig = {
    enabled: true,
    windowDurationMs: 5 * HOUR,
    burnDurationMs: 1 * HOUR,
    providers: [],
  };

  it("returns tracked: true for a tracked provider", () => {
    const config: QuotaConfig = {
      ...baseConfig,
      providers: [{ providerId: "kilo", tracked: true }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.tracked).toBe(true);
  });

  it("returns tracked: false for an untracked provider", () => {
    const config: QuotaConfig = {
      ...baseConfig,
      providers: [{ providerId: "kilo", tracked: false }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.tracked).toBe(false);
  });

  it("returns tracked: false for an unknown provider", () => {
    const result = getEffectiveProviderConfig(baseConfig, "unknown");
    expect(result.tracked).toBe(false);
  });

  it("uses provider windowDurationMs when set", () => {
    const config: QuotaConfig = {
      ...baseConfig,
      providers: [{ providerId: "kilo", tracked: true, windowDurationMs: 10 * HOUR }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.windowDurationMs).toBe(10 * HOUR);
  });

  it("uses provider burnDurationMs when set", () => {
    const config: QuotaConfig = {
      ...baseConfig,
      providers: [{ providerId: "kilo", tracked: true, burnDurationMs: 30 * 60 * 1000 }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.burnDurationMs).toBe(30 * 60 * 1000);
  });

  it("falls back to config windowDurationMs when provider has no override", () => {
    const config: QuotaConfig = {
      ...baseConfig,
      providers: [{ providerId: "kilo", tracked: true }],
    };
    const result = getEffectiveProviderConfig(config, "kilo");
    expect(result.windowDurationMs).toBe(5 * HOUR);
  });
});

describe("getProviderStatusDisplay", () => {
  // Kills L308, L312, L321, L328, L329 mutants + NoCoverage mutants
  it("returns status 'window_expired' when window has expired", () => {
    // Kills L312:7 (condition → false) and L313:14 (status string → "")
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: HOUR });
    const way = new Date(dateAt(14, 0).getTime() + 2 * HOUR);
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: HOUR, burnDurationMs: HOUR },
      w,
      true,
      way,
    );
    expect(status.status).toBe("window_expired");
  });

  it("returns status 'exhausted' when quota is exhausted", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 10 * HOUR, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 10 * HOUR, burnDurationMs: HOUR },
      withCall,
      true,
      dateAt(19, 0),
    );
    expect(status.status).toBe("exhausted");
  });

  it("returns status 'active' for valid window with firstLLMCallAt", () => {
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      withCall,
      true,
      dateAt(18, 30),
    );
    expect(status.status).toBe("active");
  });

  it("computes correct windowEnd from windowStart + windowDurationMs", () => {
    // Kills L308:30 ArithmeticOperator (+ → -) mutant
    const w = createQuotaWindow({ now: dateAt(14, 0), windowDurationMs: 3 * HOUR });
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 3 * HOUR, burnDurationMs: 1 * HOUR },
      w,
      true,
      dateAt(14, 0),
    );
    const expectedEnd = new Date(dateAt(14, 0).getTime() + 3 * HOUR).toISOString();
    expect(status.windowEnd).toBe(expectedEnd);
  });

  it("returns tracked: true, enabled: true for tracked provider with global enabled", () => {
    // Kills L328:14, L329:14 BooleanLiteral true → false mutants
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      null,
      true,
      new Date(),
    );
    expect(status.tracked).toBe(true);
    expect(status.enabled).toBe(true);
  });

  it("returns tracked: true, enabled: false when global is disabled", () => {
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      null,
      false,
      new Date(),
    );
    expect(status.tracked).toBe(true);
    expect(status.enabled).toBe(false);
    expect(status.status).toBe("unlimited");
  });

  it("returns status 'active' for valid window without firstLLMCallAt", () => {
    // Kills L321:7 (else if true → always enter) mutant
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      w,
      true,
      dateAt(15, 0),
    );
    expect(status.status).toBe("active");
  });

  it("returns tracked: true in the active window return object", () => {
    // Kills L328:14 BooleanLiteral true → false mutant
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      withCall,
      true,
      dateAt(18, 30),
    );
    expect(status.tracked).toBe(true);
  });

  it("returns enabled: true in the active window return object", () => {
    // Kills L329:14 BooleanLiteral true → false mutant
    const w = createQuotaWindow({ now: dateAt(14, 0) });
    const withCall = recordFirstLLMCall(w, dateAt(18, 0));
    const status = getProviderStatusDisplay(
      "kilo",
      { tracked: true, windowDurationMs: 5 * HOUR, burnDurationMs: 1 * HOUR },
      withCall,
      true,
      dateAt(18, 30),
    );
    expect(status.enabled).toBe(true);
  });
});
