// packages/backend/src/server.ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { createLaPisClient } from "./clients/lapis-client.js";
import { createEventBus, registerWebSocketRoutes } from "./ws/events.js";
import { createAgentLogger } from "./agents/agent-logger.js";
import { createMissionRunnerPool } from "./orchestrator/mission-runner-pool.js";
import { missionRoutes } from "./routes/missions.js";
import { checkpointRoutes } from "./routes/checkpoints.js";
import { registerGlobalAuth } from "./routes/auth.js";
import { registerGitHubRoutes } from "./routes/github.js";
import { registerPinyxRoutes } from "./routes/pinyx.js";
import { registerCodeContextRoutes } from "./routes/code-context.js";
import { registerRepoExploreRoutes } from "./routes/repo-explore.js";
import { registerMutationRoutes } from "./routes/mutation-routes.js";
import { createBumblebeeClient } from "./clients/bumblebee-client.js";
import type { ExposureCatalog } from "@aurex/shared";
import { createBumblebeeRunner } from "./orchestrator/bumblebee-runner.js";
import { bumblebeeRoutes } from "./routes/bumblebee.js";
import { quotaRoutes } from "./routes/quota.js";
import { registerUpdateRoutes } from "./routes/update.js";
import { startTelemetry } from "./telemetry.js";
import { createSettingsExecutionQueueStore } from "./queue/execution-queue-store.js";
import { createSettingsPreparedSessionStore } from "./sessions/prepared-session-store.js";
import {
  createPreparedSessionService,
  createSessionMessageBus,
} from "./sessions/prepared-session-service.js";
import { agentSessionRoutes } from "./routes/agent-sessions.js";
import { executionQueueRoutes } from "./routes/execution-queue.js";
import { createExecutionWorker } from "./queue/execution-worker.js";
import { createMissionQueueHandlers } from "./orchestrator/mission-queue-handlers.js";
import {
  createCheckpointDedupTracker,
  resolveCheckpointDecision,
} from "./routes/checkpoints.js";

