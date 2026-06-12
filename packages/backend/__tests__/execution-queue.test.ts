import { describe, expect, it } from "vitest";
import { createInMemoryExecutionQueueStore, createSettingsExecutionQueueStore } from "../src/queue/execution-queue-store";

const now = new Date("2026-06-11T00:00:00.000Z");

describe("execution queue store", () => {
  it("claims each queued job only once", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const job = await queue.enqueue(
      { type: "mission_start", missionId: "m-1" },
      now,
    );

    const first = await queue.claimNext("worker-a", now);
    const second = await queue.claimNext("worker-b", now);

    expect(first?.job.id).toBe(job.id);
    expect(first?.job.claimedBy).toBe("worker-a");
    expect(second).toBeNull();
  });

  it("requires the active claim token for running mutations", async () => {
    const queue = createInMemoryExecutionQueueStore();
    await queue.enqueue({ type: "mission_start", missionId: "m-1" }, now);
    const claim = await queue.claimNext("worker-a", now);

    await expect(
      queue.markRunning(claim!.job.id, "wrong-token", now),
    ).rejects.toThrow(/claim token mismatch/);
    await expect(
      queue.markRunning(claim!.job.id, claim!.claimToken, now),
    ).resolves.toMatchObject({ status: "running" });
  });

  it("requeues stale work with structured failure metadata", async () => {
    const queue = createInMemoryExecutionQueueStore();
    await queue.enqueue({ type: "mission_start", missionId: "m-1" }, now);
    const claim = await queue.claimNext("worker-a", now);

    const requeued = await queue.requeue(
      claim!.job.id,
      "CLAIM_EXPIRED",
      "claim expired",
      new Date("2026-06-11T00:02:01.000Z"),
    );

    expect(requeued).toMatchObject({
      status: "queued",
      claimToken: null,
      claimedBy: null,
      failureCode: "CLAIM_EXPIRED",
      failureMessage: "claim expired",
    });
  });

  it("serializes settings-backed mutations so concurrent enqueues do not overwrite each other", async () => {
    let state: unknown = { jobs: [] };
    const lapis = {
      getSetting: async () => state,
      setSetting: async (_key: string, value: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        state = value;
      },
    };
    const queue = createSettingsExecutionQueueStore(lapis as any);

    await Promise.all([
      queue.enqueue({ type: "mission_start", missionId: "m-1" }, now),
      queue.enqueue({ type: "mission_start", missionId: "m-2" }, now),
    ]);

    await expect(queue.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ missionId: "m-1" }),
      expect.objectContaining({ missionId: "m-2" }),
    ]));
    await expect(queue.list()).resolves.toHaveLength(2);
  });
});
