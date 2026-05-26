import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase, closeDatabase } from './db.js';
import { runMigrations } from './migrator.js';
import { missionRoutes } from './routes/missions.js';
import { MilestoneLoop } from './orchestrator/milestone-loop.js';
import { createPiProcessManager } from './spawn/pi-process-manager.js';
import { createLaPisClient } from './clients/lapis-client.js';
import { createRouterClient } from './clients/router-client.js';
import { onMissionEvent } from './events.js';

async function main() {
  const config = loadConfig();
  const db = openDatabase(config);

  console.log('Running migrations...');
  runMigrations(db);
  console.log('Migrations complete.');

  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  await fastify.register(websocket);

  const lapis = createLaPisClient(config);
  const router = createRouterClient(config);
  const piManager = createPiProcessManager(config);
  const milestoneLoop = new MilestoneLoop(piManager, router, lapis);

  fastify.register(missionRoutes, { milestoneLoop });

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/ws/:missionId', { websocket: true }, (socket, request) => {
    const { missionId } = request.params as { missionId: string };

    const unsubscribe = onMissionEvent(missionId, (event) => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        // socket may be closed
      }
    });

    socket.on('close', () => {
      unsubscribe();
    });

    socket.on('error', () => {
      unsubscribe();
    });
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await fastify.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`Aurex backend listening on ${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
