// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { MissionConfig, QuotaWindow, QuotaConfig } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { MissionRunnerPool, PoolMissionStatus } from "../orchestrator/mission-runner-pool.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import { checkQuota, resetWindow } from "../enforcement/quota-gate.js";
import { listRepos } from "../clients/github-client.js";
import { normalizeGitHubCloneUrl } from "../orchestrator/repo-prep.js";


interface GitHubTokenSetting {
  access_token: string;
}

async function authorizeMissionCloneUrl(
  lapis: LaPisClient,
  cloneUrl: string,
): Promise<{ ok: true; cloneUrl: string } | { ok: false; status: number; error: string }> {
  let normalizedCloneUrl: string;
  try {
    normalizedCloneUrl = normalizeGitHubCloneUrl(cloneUrl);
  } catch {
    return { ok: false, status: 400, error: "Invalid GitHub clone URL" };
  }

  const tokenData = await lapis.getSetting<GitHubTokenSetting>("github_token");
  if (!tokenData?.access_token) {
    return { ok: false, status: 401, error: "GitHub is not connected" };
  }

  let repos;
  try {
    repos = await listRepos(tokenData.access_token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[missions] listRepos error:", message);
    return { ok: false, status: 502, error: "Failed to fetch repos from GitHub" };
  }

  const allowed = repos.some(
    (candidate) => normalizeGitHubCloneUrl(candidate.clone_url) === normalizedCloneUrl,
  );
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: "Repository is not available to this GitHub connection",
    };
  }

  return { ok: true, cloneUrl: normalizedCloneUrl };
}

const defaultMissionConfig: Omit<MissionConfig, "modelHints"> = {
  workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
  costCap: 50,
  maxValidatorRetries: 2,
  maxRescopes: 5,
  validatorToolCallCap: 0,
};

export async function missionRoutes(
  app: FastifyInstance,
  { lapis, pool, agentLogger, missionConfig = defaultMissionConfig, eventBus }: {
    lapis: LaPisClient;
    pool: MissionRunnerPool;
    agentLogger?: AgentLogger;
    missionConfig?: typeof defaultMissionConfig;
    eventBus?: { emit: (event: any) => void };
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
      .filter((unit) => !["completed", "failed", "timed_out", "superseded"].includes(unit.status));
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

    let authorizedCloneUrl: string | undefined;
    if (cloneUrl) {
      const authorization = await authorizeMissionCloneUrl(lapis, cloneUrl);
      if (!authorization.ok) {
        return reply.status(authorization.status).send({ error: authorization.error });
      }
      authorizedCloneUrl = authorization.cloneUrl;
    }

    const quotaConfig = await lapis.getSetting<QuotaConfig>("quota_config");
    if (quotaConfig?.enabled) {
      const allWindows = (await lapis.getSetting<Record<string, QuotaWindow>>("quota_windows")) ?? {};
      const now = new Date();
      for (const providerEntry of quotaConfig.providers) {
        if (!providerEntry.tracked) continue;
        const window = allWindows[providerEntry.providerId];
        if (!window) continue;
        const result = checkQuota(window, now);
        if (result.reason === "window_expired") {
          const reset = resetWindow(window, now);
          allWindows[providerEntry.providerId] = reset;
          await lapis.setSetting("quota_windows", allWindows);
        } else if (!result.ok) {
          return reply.status(429).send({
            error: "quota_exhausted",
            providerId: providerEntry.providerId,
            remainingMs: result.remainingWindowMs,
            windowResetsAt: result.windowResetsAt,
          });
        }
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
      ...(authorizedCloneUrl && { cloneUrl: authorizedCloneUrl }),
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

  app.get("/api/missions/active", async (request) => {
    const query = request.query as { includeHistory?: string };
    const includeHistory = Math.max(0, Math.min(50, Number.parseInt(query.includeHistory ?? "10", 10) || 0));

    const active = pool.getActiveMissions();

    if (includeHistory === 0) {
      return { missions: active };
    }

    // Pull recent terminal missions from LaPis so the sidebar can survive
    // page refreshes and server restarts. We exclude any ids already in the
    // pool (the in-flight entries are authoritative for current state).
    const activeIds = new Set(active.map((m) => m.missionId));
    let history: Array<PoolMissionStatus & { description?: string }> = [];
    try {
      const [completed, failed] = await Promise.all([
        lapis.listMissions({ status: "completed" }),
        lapis.listMissions({ status: "failed" }),
      ]);
      const merged = [
        ...completed.map((m) => ({ missionId: m.id, state: m.status as PoolMissionStatus["state"], description: m.description })),
        ...failed.map((m) => ({ missionId: m.id, state: m.status as PoolMissionStatus["state"], description: m.description })),
      ];
      history = merged
        .filter((m) => !activeIds.has(m.missionId))
        .sort((a, b) => (a.missionId < b.missionId ? 1 : -1)) // newest-first by id (uuid-ish); LaPis returns insertion order but we cap so the tail is fine
        .slice(0, includeHistory);
    } catch {
      // LaPis unavailable for history: return pool-only rather than 500ing
    }

    return { missions: [...active, ...history] };
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

    // Notify frontend that mission status changed
    eventBus?.emit({
      type: "mission_status",
      missionId: id,
      status: "planning",
    });

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
