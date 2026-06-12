import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ExecutionJobStatus,
  ReconcileExecutionQueueRequest,
} from "@aurex/shared";
import { reconcileStaleWork } from "../queue/stale-reconciler.js";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";
import type { PreparedSessionStore } from "../sessions/prepared-session-store.js";
import type { EventBus } from "../ws/events.js";

export interface ExecutionQueueRouteDeps {
  queue: ExecutionQueueStore;
  sessions: PreparedSessionStore;
  eventBus?: EventBus;
  reconcilerDryRunDefault?: boolean;
  activeReconciliationEnabled?: boolean;
}

export async function executionQueueRoutes(
  app: FastifyInstance,
  deps: ExecutionQueueRouteDeps,
) {
  app.get(
    "/api/execution-queue",
    async (
      req: FastifyRequest<{
        Querystring: {
          status?: ExecutionJobStatus;
          missionId?: string;
          sessionId?: string;
        };
      }>,
    ) => {
      const jobs = await deps.queue.list({
        status: req.query.status,
        missionId: req.query.missionId,
        sessionId: req.query.sessionId,
      });
      return { jobs };
    },
  );

  app.post(
    "/api/execution-queue/reconcile",
    async (
      req: FastifyRequest<{ Body: ReconcileExecutionQueueRequest }>,
      reply: FastifyReply,
    ) => {
      const requestedActive = req.body?.dryRun === false;
      const dryRun = requestedActive
        ? !deps.activeReconciliationEnabled
        : (deps.reconcilerDryRunDefault ?? true);
      const summary = await reconcileStaleWork(
        { queue: deps.queue, sessions: deps.sessions },
        { dryRun },
      );
      deps.eventBus?.emit({ type: "stale_reconciliation_completed", summary });
      return reply.code(202).send({ summary });
    },
  );
}
