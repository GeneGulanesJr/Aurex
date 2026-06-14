import type {
  ExecutionFailureCode,
  PrepareAgentSessionRequest,
  PreparedAgentSession,
} from "@aurex/shared";
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

/**
 * Context handed to a {@link LaunchAgent} callback when a prepared session is
 * started by the durable queue worker. The launcher drives the session through
 * its lifecycle by calling the provided control hooks.
 */
export interface LaunchAgentContext {
  session: PreparedAgentSession;
  /** Mark the session as actively running and stamp a fresh heartbeat. */
  markRunning(): Promise<void>;
  /** Record a heartbeat to prove the agent is still alive. */
  heartbeat(): Promise<void>;
  /** Mark the session as blocked waiting for user/system input. */
  waitForInput(): Promise<void>;
  /**
   * Drain any user messages buffered for this session (e.g. submitted via the
   * REST API while the session was queued/starting, or between drain cycles on
   * a running session). Returns the messages and clears the buffer.
   */
  drainMessages(): string[];
}

export type LaunchAgentResult = { status: "completed" } | {
  status: "failed";
  code: ExecutionFailureCode;
  message: string;
};

/**
 * Launcher invoked by the `agent_session_start` queue handler once a real
 * agent process runner is wired. The launcher MUST resolve when the agent is
 * done; it is responsible for calling `markRunning`/`heartbeat` on a cadence
 * so the stale reconciler can detect dead sessions.
 */
export type LaunchAgent = (
  ctx: LaunchAgentContext,
) => Promise<LaunchAgentResult>;

/**
 * Shared in-memory buffer of user messages submitted to prepared sessions.
 *
 * A single instance is constructed in `server.ts` and passed to both the
 * prepared-session service (which appends messages received via the REST API)
 * and the `agent_session_start` queue handler (which drains them into the
 * live launcher). This closes the loop so a message posted to a running or
 * queued session actually reaches the agent instead of being silently
 * dropped.
 */
export interface SessionMessageBus {
  push(sessionId: string, message: string): void;
  drain(sessionId: string): string[];
}

export function createSessionMessageBus(): SessionMessageBus {
  const buffer = new Map<string, string[]>();
  return {
    push(sessionId, message) {
      const list = buffer.get(sessionId);
      if (list) {
        list.push(message);
      } else {
        buffer.set(sessionId, [message]);
      }
    },
    drain(sessionId) {
      const list = buffer.get(sessionId);
      if (!list || list.length === 0) return [];
      buffer.set(sessionId, []);
      return list;
    },
  };
}

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
  ): Promise<{ accepted: boolean; queued: boolean }>;
}

export function createPreparedSessionService(deps: {
  sessions: PreparedSessionStore;
  queue: ExecutionQueueStore;
  /** Shared message bus; created internally when omitted. */
  messages?: SessionMessageBus;
}): PreparedSessionService {
  const { sessions, queue, messages = createSessionMessageBus() } = deps;
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

      // Messages are accepted for any non-terminal session and buffered on
      // the shared bus. A live launcher drains them via its context; a
      // queued/starting session drains them when its launcher attaches.
      if (CANCELLABLE_STATUSES.has(session.status)) {
        messages.push(sessionId, message);
        return { accepted: true, queued: true };
      }
      return { accepted: false, queued: false };
    },
  };
}

/**
 * Creates a queue handler for `agent_session_start` jobs.
 *
 * When a `launchAgent` callback is provided, the handler drives the prepared
 * session through its full lifecycle: `starting → running` (with periodic
 * heartbeats) → `completed`/`failed`. Heartbeats keep the stale reconciler's
 * watchdog meaningful and prevent false "lost" classification.
 *
 * When no launcher is wired, the handler explicitly fails the session and job
 * instead of silently marking it "running". This prevents stale-session ghosts
 * that the reconciler would later have to clean up, and surfaces the missing
 * integration loudly.
 */
export function createPreparedSessionStartHandler(deps: {
  queue: ExecutionQueueStore;
  sessions: PreparedSessionStore;
  launchAgent?: LaunchAgent;
  /** Shared message bus; created internally when omitted. */
  messages?: SessionMessageBus;
  /** Heartbeat cadence (ms) while a launcher is running. Default 30s. */
  heartbeatIntervalMs?: number;
}): (jobId: string, claimToken: string) => Promise<void> {
  const {
    queue,
    sessions,
    launchAgent,
    messages = createSessionMessageBus(),
    heartbeatIntervalMs = 30_000,
  } = deps;

  return async (jobId, _claimToken) => {
    const job = await queue.get(jobId);
    if (!job?.sessionId) {
      throw new Error("agent_session_start job is missing sessionId");
    }
    const sessionId = job.sessionId;

    if (!launchAgent) {
      // No real agent launcher is wired yet. Fail explicitly so the
      // session doesn't become a ghost "running" with no heartbeat.
      // Then throw so the worker moves the queue job to "failed" instead
      // of marking it "succeeded".
      await sessions.fail(
        sessionId,
        "UNKNOWN",
        "Agent launcher not wired — durable session start is not yet connected to a real agent process. Enable AUREX_DURABLE_QUEUE_ENABLED=false or register a launchAgent callback.",
      );
      throw new Error("agent_session_start: agent launcher not wired");
    }

    const session = await sessions.get(sessionId);
    if (!session) {
      throw new Error(`Prepared agent session ${sessionId} not found`);
    }
    if (session.status === "cancelled") {
      // Cancelled between queue and handler. Treat as a successful no-op so
      // the job is cleaned up rather than retried.
      return;
    }

    await sessions.updateStatus(sessionId, "starting");

    let lastResult: LaunchAgentResult;
    try {
      const heartbeatTimer = setInterval(() => {
        void sessions.heartbeat(sessionId).catch(() => {
          // Heartbeat writes are best-effort; a failed write (e.g. session
          // already terminal) must not crash the launcher.
        });
      }, heartbeatIntervalMs);
      if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

      try {
        lastResult = await launchAgent({
          session,
          async markRunning() {
            await sessions.updateStatus(sessionId, "running");
          },
          async heartbeat() {
            await sessions.heartbeat(sessionId);
          },
          async waitForInput() {
            await sessions.updateStatus(sessionId, "waiting_for_input");
          },
          drainMessages() {
            return messages.drain(sessionId);
          },
        });
      } finally {
        clearInterval(heartbeatTimer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sessions.fail(sessionId, "UNKNOWN", message);
      throw err;
    }

    if (lastResult.status === "completed") {
      await sessions.updateStatus(sessionId, "completed");
      return;
    }
    await sessions.fail(
      sessionId,
      lastResult.code,
      lastResult.message || "Agent launcher reported failure",
    );
    throw new Error(
      `agent_session_start: ${lastResult.code} — ${lastResult.message}`,
    );
  };
}