async function main() {
  const config = loadConfig();
  const telemetry = startTelemetry();
  if (telemetry.enabled) {
    console.log("[startup] OpenTelemetry metrics enabled");
  }
  const lapis = createLaPisClient({ lapisEndpoint: config.lapisEndpoint });
  const eventBus = createEventBus();
  const agentLogger = createAgentLogger();
  // Single shared dedup tracker so a checkpoint decision submitted over the
  // WebSocket is not re-processed via the REST route (or vice versa).
  const checkpointDedup = createCheckpointDedupTracker();
  const executionQueue = createSettingsExecutionQueueStore(lapis);
  const preparedSessions = createSettingsPreparedSessionStore(lapis);
  // Single shared message bus so messages posted via the REST API reach the
  // durable session launcher through LaunchAgentContext.drainMessages().
  const sessionMessageBus = createSessionMessageBus();
  const preparedSessionService = createPreparedSessionService({
    sessions: preparedSessions,
    queue: executionQueue,
    messages: sessionMessageBus,
  });

  // Startup healthcheck — LaPis is required
  try {
    await lapis.ping();
    console.log("[startup] LaPis connected");
  } catch {
    console.error("[startup] LaPis UNREACHABLE — exiting");
    process.exit(1);
  }

  // Bumblebee supply-chain scanner (falls back to native JS scanner if binary missing)
  const bumblebeeClient = createBumblebeeClient(async () => {
    const stored = await lapis.getSetting<ExposureCatalog>("bumblebee_catalog");
    return stored ?? null;
  });
  const bumblebeeRunner = createBumblebeeRunner({
    lapis,
    bumblebee: bumblebeeClient,
    eventBus,
  });

  const pool = createMissionRunnerPool({
    lapis,
    eventBus,
    logger: agentLogger,
    agentDir: process.env.PI_AGENT_DIR || `${process.env.HOME}/.pi/agent`,
    repoRoot: config.repoRoot,
    aurexRoot: config.aurexRoot,
    gitMainBranch: config.gitMainBranch,
    maxConcurrent: config.maxConcurrentMissions,
    researchTimeout: config.researchTimeout,
    validatorTimeout: config.validatorTimeout,
    queue: executionQueue,
    onPostMilestoneScan: async (missionId: string, root: string) => {
      try {
        await bumblebeeRunner.triggerScan(missionId, {
          profile: "project",
          root,
        });
      } catch (err) {
        console.warn(
          `[bumblebee] Auto-scan failed for mission ${missionId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  });

  // Boot recovery: resume any mission left in a non-terminal state by a prior
  // process crash/restart. Previously only "paused" missions were resumed; a
  // crash mid-build left missions stuck in running/planning/executing forever.
  try {
    const nonTerminalStatuses = ["paused", "running", "planning", "executing", "waiting_checkpoint"];
    const orphans: string[] = [];
    for (const st of nonTerminalStatuses) {
      const missions = await lapis.listMissions({ status: st });
      for (const mission of missions) {
        orphans.push(mission.id);
      }
    }
    const seen = new Set<string>();
    for (const missionId of orphans) {
      if (seen.has(missionId)) continue;
      seen.add(missionId);
      console.log(`[startup] Resuming non-terminal mission: ${missionId}`);
      pool.submit(missionId);
    }
  } catch (err) {
    console.warn(
      "[startup] Could not check for non-terminal missions:",
      err instanceof Error ? err.message : err,
    );
  }

  // Seed quota config from env vars if not already present in LaPis
  try {
    const existingQuotaConfig = await lapis.getSetting("quota_config");
    if (!existingQuotaConfig) {
      await lapis.setSetting("quota_config", {
        enabled: config.quotaEnabled,
        windowDurationMs: config.quotaWindowDurationMs,
        burnDurationMs: config.quotaBurnDurationMs,
        providers: [],
      });
      console.log("[startup] Seeded initial quota_config from env vars");
    }
  } catch (err) {
    console.warn(
      "[startup] Could not seed quota_config:",
      err instanceof Error ? err.message : err,
    );
  }

  const app = Fastify({ logger: true });
  telemetry.registerFastifyMetrics(app);
  await app.register(websocket);

  registerGlobalAuth(app, config.auth0Domain, config.auth0Audience, config.authDisabled);

  registerWebSocketRoutes(app, eventBus, {
    auth0Domain: config.auth0Domain,
    auth0Audience: config.auth0Audience,
    authDisabled: config.authDisabled,
    resolveCheckpoint: (input) =>
      resolveCheckpointDecision(lapis, checkpointDedup, input),
  });

  // Health endpoint
  app.get("/health", async () => {
    const lapisOk = await lapis.ping().then(
      () => true,
      () => false,
    );
    let pinyxOk = false;
    try {
      const pinyxConfig = await lapis.getSetting<{ endpoint: string }>(
        "pinyx_config",
      );
      if (pinyxConfig?.endpoint) {
        const res = await fetch(
          `${pinyxConfig.endpoint.replace(/\/$/, "")}/v1/models`,
          {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          },
        );
        pinyxOk = res.ok;
      }
    } catch {
      pinyxOk = false;
    }
    const ok = lapisOk && pinyxOk;
    return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
  });

  // REST routes
  await app.register(missionRoutes, {
    lapis,
    pool,
    agentLogger,
    eventBus,
    missionConfig: {
      workerTimeouts: config.workerTimeouts,
      costCap: config.missionCostCap,
      maxValidatorRetries: config.maxValidatorRetries,
      maxRescopes: config.maxRescopes,
      validatorToolCallCap: config.validatorToolCallCap,
    },
  });
  await app.register(checkpointRoutes, { lapis, dedup: checkpointDedup });

  // PiNyx config (fully UI-configured, stored in LaPis settings)
  registerPinyxRoutes(app, { lapis });

  // GitHub PAT (fully UI-configured, stored in LaPis settings)
  registerGitHubRoutes(app, { lapis, repoRoot: config.repoRoot });

  // Code context proxy (summary, graph, hotspots)
  registerCodeContextRoutes(app, { lapis });

  // Repo explore (auto-explore + suggestions)
  registerRepoExploreRoutes(app, { lapis, bumblebeeClient });

  // Mutation testing routes (Stryker on scanned repos)
  registerMutationRoutes(app, { lapis, eventBus });

  // Bumblebee routes
  await app.register(bumblebeeRoutes, {
    lapis,
    bumblebeeClient,
    bumblebeeRunner,
  });

  // Quota / coding plan routes
  await app.register(quotaRoutes, { lapis, config });

  // Self-update detection + apply
  registerUpdateRoutes(app, { eventBus, aurexRoot: config.aurexRoot, gitMainBranch: config.gitMainBranch });

  // Durable execution queue / prepared agent sessions
  const executionWorker = config.durableQueueEnabled
    ? createExecutionWorker(
        {
          queue: executionQueue,
          handlers: createMissionQueueHandlers({
            pool,
            sessions: preparedSessions,
            queue: executionQueue,
            messages: sessionMessageBus,
          }),
        },
        { workerId: config.queueWorkerId, pollMs: config.queueWorkerPollMs },
      )
    : null;

  if (config.preparedSessionsEnabled) {
    // The prepared-session routes call `queue.enqueue(...)` on `start()`. The
    // queue worker that drains those jobs is only created when the durable
    // queue is enabled. Mounting the routes without the worker would let
    // `start()` enqueue jobs that nothing ever drains → silent ghost sessions.
    // Fail loudly at boot instead of failing silently at runtime.
    if (!config.durableQueueEnabled) {
      throw new Error(
        "AUREX_PREPARED_SESSIONS_ENABLED=true requires AUREX_DURABLE_QUEUE_ENABLED=true; " +
          "the queue worker is what drains `agent_session_start` jobs enqueued by the " +
          "prepared-session routes. Refusing to mount routes without a worker.",
      );
    }
    await app.register(agentSessionRoutes, { service: preparedSessionService });
  }
  if (config.durableQueueEnabled) {
    await app.register(executionQueueRoutes, {
      queue: executionQueue,
      sessions: preparedSessions,
      reconcilerDryRunDefault: config.staleReconcilerDryRun,
      activeReconciliationEnabled: config.staleReconcilerEnabled,
    });
    executionWorker?.start();
  }

  // Start
  // Scheduled mission reconciler: detects missions whose LaPis status is
  // non-terminal but that have no live runner in the pool (orphaned by a
  // crash, OOM kill, or unhandled error that left status stale). Marks them
  // failed so they don't block /api/missions/current forever.
  const RECONCILER_INTERVAL_MS = 120_000;
  const activePoolMissionIds = () => new Set(pool.getActiveMissions().map((m) => m.missionId));
  async function reconcileOrphanedMissions() {
    try {
      const liveIds = activePoolMissionIds();
      const nonTerminal = ["running", "planning", "executing", "waiting_checkpoint"];
      for (const st of nonTerminal) {
        const missions = await lapis.listMissions({ status: st });
        for (const mission of missions) {
          if (liveIds.has(mission.id)) continue;
          console.warn(`[reconciler] Mission ${mission.id} is non-terminal (${st}) but has no live runner — marking failed.`);
          await lapis.updateMissionStatus(mission.id, "failed").catch(() => {});
          eventBus.emit({ type: "mission_error", missionId: mission.id, code: "runner_lost", message: `Mission was ${st} with no live runner; marked failed by reconciler.`, recoverable: false });
          eventBus.emit({ type: "mission_status", missionId: mission.id, status: "failed" });
        }
      }
    } catch (err) {
      console.warn("[reconciler] scan failed:", err instanceof Error ? err.message : err);
    }
  }
  const reconcilerTimer = setInterval(() => { void reconcileOrphanedMissions(); }, RECONCILER_INTERVAL_MS);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`[server] Listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining agents...`);
    await Promise.race([
      pool.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    ]);
    console.log("[shutdown] Agents drained, closing server");
    clearInterval(reconcilerTimer);
    await executionWorker?.stop();
    await app.close();
    await telemetry.shutdown();
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch(console.error);
