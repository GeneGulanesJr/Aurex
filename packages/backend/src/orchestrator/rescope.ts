// packages/backend/src/orchestrator/rescope.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { Mission, ValidationVerdict, ResearchFinding } from "@aurex/shared";

export interface RescopeInput {
  pinyx: PinyxClient;
  lapis: LaPisClient;
  mission: Mission;
  milestone: { id: string; title: string; description: string };
  model: string;
  reason: string;
  verdicts?: ValidationVerdict[];
  researchFindings?: ResearchFinding[];
  completedUnitSummaries?: Array<{ description: string; declaredPaths: string[]; declaredModules: string[] }>;
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
  `You are a mission planner re-planning a milestone that failed validation. You must understand WHY the previous plan failed before generating new working units.

Analyze the validator findings carefully:
- If validators found code quality issues, plan units that address those specific issues
- If validators found scope problems, adjust the scope of the new units
- If workers timed out, break the work into smaller, more focused units
- If handoffs show partial completion, build on what succeeded

IMPORTANT RULES:
1. Do NOT re-plan units that have already been successfully completed (listed below as completed)
2. Only plan units for the remaining/failing work
3. Use the research findings to inform better path and module declarations
4. Keep units small and focused — each unit should be independently achievable
5. Declare accurate file paths based on the actual codebase structure

Respond with JSON: { units: [{ description, declaredPaths, declaredModules }] }`;

function buildRescopeUserMessage(input: RescopeInput): string {
  const parts: string[] = [];
  parts.push(`Milestone: ${input.milestone.title}`);
  parts.push(`Description: ${input.milestone.description}`);
  parts.push(`Mission: ${input.mission.description}`);
  parts.push(`Failure reason: ${input.reason}`);

  if (input.verdicts && input.verdicts.length > 0) {
    const verdictSummaries = input.verdicts
      .filter((v) => v.verdict === "fail")
      .map((v) => {
        const details = [`Validator: ${v.validatorType}`, `Findings: ${v.findings}`];
        if (v.classification) details.push(`Classification: ${v.classification}`);
        if (v.failedUnitIds && v.failedUnitIds.length > 0) details.push(`Failed units: ${v.failedUnitIds.join(", ")}`);
        return details.join("\n");
      });
    if (verdictSummaries.length > 0) {
      parts.push(`\n## Validator Failure Details\n${verdictSummaries.join("\n\n")}`);
    }
  }

  if (input.completedUnitSummaries && input.completedUnitSummaries.length > 0) {
    const completedStr = input.completedUnitSummaries
      .map((u) => `- ${u.description} (paths: ${u.declaredPaths.join(", ") || "none"})`)
      .join("\n");
    parts.push(`\n## Already Completed Units (DO NOT re-plan these)\n${completedStr}`);
  }

  if (input.researchFindings && input.researchFindings.length > 0) {
    const findingsStr = input.researchFindings
      .filter((f) => f.status !== "rejected" && f.status !== "expired")
      .map((f) => `- ${f.title} [${f.relevance}]: ${f.content}`)
      .join("\n");
    if (findingsStr) {
      parts.push(`\n## Research Findings\n${findingsStr}`);
    }
  }

  return parts.join("\n");
}

export async function rescopeMilestone(input: RescopeInput): Promise<RescopeResult> {
  const { pinyx, lapis, milestone } = input;
  let resp: { content: string };
  try {
    resp = await pinyx.chat({
      model: input.model,
      messages: [
        { role: "system", content: RESCOPE_SYSTEM_PROMPT },
        { role: "user", content: buildRescopeUserMessage(input) },
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
