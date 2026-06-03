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
import { createBumblebeeClient } from "./clients/bumblebee-client.js";
import { createBumblebeeRunner } from "./orchestrator/bumblebee-runner.js";
import { bumblebeeRoutes } from "./routes/bumblebee.js";

async function main() {
  const config = loadConfig();
  const lapis = createLaPisClient({ lapisEndpoint: config.lapisEndpoint });
  const eventBus = createEventBus();
  const agentLogger = createAgentLogger();

  // Startup healthcheck — LaPis is required
  try {
    await lapis.ping();
    console.log("[startup] LaPis connected");
  } catch {
    console.error("[startup] LaPis UNREACHABLE — exiting");
    process.exit(1);
  }

  // Bumblebee supply-chain scanner
  const bumblebeeClient = createBumblebeeClient();
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
    gitMainBranch: config.gitMainBranch,
    maxConcurrent: config.maxConcurrentMissions,
    onPostMilestoneScan: async (missionId: string, root: string) => {
      try {
        await bumblebeeRunner.triggerScan(missionId, { profile: "project", root });
      } catch (err) {
        console.warn(`[bumblebee] Auto-scan failed for mission ${missionId}:`, err instanceof Error ? err.message : err);
      }
    },
  });

  try {
    const paused = await lapis.listMissions({ status: "paused" });
    for (const mission of paused) {
      console.log(`[startup] Resuming paused mission: ${mission.id}`);
      pool.submit(mission.id);
    }
  } catch (err) {
    console.warn("[startup] Could not check for paused missions:", err instanceof Error ? err.message : err);
  }

  const app = Fastify({ logger: true });
  await app.register(websocket);

  // Auth (no-op if API_KEY not set)
  registerGlobalAuth(app, config.apiKey);

  registerWebSocketRoutes(app, eventBus, config.apiKey);

  // Health endpoint
  app.get("/health", async () => {
    const lapisOk = await lapis.ping().then(() => true, () => false);
    let pinyxOk = false;
    try {
      const pinyxConfig = await lapis.getSetting<{ endpoint: string }>("pinyx_config");
      if (pinyxConfig?.endpoint) {
        const res = await fetch(`${pinyxConfig.endpoint.replace(/\/$/, "")}/v1/models`, {
          method: "GET",
          signal: AbortSignal.timeout(3000),
        });
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
    missionConfig: {
      workerTimeouts: config.workerTimeouts,
      costCap: config.missionCostCap,
      maxValidatorRetries: config.maxValidatorRetries,
      maxRescopes: config.maxRescopes,
    },
  });
  await app.register(checkpointRoutes, { lapis });

  // PiNyx config (fully UI-configured, stored in LaPis settings)
  registerPinyxRoutes(app, { lapis });

  // GitHub PAT (fully UI-configured, stored in LaPis settings)
  registerGitHubRoutes(app, { lapis, repoRoot: config.repoRoot });

  // Code context proxy (summary, graph, hotspots)
  registerCodeContextRoutes(app, { lapis });

  // Bumblebee routes
  await app.register(bumblebeeRoutes, { lapis, bumblebeeClient, bumblebeeRunner });

  // Start
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
    await app.close();
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch(console.error);
