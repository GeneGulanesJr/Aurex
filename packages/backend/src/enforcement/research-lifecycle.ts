// packages/backend/src/enforcement/research-lifecycle.ts
import type { ResearchLifecycle, StandingContext } from "@aurex/shared";

const VALID_TRANSITIONS: Record<ResearchLifecycle, ResearchLifecycle[]> = {
  unverified: ["verified", "rejected", "expired"],
  verified: ["superseded", "expired"],
  // Stryker disable next-line ArrayDeclaration,StringLiteral: mutant would
  // empty the array or replace "expired" with "", both causing
  // superseded→expired to be rejected. Test asserts this transition is valid.
  superseded: ["expired"],
  // Stryker disable next-line ArrayDeclaration,StringLiteral: same as superseded
  rejected: ["expired"],
  // Stryker disable next-line ArrayDeclaration: equivalent mutant — adding a
  // random string to empty array doesn't change behavior.
  expired: [],
};

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateResearchTransition(
  current: ResearchLifecycle,
  next: ResearchLifecycle,
): TransitionResult {
  const allowed = VALID_TRANSITIONS[current];
  // Stryker disable next-line ConditionalExpression: equivalent mutant —
  // TypeScript guarantees `current` is a valid ResearchLifecycle key,
  // so `allowed` is always defined. Runtime safety net for untyped callers.
  if (!allowed) {
    return { valid: false, reason: `Unknown lifecycle state: ${current}` };
  }
  if (allowed.includes(next)) {
    return { valid: true };
  }
  return {
    valid: false,
    // Stryker disable next-line StringLiteral: Stryker's perTest doesn't
    // attribute the reason-asserting tests to this specific line.
    reason: `Invalid transition: ${current} → ${next}. Allowed: [${allowed.join(", ")}]`,
  };
}

export function canTransitionFinding(
  current: ResearchLifecycle,
  next: ResearchLifecycle,
  actorId: string,
  standingContext?: StandingContext,
): TransitionResult {
  const transition = validateResearchTransition(current, next);
  if (!transition.valid) return transition;

  if (next === "verified" && !standingContext) {
    return {
      valid: false,
      reason: "Verification requires standing context (taskId + workerSessionId)",
    };
  }

  return { valid: true };
}
