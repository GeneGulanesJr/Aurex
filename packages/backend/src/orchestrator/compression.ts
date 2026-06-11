import type { CompressionTrigger } from "@aurex/shared";
import type { CompressionResult, LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";

export interface CompressionService {
  /** Runs LaPis state compression. Returns the compression summary, or null on failure. */
  run(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult | null>;
}

export function createCompressionService(
  lapis: LaPisClient,
  eventBus: Pick<EventBus, "emit">,
): CompressionService {
  return {
    async run(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult | null> {
      let result: CompressionResult;
      try {
        result = await lapis.runCompression(missionId, trigger);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        eventBus.emit({
          type: "mission_error",
          missionId,
          code: "compression_failed",
          message,
          recoverable: true,
        });
        console.warn(`[compression] ${trigger} failed for ${missionId}:`, message);
        return null;
      }

      // Surface the compression result as a mission_log so the dashboard
      // and (later) the next planner invocation can read what was dropped.
      if (result.summary) {
        eventBus.emit({
          type: "mission_log",
          missionId,
          phase: "compression",
          message: result.summary,
          data: { trigger, tokensSaved: result.tokensSaved },
        });
      }

      if (result.error) {
        eventBus.emit({
          type: "mission_error",
          missionId,
          code: "compression_failed",
          message: result.error,
          recoverable: true,
        });
        return null;
      }

      return result;
    },
  };
}
