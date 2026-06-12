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
        // Requeue with a backoff to avoid hot-looping on unhandled job types
        const backoff = new Date(Date.now() + options.pollMs * 10);
        await deps.queue.requeue(
          claim.job.id,
          "UNKNOWN",
          `No handler registered for ${claim.job.type}`,
          backoff,
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
