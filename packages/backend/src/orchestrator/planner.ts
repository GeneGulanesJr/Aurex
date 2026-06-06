// packages/backend/src/orchestrator/planner.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { EventBus } from "../ws/events.js";
import { validateContractAppend } from "../enforcement/contract-immutability.js";

interface PlannedUnit {
  title?: string;
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
  lapisContextQuery?: string;
}

interface PlannedMilestoneRaw {
  title: string;
  description: string;
  units: PlannedUnit[];
  criteria: string[];
  testCommands: string[];
}

/**
 * Attempt to repair truncated JSON by closing open brackets/braces.
 * Scans character by character, tracking nesting depth, then appends
 * closing characters for any still-open structures.
 */
function repairTruncatedJson(input: string): string {
  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") stack.pop();
  }

  // If we're mid-string, close it
  let repaired = input;
  if (inString) repaired += '"';

  // Trim trailing incomplete tokens (partial key/value)
  // Remove any trailing comma + incomplete content after last complete value
  repaired = repaired.replace(/,\s*[^,\]\}"]*$/, "");

  // Close open structures in reverse order
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }

  return repaired;
}

export interface PlanResult {
  milestones: Array<{
    id: string;
    title: string;
    units: Array<{ id: string; description: string }>;
  }>;
}

export function createPlanner(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  opts?: { model?: string; eventBus?: EventBus; missionId?: string },
) {
  const model = opts?.model ?? "kilo/kilo-auto/free";
  const eventBus = opts?.eventBus;
  const missionId = opts?.missionId;

  function emitLog(phase: string, message: string) {
    if (eventBus && missionId) {
      eventBus.emit({ type: "mission_log", missionId, phase, message });
    }
  }

  function emitError(code: string, message: string, opts?: { recoverable?: boolean; details?: Record<string, unknown> }) {
    if (eventBus && missionId) {
      eventBus.emit({ type: "mission_error", missionId, code, message, recoverable: opts?.recoverable ?? false, details: opts?.details });
    }
  }

  return {
    async plan(missionDescription: string, missionId: string): Promise<PlanResult> {
      // 1. Gather memory context
      emitLog("planning", "Searching mission memory for relevant context…");
      const memories = await lapis.searchMemory(missionDescription, { limit: 10 });
      emitLog("planning", `Found ${memories.length} relevant memories. Asking ${model} to decompose into milestones…`);

      // 2. Ask PiNyx to decompose into milestones (streaming)
      let streamedContent = "";
      let lastEmittedTitle = "";
      let response;
      try {
        response = await pinyx.chatStream(
        {
          model,
          max_tokens: 8192,
          messages: [
            {
              role: "system",
              content: "You are a mission planner. Decompose the mission into ordered milestones. Each milestone has working units with declared paths and modules, validation criteria, and test commands. Respond with JSON only. Keep the plan concise — at most 4 milestones, each with at most 4 working units.",
            },
            {
              role: "user",
              content: `Mission: ${missionDescription}\n\nRelevant context: ${memories.slice(0, 5).map((m) => m.content).join("\n")}`,
            },
          ],
        },
        (delta) => {
          streamedContent += delta;
          // Extract milestone titles as they stream in
          const titleMatch = streamedContent.match(/"title"\s*:\s*"([^"]+)"/g);
          if (titleMatch && titleMatch.length > 0) {
            const latestTitle = titleMatch[titleMatch.length - 1].match(/"title"\s*:\s*"([^"]+)"/)?.[1];
            if (latestTitle && latestTitle !== lastEmittedTitle) {
              lastEmittedTitle = latestTitle;
              emitLog("planning", `Milestone ${titleMatch.length}: ${latestTitle}`);
            }
          }
        },
      );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitError("planner_llm_error", `LLM call failed during planning: ${msg}`, { recoverable: true });
        throw err;
      }

      // Check if the response was truncated by max tokens
      if (response.finishReason === "length") {
        emitLog("planning", `Response truncated (finish_reason=length). Attempting to parse partial JSON…`);
      }

      emitLog("planning", "Parsing plan response…");

      // 3. Parse — resilient to varying LLM output formats
      let raw: any;
      try {
        // Strip markdown code fences if present
        const cleaned = response.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/s, "").trim();
        raw = JSON.parse(cleaned);
      } catch {
        // Try to extract first JSON object from the response
        const firstBrace = response.content.indexOf("{");
        const lastBrace = response.content.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try {
            raw = JSON.parse(response.content.slice(firstBrace, lastBrace + 1));
          } catch {
            // If truncated (finish_reason=length), try to repair by closing open brackets
            if (response.finishReason === "length") {
              try {
                const repaired = repairTruncatedJson(response.content.slice(firstBrace));
                raw = JSON.parse(repaired);
                emitLog("planning", `Successfully repaired truncated JSON`);
              } catch {
                emitError("planner_parse_error", `Planner returned truncated JSON that could not be repaired`, { recoverable: true, details: { preview: response.content.slice(0, 200), finishReason: response.finishReason } });
                throw new Error(`Planner returned invalid JSON: ${response.content.slice(0, 200)}`);
              }
            } else {
              emitError("planner_parse_error", `Planner returned invalid JSON`, { recoverable: true, details: { preview: response.content.slice(0, 200) } });
              throw new Error(`Planner returned invalid JSON: ${response.content.slice(0, 200)}`);
            }
          }
        } else {
          emitError("planner_parse_error", `Planner returned invalid JSON`, { recoverable: true, details: { preview: response.content.slice(0, 200) } });
          throw new Error(`Planner returned invalid JSON: ${response.content.slice(0, 200)}`);
        }
      }

      // Normalize: handle both { milestones: [...] } and bare arrays and single-object formats
      let milestoneList: any[];
      if (Array.isArray(raw)) {
        milestoneList = raw;
      } else if (raw.milestones && Array.isArray(raw.milestones)) {
        milestoneList = raw.milestones;
      } else if (raw.title) {
        // Single milestone object
        milestoneList = [raw];
      } else {
        // Try to find any array-valued property as the milestone list
        const arrProp = Object.values(raw).find((v) => Array.isArray(v));
        milestoneList = arrProp ?? [];
      }

      // Normalize a value that could be array, string, or missing into an array
      const toArray = (v: any, ...fallbacks: any[]): string[] => {
        for (const val of [v, ...fallbacks]) {
          if (Array.isArray(val)) return val;
          if (typeof val === "string" && val.length > 0) return [val];
        }
        return [];
      };

      // Normalize field names: LLMs use various conventions
      const plan: PlannedMilestoneRaw[] = milestoneList.map((ms: any) => ({
        title: ms.title || ms.name || ms.milestone || `Milestone`,
        description: ms.description || ms.summary || ms.title || "",
        units: (ms.units || ms.working_units || ms.tasks || []).map((u: any) => ({
          title: u.title || u.name || undefined,
          description: u.description || u.name || u.title || u.task || "",
          declaredPaths: toArray(u.declaredPaths, u.paths, u.path),
          declaredModules: toArray(u.declaredModules, u.modules),
          lapisContextQuery: u.lapisContextQuery || u.lapis_context_query || u.contextQuery || undefined,
        })),
        criteria: toArray(ms.criteria, ms.validation_criteria, ms.validation),
        testCommands: toArray(ms.testCommands, ms.test_commands, ms.tests),
      }));

      emitLog("planning", `Plan received: ${plan.length} milestones. Creating in LaPis…`);

      await lapis.createMissionLedger({
        missionId,
        missionTitle: deriveMissionTitle(missionDescription),
        status: "planning",
        sourceMission: missionDescription,
        plannerSummary: summarizePlan(plan),
        acceptanceCriteria: plan.flatMap((ms) => ms.criteria),
        constraints: [],
        assumptions: [],
        humanQuestions: [],
      });

      // 4. Create milestones, units, contracts, and todo ledger items in LaPis
      const result: PlanResult["milestones"] = [];
      for (let i = 0; i < plan.length; i++) {
        const ms = plan[i];
        const milestone = await lapis.createMilestone(missionId, {
          title: ms.title,
          description: ms.description,
          orderIndex: i,
        });

        await lapis.createTodo(missionId, {
          title: `Milestone ${i + 1}: ${ms.title}`,
          status: "ready",
          type: "implementation",
          priority: "high",
          goal: ms.description,
          scope: {
            in: [...new Set(ms.units.flatMap((u) => [...u.declaredPaths, ...u.declaredModules]))],
            out: ["Out-of-scope product requirements not stated in the mission or validation criteria"],
          },
          likelyFiles: [...new Set(ms.units.flatMap((u) => u.declaredPaths))],
          lapisContextQuery: buildContextQuery({
            missionDescription,
            milestoneTitle: ms.title,
            taskDescription: ms.description,
            declaredPaths: ms.units.flatMap((u) => u.declaredPaths),
            declaredModules: ms.units.flatMap((u) => u.declaredModules),
            criteria: ms.criteria,
          }),
          acceptanceCriteria: ms.criteria,
          validationCriteria: ms.criteria,
          testCommands: ms.testCommands,
          riskLevel: ms.units.length > 2 ? "medium" : "low",
          workerInstructions: ["Use the worker-unit todos for implementation boundaries."],
          validatorInstructions: ["Validate worker-unit todos against this milestone scope and criteria."],
          escalationRules: [
            "Escalate if milestone scope must change.",
            "Escalate if validation requires a product decision not stated in the mission.",
          ],
          confidence: "medium",
        });

        const units: Array<{ id: string; description: string }> = [];
        for (const unit of ms.units) {
          const created = await lapis.createWorkingUnit(milestone.id, unit);
          units.push({ id: created.id, description: created.description });
          await lapis.createTodo(missionId, {
            title: unit.title || unit.description.slice(0, 80) || `Worker unit ${created.id}`,
            status: "ready",
            type: "implementation",
            priority: "medium",
            goal: unit.description,
            scope: {
              in: [...unit.declaredPaths, ...unit.declaredModules],
              out: ["Files, modules, and product behavior outside this worker unit's declared scope"],
            },
            likelyFiles: unit.declaredPaths,
            lapisContextQuery: unit.lapisContextQuery || buildContextQuery({
              missionDescription,
              milestoneTitle: ms.title,
              taskDescription: unit.description,
              declaredPaths: unit.declaredPaths,
              declaredModules: unit.declaredModules,
              criteria: ms.criteria,
            }),
            acceptanceCriteria: ms.criteria,
            validationCriteria: [
              "Implementation satisfies this todo goal without expanding scope.",
              "Changes stay within declared paths/modules unless justified in evidence.",
              ...ms.criteria,
            ],
            testCommands: ms.testCommands,
            riskLevel: unit.declaredPaths.length > 3 ? "medium" : "low",
            workerInstructions: [
              "Implement only this todo scope.",
              "Record changed files, branch, commits, and tests as evidence before completion.",
            ],
            validatorInstructions: [
              "Review only against the mission, this todo, acceptance criteria, diff, tests, and constraints.",
              "Treat outside-scope suggestions as optional, not blockers.",
            ],
            escalationRules: [
              "Escalate if this todo needs scope outside its declared paths/modules.",
              "Escalate if required behavior is ambiguous or security/data risk is unclear.",
            ],
            confidence: "medium",
          });
        }

        await lapis.createContract(milestone.id, {
          content: {
            criteria: ms.criteria,
            testCommands: ms.testCommands,
            acceptanceBehavior: ms.criteria.join("; "),
          },
        });

        // Enforce contract immutability — validate append
        const existingContracts = await lapis.getContractHistory(milestone.id);
        const appendCheck = validateContractAppend(existingContracts as any[], {
          milestoneId: milestone.id,
          content: { criteria: ms.criteria, testCommands: ms.testCommands, acceptanceBehavior: ms.criteria.join("; ") },
        });
        if (!appendCheck.valid) {
          console.warn(`[enforcement] Contract append blocked for milestone ${milestone.id}: ${appendCheck.reason}`);
        }

        result.push({ id: milestone.id, title: ms.title, units });
      }

      emitLog("planning", `Plan created with ${result.length} milestones. Starting execution…`);

      return { milestones: result };
    },
  };
}

function deriveMissionTitle(missionDescription: string): string {
  const firstLine = missionDescription.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "Mission";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function summarizePlan(plan: Array<{ title: string; units: PlannedUnit[] }>): string {
  const unitCount = plan.reduce((sum, ms) => sum + ms.units.length, 0);
  return `${plan.length} milestone(s), ${unitCount} worker unit(s)`;
}

function buildContextQuery(input: {
  missionDescription: string;
  milestoneTitle: string;
  taskDescription: string;
  declaredPaths: string[];
  declaredModules: string[];
  criteria: string[];
}): string {
  const tokens = [
    input.missionDescription,
    input.milestoneTitle,
    input.taskDescription,
    ...input.declaredPaths,
    ...input.declaredModules,
    ...input.criteria,
    "tests API contracts data models config existing patterns",
  ];
  return [...new Set(tokens.flatMap((part) => String(part).split(/[^A-Za-z0-9_./-]+/).filter((token) => token.length > 2)))]
    .slice(0, 32)
    .join(" ");
}
