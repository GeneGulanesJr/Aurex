import type { PrepareAgentSessionRequest } from "@aurex/shared";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";
import type { PreparedSessionStore } from "./prepared-session-store.js";

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
        throw new Error(
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
    cancel(sessionId) {
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
