// packages/backend/src/enforcement/research-lifecycle.ts
import type { ResearchLifecycle, StandingContext } from "@aurex/shared";

const VALID_TRANSITIONS: Record<ResearchLifecycle, ResearchLifecycle[]> = {
  unverified: ["verified", "rejected", "expired"],
  verified: ["superseded", "expired"],
  superseded: ["expired"],
  rejected: ["expired"],
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
  if (!allowed) {
    return { valid: false, reason: `Unknown lifecycle state: ${current}` };
  }
  if (allowed.includes(next)) {
    return { valid: true };
  }
  return {
    valid: false,
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
