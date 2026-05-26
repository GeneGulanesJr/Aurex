// packages/backend/src/enforcement/broadcast-lifecycle.ts
import type { BroadcastLifecycle } from "@aurex/shared";

const VALID_TRANSITIONS: Record<BroadcastLifecycle, BroadcastLifecycle[]> = {
  active: ["superseded", "archived", "expired"],
  superseded: [],
  archived: [],
  expired: [],
};

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateBroadcastTransition(
  current: BroadcastLifecycle,
  next: BroadcastLifecycle,
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

export function canAuthorTransition(
  actorId: string,
  authorId: string,
  current: BroadcastLifecycle,
  next: BroadcastLifecycle,
): boolean {
  const transition = validateBroadcastTransition(current, next);
  if (!transition.valid) return false;

  if (actorId === authorId) return true;
  if (actorId.startsWith("orchestrator") || actorId === "human") return true;

  return false;
}
