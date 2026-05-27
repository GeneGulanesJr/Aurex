// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { lapis }: { lapis: LaPisClient },
) {
  // In-memory dedup tracker (per process)
  const processed = new Map<string, boolean>();

  app.post("/api/missions/:id/checkpoints", async (request, reply) => {
    const body = request.body as CheckpointBody;

    if (!body.checkpointId || !body.decision) {
      return reply.status(400).send({ error: "checkpointId and decision are required" });
    }

    // Dedup check
    if (processed.has(body.checkpointId)) {
      return { accepted: true, duplicate: true };
    }

    await lapis.resolveCheckpoint(body.checkpointId, body.decision, body.guidance, body.reason);
    processed.set(body.checkpointId, true);

    return { accepted: true };
  });
}
