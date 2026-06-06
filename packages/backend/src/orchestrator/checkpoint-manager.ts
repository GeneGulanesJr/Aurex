import type { LaPisClient } from "../clients/lapis-client.js";
import type { CheckpointDecision, CheckpointRecord, CheckpointTrigger } from "@aurex/shared";

export interface CheckpointManager {
  create(record: {
    missionId: string;
    trigger: CheckpointTrigger;
    milestoneId: string;
    summary: string;
  }): Promise<string>;
  waitForResolution(checkpointId: string): Promise<CheckpointRecord>;
  resolve(checkpointId: string, decision: CheckpointDecision, guidance?: string, reason?: string, rescopeGuidance?: string): Promise<void>;
  getPendingForMission(missionId: string): Promise<CheckpointRecord[]>;
}

export function createCheckpointManager(
  lapis: LaPisClient,
  opts?: { pollIntervalMs?: number },
): CheckpointManager {
  const pollIntervalMs = opts?.pollIntervalMs ?? 2_000;

  return {
    async create(record) {
      const checkpoint = await lapis.createCheckpoint(record);
      return checkpoint.id;
    },

    async waitForResolution(checkpointId) {
      return new Promise<CheckpointRecord>((resolve, reject) => {
        let stopped = false;

        const poll = async () => {
          if (stopped) return;
          try {
            const checkpoint = await lapis.getCheckpoint(checkpointId).catch(() => null);
            if (!checkpoint) {
              // LaPis may not have the route yet — retry
              setTimeout(poll, pollIntervalMs);
              return;
            }
            if (checkpoint.status === "resolved") {
              stopped = true;
              resolve(checkpoint);
              return;
            }
            setTimeout(poll, pollIntervalMs);
          } catch (error) {
            stopped = true;
            reject(error);
          }
        };

        void poll();
      });
    },

    async resolve(checkpointId, decision, guidance, reason, rescopeGuidance) {
      await lapis.resolveCheckpoint(checkpointId, decision, guidance, reason, rescopeGuidance);
    },

    async getPendingForMission(missionId) {
      return lapis.getPendingCheckpoints(missionId).catch(() => [] as import("@aurex/shared").CheckpointRecord[]);
    },
  };
}
