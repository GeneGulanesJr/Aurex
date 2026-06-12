import type { PrepareAgentSessionRequest } from "@aurex/shared";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";
import type { PreparedSessionStore } from "./prepared-session-store.js";

/**
 * Thrown when a session operation is rejected because the session's current
 * status does not allow it (e.g. starting a completed session).
 */
export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

const CANCELLABLE_STATUSES = new Set([
  "prepared",
  "queued",
  "starting",
  "running",
  "waiting_for_input",
]);

export interface PreparedSessionService {
  prepare(
    input: PrepareAgentSessionRequest,
  ): ReturnType<PreparedSessionStore["prepare"]>;
  start(
    sessionId: string,
  ): Promise<{ sessionId: string; queueJobId: string; status: "queued" }>;
  get(sessionId: string): ReturnType<PreparedSessionStore["get"]>;
  cancel(sessionId: string): ReturnType<PreparedSessionStore["cancel"]>;
  acceptMessage(
    sessionId: string,
    message: string,
  ): Promise<{ accepted: boolean }>;
}

export function createPreparedSessionService(deps: {
  sessions: PreparedSessionStore;
  queue: ExecutionQueueStore;
}): PreparedSessionService {
  const { sessions, queue } = deps;
  return {
    prepare(input) {
      return sessions.prepare(input);
    },
    async start(sessionId) {
      const session = await sessions.get(sessionId);
      if (!session)
        throw new Error(`Prepared agent session ${sessionId} not found`);
      if (!["prepared", "queued"].includes(session.status)) {
        throw new SessionConflictError(
          `Prepared agent session ${sessionId} cannot be started from ${session.status}`,
        );
      }
      if (session.queueJobId) {
        return { sessionId, queueJobId: session.queueJobId, status: "queued" };
      }
      const job = await queue.enqueue({
        type: "agent_session_start",
        missionId: session.missionId,
        milestoneId: session.milestoneId,
        unitId: session.unitId,
        sessionId: session.id,
        maxAttempts: session.maxAttempts,
        payload: { role: session.role },
      });
      await sessions.linkQueueJob(session.id, job.id);
      return { sessionId, queueJobId: job.id, status: "queued" };
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
    async cancel(sessionId) {
      const session = await sessions.get(sessionId);
      if (!session)
        throw new Error(`Prepared agent session ${sessionId} not found`);
      if (!CANCELLABLE_STATUSES.has(session.status)) {
        throw new SessionConflictError(
          `Prepared agent session ${sessionId} cannot be cancelled from ${session.status}`,
        );
      }
      return sessions.cancel(sessionId);
    },
    async acceptMessage(sessionId, message) {
      const session = await sessions.get(sessionId);
      if (!session)
        throw new Error(`Prepared agent session ${sessionId} not found`);
      if (!message.trim()) throw new Error("message is required");
      return {
        accepted: ["running", "waiting_for_input"].includes(session.status),
      };
    },
  };
}

/**
 * Creates a queue handler for `agent_session_start` jobs.
 *
 * When no real agent launcher is wired (current state), the handler
 * explicitly fails the session and job instead of silently marking it
 * "running". This prevents stale-session ghosts that the reconciler
 * would later have to clean up.
 *
 * When a real launcher is wired later, replace this handler or pass a
 * `launchAgent` callback.
 */
export function createPreparedSessionStartHandler(deps: {
  queue: ExecutionQueueStore;
  sessions: PreparedSessionStore;
}): (jobId: string, claimToken: string) => Promise<void> {
  const { queue, sessions } = deps;
  return async (jobId, _claimToken) => {
    const job = await queue.get(jobId);
    if (!job?.sessionId) {
      throw new Error("agent_session_start job is missing sessionId");
    }
    // No real agent launcher is wired yet. Fail explicitly so the
    // session doesn't become a ghost "running" with no heartbeat.
    // Then throw so the worker moves the queue job to "failed" instead
    // of marking it "succeeded".
    await sessions.fail(
      job.sessionId,
      "UNKNOWN",
      "Agent launcher not wired — durable session start is not yet connected to a real agent process. Enable AUREX_DURABLE_QUEUE_ENABLED=false until the launcher integration is complete.",
    );
    throw new Error("agent_session_start: agent launcher not wired");
  };
}
