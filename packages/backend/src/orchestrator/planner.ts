// packages/backend/src/orchestrator/planner.ts
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";

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
  opts?: { model?: string },
) {
  const model = opts?.model ?? "reasoning-strong";

  return {
    async plan(missionDescription: string, missionId: string): Promise<PlanResult> {
      // 1. Gather memory context
      const memories = await lapis.searchMemory(missionDescription, { limit: 10 });

      // 2. Ask PiNyx to decompose into milestones
      const response = await pinyx.chat({
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
      });

      const plan = JSON.parse(response.content) as { milestones: PlannedMilestoneRaw[] };

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

        result.push({ id: milestone.id, title: ms.title, units });
      }

      return { milestones: result };
    },
  };
}
