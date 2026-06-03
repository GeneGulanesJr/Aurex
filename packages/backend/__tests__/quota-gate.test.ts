import { describe, it, expect } from "vitest";
import {
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
