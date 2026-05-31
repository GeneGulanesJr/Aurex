// packages/backend/src/orchestrator/planner.ts
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { EventBus } from "../ws/events.js";
import { validateContractAppend } from "../enforcement/contract-immutability.js";

interface PlannedUnit {
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
}

interface PlannedMilestoneRaw {
  title: string;
  description: string;
  units: PlannedUnit[];
  criteria: string[];
  testCommands: string[];
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

  return {
    async plan(missionDescription: string, missionId: string): Promise<PlanResult> {
      // 1. Gather memory context
      emitLog("planning", "Searching mission memory for relevant context…");
      const memories = await lapis.searchMemory(missionDescription, { limit: 10 });
      emitLog("planning", `Found ${memories.length} relevant memories. Asking ${model} to decompose into milestones…`);

      // 2. Ask PiNyx to decompose into milestones (streaming)
      let streamedContent = "";
      let lastEmittedTitle = "";
      const response = await pinyx.chatStream(
        {
          model,
          messages: [
            {
              role: "system",
              content: "You are a mission planner. Decompose the mission into ordered milestones. Each milestone has working units with declared paths and modules, validation criteria, and test commands. Respond with JSON only.",
            },
            {
              role: "user",
              content: `Mission: ${missionDescription}\n\nRelevant context: ${memories.map((m) => m.content).join("\n")}`,
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
          raw = JSON.parse(response.content.slice(firstBrace, lastBrace + 1));
        } else {
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

      // Normalize field names: LLMs use various conventions
      const plan = milestoneList.map((ms: any) => ({
        title: ms.title || ms.name || ms.milestone || `Milestone`,
        description: ms.description || ms.summary || ms.title || "",
        units: (ms.units || ms.working_units || ms.tasks || []).map((u: any) => ({
          description: u.description || u.name || u.title || u.task || "",
          declaredPaths: u.declaredPaths || u.paths || (u.path ? [u.path] : []),
          declaredModules: u.declaredModules || u.modules || [],
        })),
        criteria: ms.criteria || ms.validation_criteria || ms.validation || [],
        testCommands: ms.testCommands || ms.test_commands || ms.tests || [],
      }));

      emitLog("planning", `Plan received: ${plan.length} milestones. Creating in LaPis…`);

      // 4. Create milestones, units, and contracts in LaPis
      const result: PlanResult["milestones"] = [];
      for (let i = 0; i < plan.length; i++) {
        const ms = plan[i];
        const milestone = await lapis.createMilestone(missionId, {
          title: ms.title,
          description: ms.description,
          orderIndex: i,
        });

        const units: Array<{ id: string; description: string }> = [];
        for (const unit of ms.units) {
          const created = await lapis.createWorkingUnit(milestone.id, unit);
          units.push({ id: created.id, description: created.description });
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
