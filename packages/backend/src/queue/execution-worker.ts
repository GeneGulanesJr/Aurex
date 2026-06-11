import type { EventBus } from "../ws/events.js";
import type { ExecutionQueueStore } from "./execution-queue-store.js";

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
    try {
      const claim = await deps.queue.claimNext(options.workerId);
      if (!claim) return;
      deps.eventBus?.emit({
        type: "execution_job_claimed",
        missionId: claim.job.missionId,
        jobId: claim.job.id,
        claimedBy: options.workerId,
      });
      const handler = deps.handlers?.[claim.job.type];
      if (!handler) {
        await deps.queue.requeue(
          claim.job.id,
          "UNKNOWN",
          `No handler registered for ${claim.job.type}`,
        );
        return;
      }
      await deps.queue.markRunning(claim.job.id, claim.claimToken);
      await handler(claim.job.id, claim.claimToken);
      await deps.queue.complete(claim.job.id, claim.claimToken);
    } catch (err) {
      console.warn(
        "[execution-worker] tick failed:",
        err instanceof Error ? err.message : err,
      );
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
