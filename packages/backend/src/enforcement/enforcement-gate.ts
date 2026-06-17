// packages/backend/src/enforcement/enforcement-gate.ts
import { canTransitionFinding } from "./research-lifecycle.js";
import type { ResearchLifecycle, StandingContext } from "@aurex/shared";

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
