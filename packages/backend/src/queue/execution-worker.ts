import type { EventBus } from "../ws/events.js";
import type {
  ExecutionQueueClaim,
  ExecutionQueueStore,
} from "./execution-queue-store.js";

export interface ExecutionWorkerOptions {
  workerId: string;
  pollMs: number;
}

export function createExecutionWorker(
  deps: {
    queue: ExecutionQueueStore;
    eventBus?: EventBus;
    handlers?: Partial<
      Record<string, (jobId: string, claimToken: string) => Promise<void>>
    >;
  },
  options: ExecutionWorkerOptions,
) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    let claim: ExecutionQueueClaim | null = null;
    let wasMarkedRunning = false;
    try {
      claim = await deps.queue.claimNext(options.workerId);
      if (!claim) return;
      deps.eventBus?.emit({
        type: "execution_job_claimed",
        missionId: claim.job.missionId,
        jobId: claim.job.id,
        claimedBy: options.workerId,
      });
      const handler = deps.handlers?.[claim.job.type];
      if (!handler) {
        // No handler is registered for this job type. Fail terminally with an
        // honest "UNKNOWN" code rather than silently requeuing — a requeue
        // would burn the retry budget in a tight poll loop and strand the job
        // in "requeued" status. `markRunning` first so the fail() transition
        // (allowed from "running") is legal, then fail() moves it to "failed".
        await deps.queue.markRunning(claim.job.id, claim.claimToken);
        wasMarkedRunning = true;
        await deps.queue.fail(
          claim.job.id,
          claim.claimToken,
          "UNKNOWN",
          `No handler registered for ${claim.job.type}`,
        );
        return;
      }
      await deps.queue.markRunning(claim.job.id, claim.claimToken);
      wasMarkedRunning = true;
      await handler(claim.job.id, claim.claimToken);
      await deps.queue.complete(claim.job.id, claim.claimToken);
    } catch (err) {
      console.warn(
        "[execution-worker] tick failed:",
        err instanceof Error ? err.message : err,
      );
      // Attempt to move the job to a terminal or recoverable state
      if (claim) {
        try {
          await deps.queue.fail(
            claim.job.id,
            wasMarkedRunning ? claim.claimToken : null,
            "UNKNOWN",
            err instanceof Error ? err.message : String(err),
          );
        } catch (failErr) {
          console.warn(
            "[execution-worker] failed to mark job as failed:",
            failErr instanceof Error ? failErr.message : failErr,
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), options.pollMs);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
