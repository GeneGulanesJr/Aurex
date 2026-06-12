import type { ExecutionFailureCode } from "@aurex/shared";

const RETRYABLE_FAILURES = new Set<ExecutionFailureCode>([
  "CLAIM_EXPIRED",
  "HEARTBEAT_TIMEOUT",
  "SESSION_START_TIMEOUT",
  "PINYX_UNAVAILABLE",
  "LAPIS_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "UNKNOWN",
]);

export function isRetryableFailure(code: ExecutionFailureCode): boolean {
  return RETRYABLE_FAILURES.has(code);
}

export function attemptsExhausted(
  attempt: number,
  maxAttempts: number,
): boolean {
  return attempt >= maxAttempts;
}
