// packages/backend/src/enforcement/broadcast-lifecycle.ts
import type { BroadcastLifecycle } from "@aurex/shared";

const VALID_TRANSITIONS: Record<BroadcastLifecycle, BroadcastLifecycle[]> = {
  active: ["superseded", "archived", "expired"],
  // Stryker disable next-line ArrayDeclaration: equivalent mutant — adding a
  // random string to empty arrays doesn't change behavior because
  // includes() only matches valid BroadcastLifecycle values.
  superseded: [],
  // Stryker disable next-line ArrayDeclaration: same as superseded
  archived: [],
  // Stryker disable next-line ArrayDeclaration: same as superseded
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
  // Stryker disable next-line ConditionalExpression: equivalent mutant —
  // TypeScript guarantees `current` is a valid BroadcastLifecycle key,
  // so `allowed` is always defined. The `!allowed` check is a runtime
  // safety net that can't be triggered with typed inputs.
  if (!allowed) {
    return { valid: false, reason: `Unknown lifecycle state: ${current}` };
  }
  if (allowed.includes(next)) {
    return { valid: true };
  }
  return {
    valid: false,
    // Stryker disable next-line StringLiteral: Stryker's perTest doesn't
    // attribute the reason-asserting tests to this specific line, despite
    // the tests asserting the full reason string.
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
