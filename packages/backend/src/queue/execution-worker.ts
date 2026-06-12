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
    let activeClaim: Awaited<ReturnType<ExecutionQueueStore["claimNext"]>> =
      null;
    try {
      activeClaim = await deps.queue.claimNext(options.workerId);
      if (!activeClaim) return;
      deps.eventBus?.emit({
        type: "execution_job_claimed",
        missionId: activeClaim.job.missionId,
        jobId: activeClaim.job.id,
        claimedBy: options.workerId,
      });
      const handler = deps.handlers?.[activeClaim.job.type];
      if (!handler) {
        await deps.queue.requeue(
          activeClaim.job.id,
          "UNKNOWN",
          `No handler registered for ${activeClaim.job.type}`,
        );
        return;
      }
      await deps.queue.markRunning(activeClaim.job.id, activeClaim.claimToken);
      await handler(activeClaim.job.id, activeClaim.claimToken);
      await deps.queue.complete(activeClaim.job.id, activeClaim.claimToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[execution-worker] tick failed:", message);
      if (activeClaim) {
        await deps.queue.fail(
          activeClaim.job.id,
          activeClaim.claimToken,
          "UNKNOWN",
          message,
        );
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
