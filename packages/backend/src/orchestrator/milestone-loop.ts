// packages/backend/src/orchestrator/milestone-loop.ts
import type { Mission, Milestone } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";
import { createNegotiator } from "./negotiator";

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: unknown, context: unknown) => void;
  onAgentStatus: (agentId: string, agentType: unknown, status: unknown, milestoneId: string) => void;
  onMilestoneProgress: (milestoneId: string, status: unknown, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
) {
  return {
    async run(mission: Mission, milestones: Milestone[]): Promise<boolean> {
      const config = mission.configJson;
      const negotiator = createNegotiator(lapis);

      for (const milestone of milestones) {
        if (milestone.status === "completed") continue;

        // Update milestone status
        await lapis.updateMilestoneStatus(milestone.id, "in_progress");
        callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);

        // Negotiate verdicts (placeholder — actual worker spawning happens here in full impl)
        const retryCounter = await lapis.incrementRetry(milestone.id);
        const decision = await negotiator.negotiate(
          milestone.id,
          retryCounter.retries,
          retryCounter.rescopes,
          config.maxValidatorRetries,
          config.maxRescopes,
        );

        if (decision.decision === "escalate") {
          callbacks.onEscalation(mission.id, { kind: "rescope_limit", milestoneId: milestone.id }, {});
          return false; // Pause for human
        }

        // Mark complete if passed
        if (decision.decision === "pass") {
          await lapis.updateMilestoneStatus(milestone.id, "completed");
          callbacks.onMilestoneProgress(milestone.id, "completed", 1, 1);
        }
      }

      // All milestones complete
      await lapis.updateMissionStatus(mission.id, "completed");
      return true;
    },
  };
}
