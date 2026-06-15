import type { ExecutionJobType } from "@aurex/shared";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";
import type { PreparedSessionStore } from "../sessions/prepared-session-store.js";
import {
  createPreparedSessionStartHandler,
  type LaunchAgent,
  type SessionMessageBus,
} from "../sessions/prepared-session-service.js";

/**
 * Minimal surface of {@link MissionRunnerPool} needed by the queue handlers.
 * Declared locally so this module depends on a structural shape rather than the
 * concrete pool, keeping it testable with a stub.
 */
export interface MissionQueuePool {
  /** Begin (or re-begin) a mission's lifecycle. Idempotent for in-flight ids. */
  submit(missionId: string): void;
  /** Abort a running or queued mission. No-op if the mission is not active. */
  abort(missionId: string): void;
}

export interface CreateMissionQueueHandlersDeps {
  pool: MissionQueuePool;
  sessions: PreparedSessionStore;
  queue: ExecutionQueueStore;
  /**
   * Launcher for prepared agent sessions. Forwarded to the
   * `agent_session_start` / `agent_session_resume` handlers. When omitted the
   * session-start handler fails explicitly (see prepared-session-service).
   */
  launchAgent?: LaunchAgent;
  /** Shared message bus for prepared sessions. */
  messages?: SessionMessageBus;
}

/**
 * Produces handlers for every declared {@link ExecutionJobType} so the durable
 * queue enum is fully honored. Each handler delegates to an existing, working
 * method on the pool or session store — they do NOT replace the synchronous
 * REST paths, they offer an async, queue-backed alternative and ensure that if
 * any of these job types is ever enqueued it is handled honestly instead of
 * silently hot-looping.
 *
 * Three job types (`validator_start`, `checkpoint_timeout`, `stale_reconciliation`)
 * are owned inline by the orchestrator (validator spawns in milestone-loop,
 * checkpoint expiry in checkpoint-loop, reconciliation via the REST route). They
 * fail fast with a descriptive message rather than being silently requeued.
 */
export function createMissionQueueHandlers(
  deps: CreateMissionQueueHandlersDeps,
): Record<ExecutionJobType, (jobId: string, claimToken: string) => Promise<void>> {
  const { pool, sessions, queue } = deps;

  const sessionStartHandler = createPreparedSessionStartHandler({
    queue,
    sessions,
    launchAgent: deps.launchAgent,
    messages: deps.messages,
  });

  return {
    // ── Mission lifecycle ───────────────────────────────────────────────
    async mission_start(jobId) {
      const job = await queue.get(jobId);
      pool.submit(job?.missionId ?? "");
    },

    async mission_resume(jobId) {
      const job = await queue.get(jobId);
      // submit() is idempotent for in-flight missions and re-enters planning
      // for paused/failed/completed ones — exactly what "resume" needs.
      pool.submit(job?.missionId ?? "");
    },

    async mission_abort(jobId) {
      const job = await queue.get(jobId);
      pool.abort(job?.missionId ?? "");
    },

    // ── Prepared agent sessions ─────────────────────────────────────────
    agent_session_start: sessionStartHandler,
    // Resume == re-drive the launcher; the start handler is already
    // idempotent for a queued/starting session (it reads current status and
    // short-circuits cancelled sessions).
    agent_session_resume: sessionStartHandler,

    async agent_session_cancel(jobId) {
      const job = await queue.get(jobId);
      if (!job?.sessionId) return;
      try {
        await sessions.cancel(job.sessionId);
      } catch {
        // Session may already be terminal — a cancel of a terminal session is
        // a no-op from the caller's perspective, so swallow the transition error.
      }
    },

    // ── Inline-owned job types ──────────────────────────────────────────
    // These are handled directly by the orchestrator loop and should never be
    // enqueued by the durable queue. Fail fast with a clear message rather
    // than hot-looping, so a mistaken enqueue surfaces loudly.
    async validator_start(jobId, claimToken) {
      await failInlineOwned(queue, jobId, claimToken, "validator_start", "milestone-loop");
    },
    async checkpoint_timeout(jobId, claimToken) {
      await failInlineOwned(queue, jobId, claimToken, "checkpoint_timeout", "checkpoint-loop");
    },
    async stale_reconciliation(jobId, claimToken) {
      await failInlineOwned(
        queue,
        jobId,
        claimToken,
        "stale_reconciliation",
        "POST /api/execution-queue/reconcile",
      );
    },
  };
}

/**
 * Marks a job that is owned by an inline orchestrator flow as failed with a
 * descriptive message, so a mistaken enqueue surfaces honestly instead of being
 * silently requeued by the worker.
 */
async function failInlineOwned(
  queue: ExecutionQueueStore,
  jobId: string,
  claimToken: string,
  jobType: string,
  owner: string,
): Promise<void> {
  await queue.fail(
    jobId,
    claimToken,
    "UNKNOWN",
    `${jobType} is handled inline by ${owner}; it must not be enqueued on the durable queue`,
  );
}
