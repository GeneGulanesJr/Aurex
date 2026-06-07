import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { scanRepoForMutation, runMutationTests } from "../scanner/mutation-scanner.js";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";
import type { MutationRunStatus } from "@aurex/shared";

interface MutationRouteDeps {
  lapis: LaPisClient;
  eventBus: EventBus;
}

interface ActiveRun {
  status: MutationRunStatus;
  repoName: string;
  startedAt: number;
  lastAccessAt: number;
}

/**
 * In-memory registry of mutation runs with TTL eviction.
 * - Entries expire 1 hour after the last access (covers any reasonable
 *   long-poll, but doesn't leak memory if a client never polls again).
 * - Cap at MAX_RUNS to prevent unbounded growth in pathological cases.
 * - For multi-instance deployments, replace with a LaPis-backed store.
 */
const MAX_RUNS = 100;
const RUN_TTL_MS = 60 * 60 * 1000;
const activeRuns = new Map<string, ActiveRun>();

function evictExpired(): void {
  const now = Date.now();
  for (const [id, run] of activeRuns) {
    if (now - run.lastAccessAt > RUN_TTL_MS) activeRuns.delete(id);
  }
  if (activeRuns.size > MAX_RUNS) {
    const sorted = [...activeRuns.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
    const toDrop = sorted.slice(0, activeRuns.size - MAX_RUNS);
    for (const [id] of toDrop) activeRuns.delete(id);
  }
}

export function registerMutationRoutes(app: FastifyInstance, deps: MutationRouteDeps): void {
  const { lapis, eventBus } = deps;

  // GET /api/repos/:repoName/mutation — read-only scan summary
  app.get<{ Params: { repoName: string } }>("/api/repos/:repoName/mutation", async (req, reply) => {
    const repoPath = await lapis.getRepoPath(req.params.repoName);
    if (!repoPath) {
      return reply.code(404).send({ error: `Repo ${req.params.repoName} not found` });
    }
    return scanRepoForMutation(repoPath);
  });

  // POST /api/repos/:repoName/mutation/run — kick off a Stryker run
  app.post<{ Params: { repoName: string } }>("/api/repos/:repoName/mutation/run", async (req, reply) => {
    const repoPath = await lapis.getRepoPath(req.params.repoName);
    if (!repoPath) {
      return reply.code(404).send({ error: `Repo ${req.params.repoName} not found` });
    }

    const preCheck = await scanRepoForMutation(repoPath);
    if (!preCheck.strykerConfigured) {
      return reply.code(400).send({
        error: `Stryker is not configured in ${req.params.repoName}. Add a stryker.config.* file.`,
      });
    }

    evictExpired();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    activeRuns.set(runId, {
      status: { state: "starting", runId, startedAt },
      repoName: req.params.repoName,
      startedAt: Date.now(),
      lastAccessAt: Date.now(),
    });

    // Fire-and-forget. Progress is pushed over the existing WebSocket event bus
    // (subscribed by the dashboard via `mutation_progress` events).
    void runMutationTests(repoPath, {
      onProgress: (line) => {
        eventBus.emit({
          type: "mutation_progress",
          runId,
          repoName: req.params.repoName,
          line,
        });
      },
    })
      .then((result) => {
        const run = activeRuns.get(runId);
        if (!run) return;
        if (result.exitCode === 0) {
          run.status = { state: "completed", runId, summary: result.summary };
        } else {
          run.status = {
            state: "failed",
            runId,
            error: `Stryker exited with code ${result.exitCode}`,
            exitCode: result.exitCode,
          };
        }
      })
      .catch((err: unknown) => {
        const run = activeRuns.get(runId);
        if (!run) return;
        run.status = {
          state: "failed",
          runId,
          error: err instanceof Error ? err.message : String(err),
          exitCode: -1,
        };
      });

    return reply.code(202).send({ runId, status: "starting", startedAt });
  });

  // GET /api/repos/:repoName/mutation/:runId — poll a run's status
  app.get<{ Params: { repoName: string; runId: string } }>(
    "/api/repos/:repoName/mutation/:runId",
    async (req, reply) => {
      const run = activeRuns.get(req.params.runId);
      if (!run) {
        return reply.code(404).send({ error: "Run not found or expired" });
      }
      run.lastAccessAt = Date.now();
      return run.status;
    },
  );
}
