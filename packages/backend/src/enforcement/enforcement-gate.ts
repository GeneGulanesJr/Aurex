// packages/backend/src/enforcement/enforcement-gate.ts
import { validateBroadcastTransition, canAuthorTransition } from "./broadcast-lifecycle.js";
import { validateResearchTransition, canTransitionFinding } from "./research-lifecycle.js";
import type { BroadcastLifecycle, ResearchLifecycle, StandingContext } from "@aurex/shared";

export function enforceBroadcastTransition(
  current: BroadcastLifecycle,
  next: BroadcastLifecycle,
  actorId: string,
  authorId: string,
): { ok: boolean; reason?: string } {
  const transition = validateBroadcastTransition(current, next);
  if (!transition.valid) return { ok: false, reason: transition.reason };

  if (!canAuthorTransition(actorId, authorId, current, next)) {
    return { ok: false, reason: `Actor ${actorId} is not authorized to transition broadcast from ${current} to ${next}` };
  }

  return { ok: true };
}

export function enforceResearchTransition(
  current: ResearchLifecycle,
  next: ResearchLifecycle,
  actorId: string,
  standingContext?: StandingContext,
): { ok: boolean; reason?: string } {
  const result = canTransitionFinding(current, next, actorId, standingContext);
  if (!result.valid) return { ok: false, reason: result.reason };
  return { ok: true };
}
