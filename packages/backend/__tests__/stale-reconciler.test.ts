import { describe, expect, it } from "vitest";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";
import { reconcileStaleWork } from "../src/queue/stale-reconciler";
import { createInMemoryPreparedSessionStore } from "../src/sessions/prepared-session-store";

const base = new Date("2026-06-11T00:00:00.000Z");
const later = new Date("2026-06-11T00:11:00.000Z");

describe("stale reconciler", () => {
  it("reports dry-run actions for stale claimed jobs and running sessions", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const sessions = createInMemoryPreparedSessionStore();
    await queue.enqueue({ type: "mission_start", missionId: "m-1" }, base);
    await queue.claimNext("worker-a", base);
    const session = await sessions.prepare(
      {
        missionId: "m-1",
        role: "worker",
        config: { model: "gpt-test", prompt: "Do work" },
      },
      base,
    );
    await sessions.updateStatus(session.id, "running", base);

    const summary = await reconcileStaleWork(
      { queue, sessions },
      { dryRun: true, now: later },
    );

    expect(summary.scanned).toBe(2);
    expect(summary.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "queue_job",
          action: "release_claim",
          failureCode: "CLAIM_EXPIRED",
        }),
        expect.objectContaining({
          targetType: "agent_session",
          action: "mark_lost",
          failureCode: "SESSION_LOST",
        }),
        expect.objectContaining({
          targetType: "mission",
          action: "escalate_to_user",
          failureCode: "SESSION_LOST",
        }),
      ]),
    );
  });

  it("can actively requeue stale claimed jobs", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const sessions = createInMemoryPreparedSessionStore();
    const job = await queue.enqueue(
      { type: "mission_start", missionId: "m-1" },
      base,
    );
    await queue.claimNext("worker-a", base);

    await reconcileStaleWork(
      { queue, sessions },
      { dryRun: false, now: later },
    );

    await expect(queue.get(job.id)).resolves.toMatchObject({
      status: "queued",
      failureCode: "CLAIM_EXPIRED",
    });
  });

  it("fails stale starting sessions after their final queued attempt", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const sessions = createInMemoryPreparedSessionStore();
    const session = await sessions.prepare(
      {
        missionId: "m-1",
        role: "worker",
        config: { model: "gpt-test", prompt: "Do work" },
        maxAttempts: 1,
      },
      base,
    );
    await sessions.linkQueueJob(session.id, "job-1", base);
    await sessions.updateStatus(session.id, "starting", base);

    const summary = await reconcileStaleWork(
      { queue, sessions },
      { dryRun: true, now: later },
    );

    expect(summary.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "agent_session",
          action: "fail_terminal",
          failureCode: "MAX_ATTEMPTS_EXHAUSTED",
        }),
      ]),
    );
  });
});
