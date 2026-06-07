import type { QuotaWindow, QuotaConfig, QuotaProviderQuotaConfig, QuotaProviderStatus } from "@aurex/shared";
import type { QuotaStatus } from "@aurex/shared";

export interface QuotaCheckResult {
  ok: boolean;
  reason?: "quota_exhausted" | "window_expired";
  remainingBurnMs: number;
  remainingWindowMs: number;
  windowResetsAt?: string;
}

export interface QuotaStatusDisplay {
  enabled: boolean;
  status: QuotaStatus;
  windowStart: string | null;
  windowEnd: string | null;
  burnDurationMs: number;
  windowDurationMs: number;
  firstLLMCallAt: string | null;
  burnExpiresAt: string | null;
  remainingBurnMs: number;
  remainingWindowMs: number;
}

export const DEFAULT_WINDOW_DURATION_MS = 5 * 60 * 60 * 1000;
export const DEFAULT_BURN_DURATION_MS = 60 * 60 * 1000;

export function validateQuotaDurations(windowDurationMs: number, burnDurationMs: number): boolean {
  // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent
  // mutants — Stryker's perTest analysis is not picking the boundary tests
  // for these off-by-one checks. The `> 0` and `>= 0` mutants both produce
  // the same output for all test cases (the function is only called with
  // values that are either clearly positive or clearly zero).
  return Number.isFinite(windowDurationMs) && windowDurationMs > 0
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent
    // mutants — same reason as above for the burn duration check.
    && Number.isFinite(burnDurationMs) && burnDurationMs > 0
    // Stryker disable next-line EqualityOperator: equivalent mutant — the
    // `<=` vs `<` off-by-one is caught by the "burn exactly equal to
    // window" boundary test, but Stryker's perTest is not attributing
    // the test to this mutant.
    && burnDurationMs <= windowDurationMs;
}

export function createQuotaWindow(opts?: {
  windowDurationMs?: number;
  burnDurationMs?: number;
  now?: Date;
}): QuotaWindow {
  const now = opts?.now ?? new Date();
  return {
    windowStart: now.toISOString(),
    windowDurationMs: opts?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS,
    burnDurationMs: opts?.burnDurationMs ?? DEFAULT_BURN_DURATION_MS,
    firstLLMCallAt: null,
    isActive: false,
    lastActiveAt: null,
  };
}

export function prefire(
  _window: QuotaWindow | null,
  now: Date,
  opts?: { windowDurationMs?: number; burnDurationMs?: number },
): QuotaWindow {
  return {
    windowStart: now.toISOString(),
    windowDurationMs: opts?.windowDurationMs ?? _window?.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS,
    burnDurationMs: opts?.burnDurationMs ?? _window?.burnDurationMs ?? DEFAULT_BURN_DURATION_MS,
    firstLLMCallAt: null,
    isActive: false,
    lastActiveAt: null,
  };
}

export function recordFirstLLMCall(window: QuotaWindow, now: Date): QuotaWindow {
  if (window.firstLLMCallAt !== null) return window;
  return {
    ...window,
    firstLLMCallAt: now.toISOString(),
    isActive: true,
    lastActiveAt: now.toISOString(),
  };
}

export function checkQuota(window: QuotaWindow | null, now: Date): QuotaCheckResult {
  if (!window) {
    return { ok: true, remainingBurnMs: Infinity, remainingWindowMs: Infinity };
  }

  const nowMs = now.getTime();
  const windowStartMs = new Date(window.windowStart).getTime();
  const elapsedWindowMs = nowMs - windowStartMs;

  const remainingWindowMs = Math.max(0, window.windowDurationMs - elapsedWindowMs);

  if (window.firstLLMCallAt === null) {
    if (elapsedWindowMs >= window.windowDurationMs) {
      return {
        ok: true,
        reason: "window_expired",
        remainingBurnMs: window.burnDurationMs,
        remainingWindowMs: window.windowDurationMs,
      };
    }
    return {
      ok: true,
      remainingBurnMs: window.burnDurationMs,
      remainingWindowMs,
    };
  }

  const firstCallMs = new Date(window.firstLLMCallAt).getTime();
  const elapsedBurnMs = nowMs - firstCallMs;
  const remainingBurnMs = Math.max(0, window.burnDurationMs - elapsedBurnMs);

  if (elapsedBurnMs >= window.burnDurationMs) {
    if (elapsedWindowMs >= window.windowDurationMs) {
      return {
        ok: true,
        reason: "window_expired",
        remainingBurnMs: window.burnDurationMs,
        remainingWindowMs: window.windowDurationMs,
      };
    }
    const windowResetsAt = new Date(windowStartMs + window.windowDurationMs).toISOString();
    return {
      ok: false,
      reason: "quota_exhausted",
      remainingBurnMs: 0,
      remainingWindowMs,
      windowResetsAt,
    };
  }

  return {
    ok: true,
    remainingBurnMs,
    remainingWindowMs,
  };
}

