// packages/backend/src/server.ts
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createLaPisClient } from "./clients/lapis-client.js";
import { createPinyxClient } from "./clients/pinyx-client.js";
import { createEventBus } from "./ws/events.js";
import { missionRoutes } from "./routes/missions.js";
import { checkpointRoutes } from "./routes/checkpoints.js";

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

  const app = Fastify({ logger: true });

  // Health endpoint
  app.get("/health", async () => {
    const lapisOk = await lapis.ping().then(() => true, () => false);
    const pinyxOk = await pinyx.ping().then(() => true, () => false);
    const ok = lapisOk && pinyxOk;
    return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
  });

  // REST routes
  await app.register(missionRoutes, { lapis });
  await app.register(checkpointRoutes, {
    resolveCheckpoint: async (missionId, decision, guidance, reason) => {
      console.log(`[checkpoint] ${missionId}: ${decision} guidance=${guidance} reason=${reason}`);
      return { accepted: true };
    },
  });

  // Start
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`[server] Listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
