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
    const mission = await lapis.getMission(missionId);
    const [milestones, cost] = await Promise.all([
      lapis.getMilestonesForMission(missionId).catch(() => [] as import("@aurex/shared").Milestone[]),
      lapis.getMissionCost(missionId).catch(() => ({ totalCost: 0, totalTokens: 0, entries: 0 })),
    ]);
    const unitsByMilestone = await Promise.all(
      milestones.map((milestone) => lapis.getWorkingUnitsForMilestone(milestone.id).catch(() => [])),
    );
    const activeWorkers = unitsByMilestone
      .flat()
      .filter((unit) => !["completed", "failed", "timed_out"].includes(unit.status));
    return { mission, milestones, activeWorkers, cost };
  }
  const STUB_MODEL = "kilo/kilo-auto/free";

  async function resolveDefaultModel(pinyxConfig: { endpoint?: string } | null): Promise<string> {
    const endpoint = pinyxConfig?.endpoint?.replace(/\/$/, "");
    if (!endpoint) return STUB_MODEL;
    try {
      const res = await fetch(`${endpoint}/v1/models`, { method: "GET", signal: AbortSignal.timeout(3000) });
      if (!res.ok) return STUB_MODEL;
      const body = await res.json() as { data?: { id: string }[] };
      const models = body.data ?? [];
      // Prefer a non-free model for reliability, fall back to first available
      const real = models.find((m) => !m.id.includes("/free"));
      return real?.id ?? models[0]?.id ?? STUB_MODEL;
    } catch {
      return STUB_MODEL;
    }
  }

  app.post("/api/missions", async (request, reply) => {
    const { description, cloneUrl } = request.body as { description: string; cloneUrl?: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }
    const pinyxConfig = await lapis.getSetting<{ modelHints?: Partial<MissionConfig["modelHints"]>; endpoint?: string }>("pinyx_config");
    const savedHints = pinyxConfig?.modelHints ?? {};
    const allStub = Object.values(savedHints).every((v) => !v || v === STUB_MODEL);
    const defaultModel = allStub ? await resolveDefaultModel(pinyxConfig) : STUB_MODEL;
    const modelHints = {
      orchestrator: defaultModel,
      worker: defaultModel,
      validator_scrutiny: defaultModel,
      validator_user_testing: defaultModel,
      research: defaultModel,
      ...savedHints,
    };
    const config: MissionConfig = {
      ...missionConfig,
      modelHints,
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