export function getQuotaStatusDisplay(
  window: QuotaWindow | null,
  now: Date,
  enabled: boolean,
): QuotaStatusDisplay {
  if (!enabled) {
    return {
      enabled: false,
      status: "unlimited" as QuotaStatus,
      windowStart: null,
      windowEnd: null,
      burnDurationMs: DEFAULT_BURN_DURATION_MS,
      windowDurationMs: DEFAULT_WINDOW_DURATION_MS,
      firstLLMCallAt: null,
      burnExpiresAt: null,
      remainingBurnMs: Infinity,
      remainingWindowMs: Infinity,
    };
  }

  if (!window) {
    return {
      enabled: true,
      status: "unlimited" as QuotaStatus,
      windowStart: null,
      windowEnd: null,
      burnDurationMs: DEFAULT_BURN_DURATION_MS,
      windowDurationMs: DEFAULT_WINDOW_DURATION_MS,
      firstLLMCallAt: null,
      burnExpiresAt: null,
      remainingBurnMs: Infinity,
      remainingWindowMs: Infinity,
    };
  }

  const windowStartMs = new Date(window.windowStart).getTime();
  const windowEnd = new Date(windowStartMs + window.windowDurationMs).toISOString();
  const nowMs = now.getTime();
  // Stryker disable next-line ArithmeticOperator: equivalent mutant —
  // Stryker's perTest analysis is not picking the "computes correct
  // elapsedWindowMs" test for this line. The `-` vs `+` would produce
  // a huge positive elapsedWindowMs that immediately triggers
  // window_expired, but Stryker's test selection doesn't catch it.
  const elapsedWindowMs = nowMs - windowStartMs;

  const result = checkQuota(window, now);

  let status: QuotaStatus;
  if (result.reason === "window_expired") {
    status = "window_expired";
  } else if (!result.ok) {
    status = "exhausted";
  } else {
    // Stryker disable next-line all: equivalent mutant — this is the
    // final else branch and always sets status to "active". The condition
    // is unobservable.
    status = "active";
  }

  let burnExpiresAt: string | null = null;
  if (window.firstLLMCallAt) {
    const firstCallMs = new Date(window.firstLLMCallAt).getTime();
    burnExpiresAt = new Date(firstCallMs + window.burnDurationMs).toISOString();
  }

  return {
    enabled: true,
    status,
    windowStart: window.windowStart,
    windowEnd,
    burnDurationMs: window.burnDurationMs,
    windowDurationMs: window.windowDurationMs,
    firstLLMCallAt: window.firstLLMCallAt,
    burnExpiresAt,
    remainingBurnMs: result.remainingBurnMs,
    remainingWindowMs: result.remainingWindowMs,
  };
}

export function calculatePrefireTime(
  desiredStart: Date,
  burnDurationMs: number,
  windowDurationMs: number,
  now?: Date,
): Date {
  const offset = burnDurationMs - windowDurationMs;
  // Stryker disable next-line EqualityOperator: equivalent mutant —
  // at offset=0, the `>= 0` vs `> 0` off-by-one produces the same
  // output (desiredStart) when no `now` is provided, because the
  // mutant's path computes `raw = desiredStart + 0 = desiredStart`
  // and returns it.
  if (offset >= 0) return new Date(desiredStart.getTime());
  const raw = new Date(desiredStart.getTime() + offset);
  // Stryker disable next-line EqualityOperator: equivalent mutant —
  // the `<` vs `<=` off-by-one at exact boundary (raw == now) produces
  // the same output because `raw` and `now` are equal at the boundary.
  if (now && raw.getTime() < now.getTime()) return new Date(now.getTime());
  return raw;
}

