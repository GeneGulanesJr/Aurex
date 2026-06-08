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
          type: "mission_error",
          missionId,
          code: "compression_failed",
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        });
        console.warn(
          // Stryker disable next-line StringLiteral: the error message
          // string is only used for logging and doesn't affect behavior.
          `[compression] ${trigger} failed for ${missionId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}
