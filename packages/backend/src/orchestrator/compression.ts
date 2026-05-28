import type { CompressionTrigger } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";

export interface CompressionService {
  run(missionId: string, trigger: CompressionTrigger): Promise<void>;
}

export function createCompressionService(
  lapis: LaPisClient,
  eventBus: Pick<EventBus, "emit">,
): CompressionService {
  return {
    async run(missionId: string, trigger: CompressionTrigger): Promise<void> {
      try {
        await lapis.runCompression(missionId, trigger);
      } catch (error) {
        eventBus.emit({
          type: "agent_status" as any,
          agentId: `compression-${missionId}`,
          agentType: "orchestrator" as any,
          status: "failed" as any,
          milestoneId: missionId,
        } as any);
        console.warn(
          `[compression] ${trigger} failed for ${missionId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}
