// packages/backend/src/orchestrator/rescope.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { Mission } from "@aurex/shared";

export interface RescopeInput {
  pinyx: PinyxClient;
  lapis: LaPisClient;
  mission: Mission;
  milestone: { id: string; title: string; description: string };
  model: string;
  reason: string;
}

export interface RescopeUnit {
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
}

export type RescopeResult =
  | { ok: true; units: RescopeUnit[] }
  | { ok: false; error: "pinyx_threw"; message: string }
  | { ok: false; error: "invalid_plan"; content: string };

const RESCOPE_SYSTEM_PROMPT =
  "You are a mission planner. Re-plan this milestone given the validation failures. Respond with JSON: { units: [{ description, declaredPaths, declaredModules }] }";

/**
 * Re-plan a milestone via the orchestrator model and create fresh working
 * units against the same milestone id. Used by both the auto-rescope path
 * inside the milestone loop and the user-initiated rescope decision in the
 * mission runner.
 *
 * Returns a discriminated result so each caller can handle failures in its
 * own way (loop escalates with a new checkpoint; runner marks mission failed).
 */
export async function rescopeMilestone(input: RescopeInput): Promise<RescopeResult> {
  const { pinyx, lapis, mission, milestone, model, reason } = input;
  let resp: { content: string };
  try {
    resp = await pinyx.chat({
      model,
      messages: [
        { role: "system", content: RESCOPE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Milestone: ${milestone.title}\nDescription: ${milestone.description}\nFailed units: ${reason}\nMission: ${mission.description}`,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "pinyx_threw", message };
  }

  let plan: { units?: RescopeUnit[] };
  try {
    plan = JSON.parse(resp.content);
  } catch {
    return { ok: false, error: "invalid_plan", content: resp.content };
  }
  if (!plan || !Array.isArray(plan.units)) {
    return { ok: false, error: "invalid_plan", content: resp.content };
  }

  for (const unit of plan.units) {
    await lapis.createWorkingUnit(milestone.id, unit);
  }
  return { ok: true, units: plan.units };
}
