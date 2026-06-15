// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
}

export interface ResolveCheckpointInput {
  missionId: string;
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
}

export type ResolveCheckpointResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Shared dedup tracker for resolved checkpoints. A single instance is held per
 * process and passed to both the REST route and the WS handler so a decision
 * submitted over one transport is not re-processed over the other.
 */
export interface CheckpointDedupTracker {
  has(checkpointId: string): boolean;
  mark(checkpointId: string): void;
}

export function createCheckpointDedupTracker(): CheckpointDedupTracker {
  const processed = new Map<string, boolean>();
  return {
    has(checkpointId) {
      return processed.has(checkpointId);
    },
    mark(checkpointId) {
      processed.set(checkpointId, true);
    },
  };
}

/**
 * Validates, dedups, and resolves a checkpoint decision against LaPis.
 *
 * Shared between the REST route (`POST /api/missions/:id/checkpoints`) and the
 * WebSocket `checkpoint_decision` message handler so both transports enforce the
 * same ownership check and dedup. Returns a discriminated result so each caller
 * can map it to its own response shape (HTTP status vs. WS ack).
 */
export async function resolveCheckpointDecision(
  lapis: LaPisClient,
  dedup: CheckpointDedupTracker,
  input: ResolveCheckpointInput,
): Promise<ResolveCheckpointResult> {
  if (!input.checkpointId || !input.decision) {
    return { ok: false, status: 400, error: "checkpointId and decision are required" };
  }

  // Verify the checkpoint exists and belongs to the mission in the path.
  // Without this, the missionId is decorative and any valid checkpointId can be
  // resolved regardless of which mission owns it.
  let checkpoint;
  try {
    checkpoint = await lapis.getCheckpoint(input.checkpointId);
  } catch {
    return { ok: false, status: 404, error: "checkpoint not found" };
  }
  if (checkpoint.missionId !== input.missionId) {
    return { ok: false, status: 404, error: "checkpoint does not belong to this mission" };
  }

  if (dedup.has(input.checkpointId)) {
    return { ok: true, duplicate: true };
  }

  await lapis.resolveCheckpoint(
    input.checkpointId,
    input.decision,
    input.guidance,
    input.reason,
    input.rescopeGuidance,
  );
  dedup.mark(input.checkpointId);

  return { ok: true, duplicate: false };
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { lapis, dedup = createCheckpointDedupTracker() }: {
    lapis: LaPisClient;
    /** Injectable for tests / sharing with the WS handler. */
    dedup?: CheckpointDedupTracker;
  },
) {
  app.post("/api/missions/:id/checkpoints", async (request, reply: FastifyReply) => {
    const body = request.body as CheckpointBody;
    const missionId = (request.params as { id: string }).id;

    const result = await resolveCheckpointDecision(lapis, dedup, {
      missionId,
      checkpointId: body.checkpointId,
      decision: body.decision,
      guidance: body.guidance,
      reason: body.reason,
      rescopeGuidance: body.rescopeGuidance,
    });

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return { accepted: true, duplicate: result.duplicate };
  });
}
