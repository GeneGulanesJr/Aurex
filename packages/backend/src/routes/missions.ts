// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { MissionConfig, QuotaWindow } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { MissionRunnerPool } from "../orchestrator/mission-runner-pool.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import type { AppConfig } from "../config.js";
import { checkQuota, resetWindow } from "../enforcement/quota-gate.js";

const defaultMissionConfig: Omit<MissionConfig, "modelHints"> = {
  workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
  costCap: 50,
  maxValidatorRetries: 2,
  maxRescopes: 5,
};

export async function missionRoutes(
  app: FastifyInstance,
  { lapis, pool, agentLogger, missionConfig = defaultMissionConfig, appConfig }: {
    lapis: LaPisClient;
    pool: MissionRunnerPool;
    agentLogger?: AgentLogger;
    missionConfig?: typeof defaultMissionConfig;
    appConfig?: AppConfig;
  },
) {
  async function hydrateMissionPayload(missionId: string) {
    const mission = await lapis.getMission(missionId);
    // GET /missions/:id/milestones may not exist in all LaPis versions,
    // so fall back to empty — the frontend receives milestones via WS events.
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
  const FALLBACK_MODEL = "kilo/kilo-auto/free";

  async function resolveDefaultModel(pinyxConfig: { endpoint?: string } | null): Promise<string> {
    const endpoint = pinyxConfig?.endpoint?.replace(/\/$/, "");
    if (!endpoint) return FALLBACK_MODEL;
    try {
      const res = await fetch(`${endpoint}/v1/models`, { method: "GET", signal: AbortSignal.timeout(3000) });
      if (!res.ok) return FALLBACK_MODEL;
      const body = await res.json() as { data?: { id: string }[] };
      const models = body.data ?? [];
      // Prefer a non-free model for reliability, fall back to first available
      const real = models.find((m) => !m.id.includes("/free"));
      return real?.id ?? models[0]?.id ?? FALLBACK_MODEL;
    } catch {
      return FALLBACK_MODEL;
    }
  }

  app.post("/api/missions", async (request, reply) => {
    const { description, cloneUrl } = request.body as { description: string; cloneUrl?: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }

    if (appConfig?.quotaEnabled) {
      const quotaWindow = await lapis.getSetting<QuotaWindow>("quota_window");
      const now = new Date();
      const quotaResult = checkQuota(quotaWindow, now);
      if (quotaResult.reason === "window_expired" && quotaWindow) {
        const reset = resetWindow(quotaWindow, now);
        await lapis.setSetting("quota_window", reset);
      } else if (!quotaResult.ok) {
        return reply.status(429).send({
          error: "quota_exhausted",
          remainingMs: quotaResult.remainingWindowMs,
          windowResetsAt: quotaResult.windowResetsAt,
        });
      }
    }

    const pinyxConfig = await lapis.getSetting<{ modelHints?: Partial<MissionConfig["modelHints"]>; endpoint?: string }>("pinyx_config");
    const savedHints = pinyxConfig?.modelHints ?? {};
    const allStub = Object.values(savedHints).every((v) => !v || v === FALLBACK_MODEL);
    const defaultModel = allStub ? await resolveDefaultModel(pinyxConfig) : FALLBACK_MODEL;
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

  app.get("/api/missions/:id/agent-logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!agentLogger) {
      return reply.status(503).send({ error: "Agent logger not available" });
    }
    try {
      const mission = await lapis.getMission(id);
      if (!mission) {
        return reply.status(404).send({ error: "Mission not found" });
      }
      const entries = agentLogger.getEntries({ missionId: id });
      const logs = entries.map((e) => ({
        sessionId: e.sessionId,
        agentType: e.agentType,
        missionId: e.missionId,
        milestoneId: e.milestoneId,
        unitId: e.unitId,
        event: e.event,
        message: formatLogMessage(e.event, e.data),
        timestamp: e.timestamp,
        data: e.data,
      }));
      return { logs };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });
}

function formatLogMessage(event: string, data?: Record<string, unknown>): string {
  switch (event) {
    case "spawned": return "Agent spawned";
    case "prompt_sent": return "Task prompt sent";
    case "tool_call": return `Called tool: ${data?.tool ?? "unknown"}`;
    case "cost_update": return `Cost: $${typeof data?.cost === "number" ? data.cost.toFixed(4) : "0.0000"}`;
    case "completed": return "Agent completed successfully";
    case "timed_out": return "Agent timed out";
    case "failed": return `Agent failed: ${data?.error ?? "unknown error"}`;
    case "aborted": return "Agent aborted";
    default: return event;
  }
}
