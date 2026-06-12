import { describe, expect, it } from "vitest";
import { createExecutionWorker } from "../src/queue/execution-worker";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";

describe("execution worker", () => {
  it("marks claimed jobs failed when their handler throws", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const job = await queue.enqueue({
      type: "mission_start",
      missionId: "m-1",
    });
    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          mission_start: async () => {
            throw new Error("handler exploded");
          },
        },
      },
      { workerId: "worker-a", pollMs: 1000 },
    );

    await worker.tick();

    await expect(queue.get(job.id)).resolves.toMatchObject({
      status: "failed",
      failureCode: "UNKNOWN",
      failureMessage: "handler exploded",
    });
  });
});
