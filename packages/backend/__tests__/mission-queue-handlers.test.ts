import { describe, expect, it, vi } from "vitest";
import { createMissionQueueHandlers } from "../src/orchestrator/mission-queue-handlers";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";
import { createInMemoryPreparedSessionStore } from "../src/sessions/prepared-session-store";
import type { ExecutionJobType } from "@aurex/shared";

function setup() {
  const pool = {
    submit: vi.fn((_id: string) => {}),
    abort: vi.fn((_id: string) => {}),
  };
  const queue = createInMemoryExecutionQueueStore();
  const sessions = createInMemoryPreparedSessionStore();
  const handlers = createMissionQueueHandlers({
    pool,
    sessions,
    queue,
    // No launchAgent wired — agent_session_start handler fails explicitly,
    // which is what we want to assert here.
  });
  return { pool, queue, sessions, handlers };
}

async function enqueueAndClaim(queue: ReturnType<typeof createInMemoryExecutionQueueStore>, type: ExecutionJobType, missionId = "m-1") {
  const job = await queue.enqueue({ type, missionId });
  const claim = await queue.claimNext("worker-1");
  // The real worker calls markRunning before dispatching the handler; mirror
  // that so fail()/complete() transitions (allowed from "running") succeed.
  await queue.markRunning(claim!.job.id, claim!.claimToken);
  return { jobId: job.id, claimToken: claim!.claimToken };
}

describe("createMissionQueueHandlers — mission lifecycle", () => {
  it("mission_start delegates to pool.submit", async () => {
    const { pool, queue, handlers } = setup();
    const { jobId, claimToken } = await enqueueAndClaim(queue, "mission_start", "m-start");

    await handlers.mission_start(jobId, claimToken);

    expect(pool.submit).toHaveBeenCalledWith("m-start");
  });

  it("mission_resume delegates to pool.submit", async () => {
    const { pool, queue, handlers } = setup();
    const { jobId, claimToken } = await enqueueAndClaim(queue, "mission_resume", "m-resume");

    await handlers.mission_resume(jobId, claimToken);

    expect(pool.submit).toHaveBeenCalledWith("m-resume");
  });

  it("mission_abort delegates to pool.abort", async () => {
    const { pool, queue, handlers } = setup();
    const { jobId, claimToken } = await enqueueAndClaim(queue, "mission_abort", "m-abort");

    await handlers.mission_abort(jobId, claimToken);

    expect(pool.abort).toHaveBeenCalledWith("m-abort");
  });
});

describe("createMissionQueueHandlers — prepared sessions", () => {
  it("agent_session_cancel cancels the linked session", async () => {
    const { sessions, queue, handlers } = setup();
    const session = await sessions.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "do work" },
    });
    const { jobId, claimToken } = await enqueueAndClaim(queue, "agent_session_cancel", "m-1");
    // Link the job to the session so the handler can find it.
    await queue.enqueue({ type: "agent_session_cancel", missionId: "m-1", sessionId: session.id });

    // Re-claim the session-bearing job and mark it running.
    const claim2 = await queue.claimNext("worker-1");
    await queue.markRunning(claim2!.job.id, claim2!.claimToken);
    await sessions.updateStatus(session.id, "queued");

    await handlers.agent_session_cancel(claim2!.job.id, claim2!.claimToken);

    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("agent_session_cancel swallows errors for already-terminal sessions", async () => {
    const { sessions, queue, handlers } = setup();
    const session = await sessions.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "do work" },
    });
    await sessions.fail(session.id, "UNKNOWN", "already done");
    const { jobId, claimToken } = await enqueueAndClaim(queue, "agent_session_cancel", "m-1");
    await queue.enqueue({ type: "agent_session_cancel", missionId: "m-1", sessionId: session.id });

    // Cancelling an already-failed session should NOT throw.
    const claim2 = await queue.claimNext("worker-1");
    await queue.markRunning(claim2!.job.id, claim2!.claimToken);

    await expect(
      handlers.agent_session_cancel(claim2!.job.id, claim2!.claimToken),
    ).resolves.toBeUndefined();
  });

  it("agent_session_start fails the session when no launcher is wired", async () => {
    const { sessions, queue, handlers } = setup();
    const session = await sessions.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "do work" },
    });
    await queue.enqueue({
      type: "agent_session_start",
      missionId: "m-1",
      sessionId: session.id,
    });
    const claim = await queue.claimNext("worker-1");
    await queue.markRunning(claim!.job.id, claim!.claimToken);

    await expect(
      handlers.agent_session_start(claim!.job.id, claim!.claimToken),
    ).rejects.toThrow(/not wired/);
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "failed",
    });
  });
});

describe("createMissionQueueHandlers — inline-owned job types", () => {
  it.each([
    ["validator_start", "milestone-loop"],
    ["checkpoint_timeout", "checkpoint-loop"],
    ["stale_reconciliation", "/api/execution-queue/reconcile"],
  ] as Array<[ExecutionJobType, string]>)(
    "%s fails fast with a descriptive message instead of hot-looping",
    async (jobType, ownerFragment) => {
      const { queue, handlers } = setup();
      const { jobId, claimToken } = await enqueueAndClaim(queue, jobType, "m-1");

      const handler = handlers[jobType] as (id: string, token: string) => Promise<void>;
      await handler(jobId, claimToken);

      const job = await queue.get(jobId);
      expect(job).toMatchObject({
        status: "failed",
        failureCode: "UNKNOWN",
      });
      expect(job?.failureMessage).toContain(ownerFragment);
    },
  );
});

describe("createMissionQueueHandlers — completeness", () => {
  it("returns a handler for every declared ExecutionJobType", () => {
    const { handlers } = setup();
    const declared: ExecutionJobType[] = [
      "mission_start",
      "mission_resume",
      "mission_abort",
      "agent_session_start",
      "agent_session_resume",
      "agent_session_cancel",
      "validator_start",
      "checkpoint_timeout",
      "stale_reconciliation",
    ];
    for (const type of declared) {
      expect(typeof handlers[type]).toBe("function");
    }
    expect(Object.keys(handlers).sort()).toEqual([...declared].sort());
  });
});
