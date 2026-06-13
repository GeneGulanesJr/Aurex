// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { lapis }: { lapis: LaPisClient },
) {
  // In-memory dedup tracker (per process)
  const processed = new Map<string, boolean>();

  app.post("/api/missions/:id/checkpoints", async (request, reply) => {
    const body = request.body as CheckpointBody;
    const missionId = (request.params as { id: string }).id;

    if (!body.checkpointId || !body.decision) {
      return reply.status(400).send({ error: "checkpointId and decision are required" });
    }

    // Verify the checkpoint exists and belongs to the mission in the path.
    // Without this, the :id path param is decorative and any valid
    // checkpointId can be resolved regardless of which mission owns it.
    let checkpoint;
    try {
      checkpoint = await lapis.getCheckpoint(body.checkpointId);
    } catch {
      return reply.status(404).send({ error: "checkpoint not found" });
    }
    if (checkpoint.missionId !== missionId) {
      return reply.status(404).send({ error: "checkpoint does not belong to this mission" });
    }

    // Dedup check
    if (processed.has(body.checkpointId)) {
      return { accepted: true, duplicate: true };
    }

    await lapis.resolveCheckpoint(body.checkpointId, body.decision, body.guidance, body.reason, body.rescopeGuidance);
    processed.set(body.checkpointId, true);

    return { accepted: true };
  });
}
