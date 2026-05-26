// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";

interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { resolveCheckpoint }: {
    resolveCheckpoint: (
      missionId: string, decision: CheckpointDecision, guidance?: string, reason?: string
    ) => Promise<{ accepted: boolean; duplicate?: boolean }>;
  },
) {
  // In-memory dedup tracker (per process)
  const processed = new Map<string, boolean>();

  app.post("/api/missions/:id/checkpoints", async (request, reply) => {
    const { id: missionId } = request.params as { id: string };
    const body = request.body as CheckpointBody;

    if (!body.checkpointId || !body.decision) {
      return reply.status(400).send({ error: "checkpointId and decision are required" });
    }

    // Dedup check
    if (processed.has(body.checkpointId)) {
      return { accepted: true, duplicate: true };
    }

    const result = await resolveCheckpoint(missionId, body.decision, body.guidance, body.reason);

    if (result.accepted) {
      processed.set(body.checkpointId, true);
    }

    return result;
  });
}
