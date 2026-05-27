// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { MissionRunner } from "../orchestrator/mission-runner.js";

export async function missionRoutes(
  app: FastifyInstance,
  { lapis, runner }: { lapis: LaPisClient; runner: MissionRunner },
) {
  app.post("/api/missions", async (request, reply) => {
    const { description } = request.body as { description: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }
    const mission = await lapis.createMission(description, {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    });
    runner.start(mission.id);
    return reply.status(201).send({ missionId: mission.id, status: mission.status });
  });

  app.get("/api/missions/current", async (_request, reply) => {
    const missionId = runner.getActiveMissionId();
    if (!missionId) {
      return reply.status(404).send({ error: "No active mission" });
    }
    try {
      const mission = await lapis.getMission(missionId);
      const cost = await lapis.getMissionCost(missionId);
      return { mission, milestones: [], activeWorkers: [], cost };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });

  app.get("/api/missions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const mission = await lapis.getMission(id);
      const cost = await lapis.getMissionCost(id);
      return { mission, milestones: [], activeWorkers: [], cost };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });
}
