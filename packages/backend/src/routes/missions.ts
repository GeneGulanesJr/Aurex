// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { MissionConfig } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { MissionRunnerPool } from "../orchestrator/mission-runner-pool.js";

const defaultMissionConfig: Omit<MissionConfig, "modelHints"> = {
  workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
  costCap: 50,
  maxValidatorRetries: 2,
  maxRescopes: 5,
};

export async function missionRoutes(
  app: FastifyInstance,
  { lapis, pool, missionConfig = defaultMissionConfig }: {
    lapis: LaPisClient;
    pool: MissionRunnerPool;
    missionConfig?: typeof defaultMissionConfig;
  },
) {
  async function hydrateMissionPayload(missionId: string) {
    const [mission, milestones, cost] = await Promise.all([
      lapis.getMission(missionId),
      lapis.getMilestonesForMission(missionId),
      lapis.getMissionCost(missionId),
    ]);
    const unitsByMilestone = await Promise.all(
      milestones.map((milestone) => lapis.getWorkingUnitsForMilestone(milestone.id)),
    );
    const activeWorkers = unitsByMilestone
      .flat()
      .filter((unit) => !["completed", "failed", "timed_out"].includes(unit.status));
    return { mission, milestones, activeWorkers, cost };
  }
  app.post("/api/missions", async (request, reply) => {
    const { description, cloneUrl } = request.body as { description: string; cloneUrl?: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }
    const pinyxConfig = await lapis.getSetting<{ modelHints?: Partial<MissionConfig["modelHints"]> }>("pinyx_config");
    const config: MissionConfig = {
      ...missionConfig,
      modelHints: { orchestrator: "kilo/kilo-auto/free", worker: "kilo/kilo-auto/free", validator_scrutiny: "kilo/kilo-auto/free", validator_user_testing: "kilo/kilo-auto/free", research: "kilo/kilo-auto/free", ...pinyxConfig?.modelHints },
      ...(cloneUrl && { cloneUrl }),
    };
    const mission = await lapis.createMission(description, config);
    pool.submit(mission.id);
    return reply.status(201).send({ missionId: mission.id, status: mission.status });
  });

  app.get("/api/missions/current", async (_request, reply) => {
    const active = pool.getActiveMissions();
    const running = active.find((m) => m.state !== "queued" && m.state !== "completed" && m.state !== "failed");
    const missionId = running?.missionId ?? active[0]?.missionId;
    if (!missionId) {
      return reply.status(404).send({ error: "No active mission" });
    }
    try {
      return await hydrateMissionPayload(missionId);
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });

  app.get("/api/missions/active", async () => {
    return { missions: pool.getActiveMissions() };
  });

  app.post("/api/missions/:id/abort", async (request, reply) => {
    const { id } = request.params as { id: string };
    const status = pool.getStatus(id);
    if (!status) {
      return reply.status(404).send({ error: "Mission not found in pool" });
    }
    pool.abort(id);
    return { aborted: true };
  });

  app.post("/api/missions/:id/restart", async (request, reply) => {
    const { id } = request.params as { id: string };
    const activeStatus = pool.getStatus(id);
    if (activeStatus && !["completed", "failed"].includes(activeStatus.state)) {
      return reply.status(409).send({ error: "Mission is already active" });
    }

    let mission;
    try {
      mission = await lapis.getMission(id);
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }

    if (!["failed", "aborted", "completed"].includes(mission.status)) {
      return reply.status(409).send({ error: `Mission cannot be restarted from status ${mission.status}` });
    }

    await lapis.updateMissionStatus(id, "planning");
    pool.submit(id);
    return { restarted: true, missionId: id, status: "planning" };
  });

  app.get("/api/missions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await hydrateMissionPayload(id);
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });
}
