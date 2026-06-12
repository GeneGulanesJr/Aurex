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

  it("actively retries stale starting sessions instead of failing them", async () => {
    const queue = createInMemoryExecutionQueueStore();
    const sessions = createInMemoryPreparedSessionStore();
    const session = await sessions.prepare(
      {
        missionId: "m-1",
        role: "worker",
        config: { model: "gpt-test", prompt: "Do work" },
      },
      base,
    );
    const job = await queue.enqueue(
      { type: "agent_session_start", missionId: "m-1", sessionId: session.id },
      base,
    );
    const claim = await queue.claimNext("worker-a", base);
    await sessions.linkQueueJob(session.id, job.id, base);
    await sessions.updateStatus(session.id, "starting", base);
    // Mark job running with a recent heartbeat so it doesn't also trigger
    // the running-job heartbeat check (only the session should be stale).
    const recent = new Date("2026-06-11T00:10:30.000Z");
    await queue.markRunning(job.id, claim!.claimToken, recent);

    const summary = await reconcileStaleWork(
      { queue, sessions },
      { dryRun: false, now: later },
    );

    expect(summary.actions).toContainEqual(expect.objectContaining({
      targetType: "agent_session",
      targetId: session.id,
      action: "retry_session",
      failureCode: "SESSION_START_TIMEOUT",
    }));
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "queued",
      failureCode: null,
    });
  });
});
