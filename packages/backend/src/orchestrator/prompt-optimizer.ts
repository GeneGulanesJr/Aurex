// packages/backend/src/orchestrator/prompt-optimizer.ts
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { EventBus } from "../ws/events.js";

/**
 * The prompt-optimization step (issue #119 + user request).
 *
 * Before the planner decomposes a mission, the orchestrator refines the
 * user's raw mission description into a clear engineering brief: it removes
 * ambiguity, extracts explicit constraints and scope, normalizes structure
 * (goal → acceptance hints → constraints), and surfaces implicit
 * assumptions — without inventing new product requirements.
 *
 * This is a refinement pass only. It MUST preserve the user's intent. On any
 * failure (PiNyx error, empty/garbage response) it returns the original
 * description verbatim so a bad refinement can never block a mission.
 */
export interface PromptOptimizerOptions {
  model: string;
  eventBus?: EventBus;
  missionId?: string;
}

const PROMPT_OPTIMIZER_SYSTEM_PROMPT = `You are a mission prompt optimizer. Refine the user's raw mission description into a clear, well-structured engineering brief that a downstream planner can decompose into milestones.

Your job is CLARIFICATION and STRUCTURE, not invention. Rules:
1. Preserve the user's exact intent and goals. Do not add new product requirements, features, or scope the user did not ask for.
2. Remove ambiguity and contradictions. Where the user was vague, make the concrete intent explicit ONLY when it is unambiguous from context; otherwise call it out as an open question.
3. Extract and separate: a concise Goal, explicit Scope (what is in/out), Constraints (tech stack, patterns, performance, compatibility), and any Acceptance hints the user mentioned.
4. Normalize wording for clarity but keep the user's domain terminology.
5. Keep it tight — this feeds a planner, not a human essay. No preamble, no meta-commentary about what you did.

OUTPUT FORMAT: Respond with ONLY the refined mission description as plain text (optionally using Markdown headings like "## Goal", "## Scope", "## Constraints"). No code fences, no explanation, no "Here is the refined version".`;

function buildOptimizeUserMessage(description: string): string {
  return `Raw mission description from the user:\n\n"""\n${description}\n"""`;
}

function cleanOptimizedContent(content: string): string {
  let out = content;
  out = out.replace(/<think[\s\S]*?<\/think>\s*/gi, "");
  out = out.replace(/^```(?:markdown|text|plaintext)?\s*/i, "").replace(/\s*```$/s, "");
  out = out.replace(/^(?:refined\s+mission\s+(?:description|brief)\s*:?|here\s+is[^:\n]*:?)\s*\n+/i, "");
  return out.trim();
}

export async function optimizeMissionPrompt(
  pinyx: PinyxClient,
  description: string,
  opts: PromptOptimizerOptions,
): Promise<string> {
  const { eventBus, missionId, model } = opts;
  const trimmed = description.trim();

  function emitLog(message: string) {
    if (eventBus && missionId) {
      eventBus.emit({ type: "mission_log", missionId, phase: "planning", message });
    }
  }
  function emitError(message: string) {
    if (eventBus && missionId) {
      eventBus.emit({ type: "mission_error", missionId, code: "prompt_optimizer_failed", message, recoverable: true });
    }
  }

  if (trimmed.length === 0) return description;

  let resp;
  try {
    emitLog(`Optimizing mission prompt with ${model}…`);
    resp = await pinyx.chat({
      model,
      messages: [
        { role: "system", content: PROMPT_OPTIMIZER_SYSTEM_PROMPT },
        { role: "user", content: buildOptimizeUserMessage(description) },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitError(`Prompt optimization failed, using original description: ${msg}`);
    return description;
  }

  const refined = cleanOptimizedContent(resp.content);
  if (refined.length === 0) {
    emitError("Prompt optimization returned an empty response, using original description.");
    return description;
  }

  emitLog("Mission prompt optimized.");
  return refined;
}
