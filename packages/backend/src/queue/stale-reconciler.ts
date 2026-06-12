import type {
  ExecutionFailureCode,
  ReconciliationAction,
  ReconciliationRunSummary,
} from "@aurex/shared";
import type { ExecutionQueueStore } from "./execution-queue-store.js";
import type { PreparedSessionStore } from "../sessions/prepared-session-store.js";

export interface StaleReconcilerThresholds {
  claimedJobMs: number;
  runningJobHeartbeatMs: number;
  startingSessionMs: number;
  runningSessionHeartbeatMs: number;
}

export interface StaleReconcilerOptions {
  dryRun?: boolean;
  now?: Date;
  thresholds?: Partial<StaleReconcilerThresholds>;
}

const DEFAULT_THRESHOLDS: StaleReconcilerThresholds = {
  claimedJobMs: 2 * 60 * 1000,
  runningJobHeartbeatMs: 5 * 60 * 1000,
  startingSessionMs: 5 * 60 * 1000,
  runningSessionHeartbeatMs: 10 * 60 * 1000,
};

function ageMs(timestamp: string | null, now: Date): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return now.getTime() - new Date(timestamp).getTime();
}

function increment(
  summary: ReconciliationRunSummary,
  action: ReconciliationAction,
): void {
  summary.actions.push(action);
  if (
    action.action === "requeue" ||
    action.action === "release_claim" ||
    action.action === "retry_session"
  )
    summary.wouldRequeue++;
  if (action.action === "mark_lost") summary.wouldMarkLost++;
  if (action.action === "fail_terminal") summary.wouldFail++;
  if (action.action === "escalate_to_user") summary.wouldEscalate++;
}

function action(
  targetType: ReconciliationAction["targetType"],
  targetId: string,
  actionType: ReconciliationAction["action"],
  failureCode: ExecutionFailureCode,
  reason: string,
): ReconciliationAction {
  return { targetType, targetId, action: actionType, failureCode, reason };
}

export async function reconcileStaleWork(
  deps: { queue: ExecutionQueueStore; sessions: PreparedSessionStore },
  options: StaleReconcilerOptions = {},
): Promise<ReconciliationRunSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? true;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const summary: ReconciliationRunSummary = {
    scanned: 0,
    wouldRequeue: 0,
    wouldMarkLost: 0,
    wouldFail: 0,
    wouldEscalate: 0,
    actions: [],
  };

  const jobs = await deps.queue.list();
  summary.scanned += jobs.length;
  for (const job of jobs) {
    if (
      job.status === "claimed" &&
      ageMs(job.claimedAt, now) > thresholds.claimedJobMs
    ) {
      const staleAction = action(
        "queue_job",
        job.id,
        job.attempt >= job.maxAttempts ? "fail_terminal" : "release_claim",
        job.attempt >= job.maxAttempts
          ? "MAX_ATTEMPTS_EXHAUSTED"
          : "CLAIM_EXPIRED",
        `claimed job has been stale since ${job.claimedAt ?? "unknown"}`,
      );
      increment(summary, staleAction);
      if (!dryRun) {
        if (staleAction.action === "fail_terminal")
          await deps.queue.fail(
            job.id,
            null,
            staleAction.failureCode,
            staleAction.reason,
            now,
          );
        else
          await deps.queue.requeue(
            job.id,
            staleAction.failureCode,
            staleAction.reason,
            now,
          );
      }
    }
    if (
      job.status === "running" &&
      ageMs(job.heartbeatAt, now) > thresholds.runningJobHeartbeatMs
    ) {
      const staleAction = action(
        "queue_job",
        job.id,
        job.attempt >= job.maxAttempts ? "fail_terminal" : "requeue",
        job.attempt >= job.maxAttempts
          ? "MAX_ATTEMPTS_EXHAUSTED"
          : "HEARTBEAT_TIMEOUT",
        `running job heartbeat expired at ${job.heartbeatAt ?? "unknown"}`,
      );
      increment(summary, staleAction);
      if (!dryRun) {
        if (staleAction.action === "fail_terminal")
          await deps.queue.fail(
            job.id,
            null,
            staleAction.failureCode,
            staleAction.reason,
            now,
          );
        else
          await deps.queue.requeue(
            job.id,
            staleAction.failureCode,
            staleAction.reason,
            now,
          );
      }
    }
  }

  const sessions = await deps.sessions.list();
  summary.scanned += sessions.length;
  for (const session of sessions) {
    if (
      session.status === "starting" &&
      ageMs(session.startedAt, now) > thresholds.startingSessionMs
    ) {
      const staleAction = action(
        "agent_session",
        session.id,
        session.attempt >= session.maxAttempts
          ? "fail_terminal"
          : "retry_session",
        session.attempt >= session.maxAttempts
          ? "MAX_ATTEMPTS_EXHAUSTED"
          : "SESSION_START_TIMEOUT",
        `starting session has been stale since ${session.startedAt ?? "unknown"}`,
      );
      increment(summary, staleAction);
      if (!dryRun) {
        await deps.sessions.fail(
          session.id,
          staleAction.failureCode,
          staleAction.reason,
          now,
        );
      }
    }
    if (
      session.status === "running" &&
      ageMs(session.lastHeartbeatAt, now) > thresholds.runningSessionHeartbeatMs
    ) {
      const staleAction = action(
        "agent_session",
        session.id,
        "mark_lost",
        "SESSION_LOST",
        `running session heartbeat expired at ${session.lastHeartbeatAt ?? "unknown"}`,
      );
      increment(summary, staleAction);
      increment(
        summary,
        action(
          "mission",
          session.missionId,
          "escalate_to_user",
          "SESSION_LOST",
          `session ${session.id} was marked lost`,
        ),
      );
      if (!dryRun) {
        await deps.sessions.markLost(
          session.id,
          staleAction.failureCode,
          staleAction.reason,
          now,
        );
      }
    }
  }

  return summary;
}
