import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import type { MilestoneLoop } from '../orchestrator/milestone-loop.js';

export async function missionRoutes(
  fastify: FastifyInstance,
  options: { milestoneLoop: MilestoneLoop },
) {
  const { milestoneLoop } = options;

  fastify.post<{
    Body: { description: string };
  }>('/missions', async (request, reply) => {
    const { description } = request.body || {};

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.status(400).send({ error: 'description is required' });
    }

    const { createPlanner } = await import('../orchestrator/planner.js');
    const { createLaPisClient } = await import('../clients/lapis-client.js');
    const { createRouterClient } = await import('../clients/router-client.js');
    const { loadConfig } = await import('../config.js');

    const config = loadConfig();
    const lapis = createLaPisClient(config);
    const router = createRouterClient(config);
    const planner = createPlanner(lapis, router, config);

    try {
      const result = await planner.plan(description.trim());

      setImmediate(() => {
        milestoneLoop.run(result.mission).catch((err) => {
          request.log.error({ err }, 'Milestone loop error');
        });
      });

      return reply.status(201).send({
        missionId: result.mission.id,
        plan: {
          milestones: result.milestones.map(m => ({
            title: m.title,
            description: m.description,
            workingUnits: result.workingUnits
              .filter(wu => wu.milestoneId === m.id)
              .map(wu => ({
                title: wu.title,
                description: wu.description,
                taskSpec: wu.taskSpecJson,
                filePaths: JSON.parse(wu.filePathsJson || '[]'),
                modules: JSON.parse(wu.modulesJson || '[]'),
              })),
            validationContracts: JSON.parse(m.validationContractsJson || '[]'),
          })),
        },
      });
    } catch (err) {
      request.log.error({ err }, 'Planning failed');
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Planning failed',
      });
    }
  });

  fastify.post<{
    Params: { id: string };
    Body: { decision: string; overrideReason?: string; revisedSpec?: string };
  }>('/missions/:id/checkpoint', async (request, reply) => {
    const { id } = request.params;
    const { decision } = request.body || {};

    if (!decision || !['approve', 'reject', 'override'].includes(decision)) {
      return reply.status(400).send({ error: 'decision must be approve, reject, or override' });
    }

    const resolved = milestoneLoop.resolveCheckpoint(id, decision as 'approve' | 'reject' | 'override');
    if (!resolved) {
      return reply.status(409).send({ error: 'No pending checkpoint for this mission' });
    }

    if (decision === 'reject') {
      const db = getDb();
      db.prepare(`UPDATE missions SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
    }

    return reply.send({ accepted: true });
  });

  fastify.get<{
    Params: { id: string };
  }>('/missions/:id', async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const mission = db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    if (!mission) {
      return reply.status(404).send({ error: 'Mission not found' });
    }

    const milestones = db.prepare(
      `SELECT id, seq, title, status FROM milestones WHERE mission_id = ? ORDER BY seq`,
    ).all(id) as Array<{ id: string; seq: number; title: string; status: string }>;

    const activeWorkers = db.prepare(
      `SELECT id, title, status, started_at FROM working_units WHERE mission_id = ? AND status IN ('spawned', 'running')`,
    ).all(id) as Array<{ id: string; title: string; status: string; started_at: string | null }>;

    const recentBroadcasts = db.prepare(
      `SELECT id, category, content, created_at FROM broadcasts WHERE mission_id = ? ORDER BY created_at DESC LIMIT 20`,
    ).all(id) as Array<{ id: string; category: string; content: string; created_at: string }>;

    const costRow = db.prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries WHERE mission_id = ?`,
    ).get(id) as { total: number };

    const retryRow = db.prepare(
      `SELECT COALESCE(SUM(attempt_count), 0) as total FROM retry_counters WHERE mission_id = ?`,
    ).get(id) as { total: number };

    const rescopeRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM rescope_history WHERE mission_id = ?`,
    ).get(id) as { cnt: number };

    const currentMilestone = milestones.find(m => m.status === 'in_progress');

    return reply.send({
      id: mission.id,
      description: mission.description,
      status: mission.status,
      currentMilestone: currentMilestone?.title ?? null,
      milestones,
      activeWorkers: activeWorkers.map(w => ({
        id: w.id,
        title: w.title,
        status: w.status,
        elapsedMs: w.started_at ? Date.now() - new Date(w.started_at).getTime() : 0,
      })),
      recentBroadcasts: recentBroadcasts.map(b => ({
        id: b.id,
        category: b.category,
        content: b.content,
        createdAt: b.created_at,
      })),
      costTotal: costRow.total / 10000,
      retryCount: retryRow.total,
      rescopeCount: rescopeRow.cnt,
    });
  });

  fastify.get<{
    Querystring: { status?: string; limit?: string; offset?: string };
  }>('/missions', async (request, reply) => {
    const { status } = request.query;
    const rawLimit = parseInt(request.query.limit || '50', 10);
    const rawOffset = parseInt(request.query.offset || '0', 10);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.max(1, Math.min(rawLimit, 200));
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    const db = getDb();

    let query = `SELECT id, description, status, created_at FROM missions`;
    const params: unknown[] = [];

    if (status) {
      query += ` WHERE status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const missions = db.prepare(query).all(...params) as Array<{
      id: string;
      description: string;
      status: string;
      created_at: string;
    }>;

    const countQuery = status
      ? `SELECT COUNT(*) as total FROM missions WHERE status = ?`
      : `SELECT COUNT(*) as total FROM missions`;
    const countParams = status ? [status] : [];
    const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

    return reply.send({
      missions: missions.map(m => ({
        id: m.id,
        description: m.description,
        status: m.status,
        createdAt: m.created_at,
      })),
      total,
    });
  });
}
