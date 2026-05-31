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
          // Emit chunk logs every ~200 chars so we don't flood WS
          if (streamedContent.length % 200 < delta.length) {
            const preview = streamedContent.slice(-120).replace(/\n/g, " ");
            emitLog("planning", preview);
          }
        },
      );

      emitLog("planning", "Parsing plan response…");
      const plan = JSON.parse(response.content) as { milestones: PlannedMilestoneRaw[] };
      emitLog("planning", `Plan received: ${plan.milestones.length} milestones. Creating in LaPis…`);

      // 3. Create milestones, units, and contracts in LaPis
      const result: PlanResult["milestones"] = [];
      for (let i = 0; i < plan.milestones.length; i++) {
        const ms = plan.milestones[i];
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
