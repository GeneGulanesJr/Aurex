// packages/backend/src/server.ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { createLaPisClient } from "./clients/lapis-client.js";
import { createPinyxClient } from "./clients/pinyx-client.js";
import { createEventBus, registerWebSocketRoutes } from "./ws/events.js";
import { createMissionRunnerPool } from "./orchestrator/mission-runner-pool.js";
import { missionRoutes } from "./routes/missions.js";
import { checkpointRoutes } from "./routes/checkpoints.js";
import { registerGlobalAuth } from "./routes/auth.js";
import { registerGitHubRoutes } from "./routes/github.js";
import { registerPinyxRoutes } from "./routes/pinyx.js";

async function main() {
  const config = loadConfig();
  const lapis = createLaPisClient({ lapisEndpoint: config.lapisEndpoint });
  const pinyx = createPinyxClient({ endpoint: config.pinyxEndpoint });
  const eventBus = createEventBus();

  // Startup healthchecks
  try {
    await lapis.ping();
    console.log("[startup] LaPis connected");
  } catch {
    console.error("[startup] LaPis UNREACHABLE — exiting");
    process.exit(1);
  }

  try {
    await pinyx.ping();
    console.log("[startup] PiNyx connected");
  } catch {
    console.error("[startup] PiNyx UNREACHABLE — exiting");
    process.exit(1);
  }

  const pool = createMissionRunnerPool({
    lapis,
    pinyx,
    eventBus,
    agentDir: process.env.PI_AGENT_DIR || `${process.env.HOME}/.pi/agent`,
    repoRoot: config.repoRoot,
    gitMainBranch: config.gitMainBranch,
    maxConcurrent: config.maxConcurrentMissions,
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
    const pinyxOk = await pinyx.ping().then(() => true, () => false);
    const ok = lapisOk && pinyxOk;
    return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
  });

  // REST routes
  await app.register(missionRoutes, {
    lapis,
    pool,
    missionConfig: {
      modelHints: config.modelHints,
      workerTimeouts: config.workerTimeouts,
      costCap: config.missionCostCap,
      maxValidatorRetries: config.maxValidatorRetries,
      maxRescopes: config.maxRescopes,
    },
  });
  await app.register(checkpointRoutes, { lapis });

  // PiNyx config (env-backed defaults, UI-configured overrides stored in LaPis settings)
  registerPinyxRoutes(app, {
    lapis,
    endpoint: config.pinyxEndpoint,
    modelHints: config.modelHints,
  });

  // GitHub OAuth/config (env-backed or configured from UI into LaPis settings)
  registerGitHubRoutes(app, { lapis });

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
