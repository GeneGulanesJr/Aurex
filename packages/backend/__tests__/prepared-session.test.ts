import { describe, expect, it } from "vitest";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";
import { createPreparedSessionService, createPreparedSessionStartHandler } from "../src/sessions/prepared-session-service";
import { createInMemoryPreparedSessionStore } from "../src/sessions/prepared-session-store";
import { createExecutionWorker } from "../src/queue/execution-worker";

describe("prepared session service", () => {
  it("prepares a durable session without starting it", async () => {
    const sessions = createInMemoryPreparedSessionStore();
    const queue = createInMemoryExecutionQueueStore();
    const service = createPreparedSessionService({ sessions, queue });

    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });

    expect(session).toMatchObject({
      missionId: "m-1",
      role: "worker",
      status: "prepared",
      queueJobId: null,
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
  });

  it("starts a prepared session by linking an agent_session_start queue job", async () => {
    const sessions = createInMemoryPreparedSessionStore();
    const queue = createInMemoryExecutionQueueStore();
    const service = createPreparedSessionService({ sessions, queue });
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });

    const start = await service.start(session.id);
    const queued = await queue.get(start.queueJobId);
    const updated = await sessions.get(session.id);

    expect(start).toMatchObject({ sessionId: session.id, status: "queued" });
    expect(queued).toMatchObject({
      type: "agent_session_start",
      missionId: "m-1",
      sessionId: session.id,
    });
    expect(updated).toMatchObject({
      status: "queued",
      queueJobId: start.queueJobId,
    });
  });
});


describe("prepared session execution worker", () => {
  it("fails agent_session_start jobs instead of marking sessions running when no launcher is wired", async () => {
    const sessions = createInMemoryPreparedSessionStore();
    const queue = createInMemoryExecutionQueueStore();
    const service = createPreparedSessionService({ sessions, queue });
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    const start = await service.start(session.id);

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({ queue, sessions }),
        },
      },
      { workerId: "worker-1", pollMs: 1000 },
    );

    await worker.tick();

    await expect(queue.get(start.queueJobId)).resolves.toMatchObject({
      status: "failed",
      failureCode: "UNKNOWN",
    });
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      failureMessage: expect.stringContaining("not wired"),
    });
  });
});