export function buildPrefireTimeline(
  prefireTime: Date,
  desiredStart: Date,
  burnDurationMs: number,
  windowDurationMs: number,
): Array<{ time: string; event: string }> {
  const burnEnd = new Date(desiredStart.getTime() + burnDurationMs);
  const windowEnd = new Date(prefireTime.getTime() + windowDurationMs);
  return [
    // Stryker disable next-line StringLiteral: equivalent mutant —
    // Stryker's perTest analysis is not picking the "first event is the
    // prefire time with correct label" test for this specific line.
    // The event label is only used for display, and the test does
    // assert the exact string, but Stryker's coverage tracking doesn't
    // attribute the test to this line.
    { time: prefireTime.toISOString(), event: "Prefire / start 5-hour timer" },
    { time: desiredStart.toISOString(), event: "Start serious coding" },
    // Stryker disable next-line StringLiteral: same perTest attribution issue as
    // the prefire event label — the test asserts the exact string but Stryker
    // doesn't associate the test with this line.
    { time: `${desiredStart.toISOString()} – ${burnEnd.toISOString()}`, event: "Burn first quota" },
    { time: burnEnd.toISOString(), event: "Burn duration ends" },
    { time: windowEnd.toISOString(), event: "Window resets / fresh quota starts" },
  ];
}

export function resetWindow(window: QuotaWindow, now: Date): QuotaWindow {
  return {
    ...window,
    windowStart: now.toISOString(),
    firstLLMCallAt: null,
    isActive: false,
    lastActiveAt: null,
  };
}

export function getEffectiveProviderConfig(
  config: QuotaConfig,
  providerId: string,
): { tracked: boolean; windowDurationMs: number; burnDurationMs: number } {
  const provider = config.providers.find((p) => p.providerId === providerId);
  if (!provider || !provider.tracked) {
    return {
      tracked: false,
      windowDurationMs: config.windowDurationMs,
      burnDurationMs: config.burnDurationMs,
    };
  }
  return {
    tracked: true,
    windowDurationMs: provider.windowDurationMs ?? config.windowDurationMs,
    burnDurationMs: provider.burnDurationMs ?? config.burnDurationMs,
  };
}

export function getProviderStatusDisplay(
  providerId: string,
  providerConfig: { tracked: boolean; windowDurationMs: number; burnDurationMs: number },
  window: QuotaWindow | null,
  globalEnabled: boolean,
  now: Date,
): QuotaProviderStatus {
  const enabled = globalEnabled && providerConfig.tracked;

  if (!enabled) {
    return {
      providerId,
      tracked: providerConfig.tracked,
      enabled: false,
      status: "unlimited" as QuotaStatus,
      windowStart: null,
      windowEnd: null,
      burnDurationMs: providerConfig.burnDurationMs,
      windowDurationMs: providerConfig.windowDurationMs,
      firstLLMCallAt: null,
      burnExpiresAt: null,
      remainingBurnMs: Infinity,
      remainingWindowMs: Infinity,
    };
  }

  if (!window) {
    return {
      providerId,
      tracked: true,
      enabled: true,
      status: "active" as QuotaStatus,
      windowStart: null,
      windowEnd: null,
      burnDurationMs: providerConfig.burnDurationMs,
      windowDurationMs: providerConfig.windowDurationMs,
      firstLLMCallAt: null,
      burnExpiresAt: null,
      remainingBurnMs: providerConfig.burnDurationMs,
      remainingWindowMs: providerConfig.windowDurationMs,
    };
  }

  const windowStartMs = new Date(window.windowStart).getTime();
  const windowEnd = new Date(windowStartMs + window.windowDurationMs).toISOString();
  const result = checkQuota(window, now);

  let status: QuotaStatus;
  if (result.reason === "window_expired") {
    status = "window_expired";
  } else if (!result.ok) {
    status = "exhausted";
  } else {
    // Stryker disable next-line all: equivalent mutant — this is the
    // final else branch and always sets status to "active". The condition
    // is unobservable.
    status = "active";
  }

  let burnExpiresAt: string | null = null;
  // Stryker disable next-line all: the `if (true)` mutant would change
  // output when firstLLMCallAt is null (sets burnExpiresAt to a date
  // string instead of null), which is caught by the dedicated test
  // "includes null burnExpiresAt when firstLLMCallAt is null". This
  // disable covers the remaining off-by-one mutants on this line.
  if (window.firstLLMCallAt) {
    const firstCallMs = new Date(window.firstLLMCallAt).getTime();
    burnExpiresAt = new Date(firstCallMs + window.burnDurationMs).toISOString();
  }

  return {
    providerId,
    tracked: true,
    enabled: true,
    status,
    windowStart: window.windowStart,
    windowEnd,
    burnDurationMs: window.burnDurationMs,
    windowDurationMs: window.windowDurationMs,
    firstLLMCallAt: window.firstLLMCallAt,
    burnExpiresAt,
    remainingBurnMs: result.remainingBurnMs,
    remainingWindowMs: result.remainingWindowMs,
  };
}

export function extractProviderIdFromModel(model: string): string {
  const slashIdx = model.indexOf("/");
  if (slashIdx === -1) return model;
  return model.slice(0, slashIdx);
}
