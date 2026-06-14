import { describe, expect, it } from "vitest";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";
import {
  createPreparedSessionService,
  createPreparedSessionStartHandler,
  createSessionMessageBus,
  type LaunchAgent,
} from "../src/sessions/prepared-session-service";
import { createInMemoryPreparedSessionStore } from "../src/sessions/prepared-session-store";
import { createExecutionWorker } from "../src/queue/execution-worker";

function setup() {
  const sessions = createInMemoryPreparedSessionStore();
  const queue = createInMemoryExecutionQueueStore();
  const messages = createSessionMessageBus();
  const service = createPreparedSessionService({ sessions, queue, messages });
  return { sessions, queue, messages, service };
}

describe("prepared session service", () => {
  it("prepares a durable session without starting it", async () => {
    const { service } = setup();

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
    const { service, queue, sessions } = setup();
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

  it("buffers messages for queued sessions and reports them queued", async () => {
    const { service, sessions, messages } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    await service.start(session.id);

    const result = await service.acceptMessage(session.id, "hello agent");

    expect(result).toEqual({ accepted: true, queued: true });
    expect(messages.drain(session.id)).toEqual(["hello agent"]);
    // draining clears the buffer
    expect(messages.drain(session.id)).toEqual([]);
    expect((await sessions.get(session.id))!.status).toBe("queued");
  });

  it("rejects messages for terminal sessions", async () => {
    const { service, sessions } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    await sessions.cancel(session.id);

    const result = await service.acceptMessage(session.id, "too late");

    expect(result).toEqual({ accepted: false, queued: false });
  });

  it("requires a non-empty message", async () => {
    const { service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });

    await expect(service.acceptMessage(session.id, "   ")).rejects.toThrow(
      "message is required",
    );
  });
});

describe("prepared session execution worker — no launcher wired", () => {
  it("fails agent_session_start jobs instead of marking sessions running when no launcher is wired", async () => {
    const { sessions, queue, service } = setup();
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
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
          }),
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

describe("prepared session execution worker — launcher wired", () => {
  it("drives starting -> running -> completed and stamps heartbeats", async () => {
    const { sessions, queue, service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    const start = await service.start(session.id);

    const seen: string[] = [];
    const launcher: LaunchAgent = async (ctx) => {
      seen.push(ctx.session.status);
      await ctx.markRunning();
      await ctx.heartbeat();
      return { status: "completed" };
    };

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
            launchAgent: launcher,
          }),
        },
      },
      { workerId: "worker-1", pollMs: 1000 },
    );

    await worker.tick();

    expect(seen).toEqual(["queued"]); // snapshot at launch time
    await expect(queue.get(start.queueJobId)).resolves.toMatchObject({
      status: "succeeded",
    });
    const final = await sessions.get(session.id);
    expect(final).toMatchObject({ status: "completed" });
    expect(final!.lastHeartbeatAt).not.toBeNull();
    expect(final!.startedAt).not.toBeNull();
  });

  it("marks the session failed and fails the job when the launcher reports failure", async () => {
    const { sessions, queue, service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    const start = await service.start(session.id);

    const launcher: LaunchAgent = async () => ({
      status: "failed",
      code: "PINYX_UNAVAILABLE",
      message: "gateway down",
    });

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
            launchAgent: launcher,
          }),
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
      failureCode: "PINYX_UNAVAILABLE",
      failureMessage: "gateway down",
    });
  });

  it("fails the session when the launcher throws", async () => {
    const { sessions, queue, service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    await service.start(session.id);

    const launcher: LaunchAgent = async () => {
      throw new Error("boom");
    };

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
            launchAgent: launcher,
          }),
        },
      },
      { workerId: "worker-1", pollMs: 1000 },
    );

    await worker.tick();

    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "failed",
      failureCode: "UNKNOWN",
      failureMessage: "boom",
    });
  });

  it("forwards REST-submitted messages to the launcher via drainMessages", async () => {
    const { sessions, queue, messages, service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    await service.start(session.id);

    // User submits a message while the session is queued, before the worker
    // has claimed the job.
    await service.acceptMessage(session.id, "pre-launch message");

    let drained: string[] = [];
    const launcher: LaunchAgent = async (ctx) => {
      await ctx.markRunning();
      // A second message arrives once running.
      await service.acceptMessage(session.id, "running message");
      drained = [...ctx.drainMessages(), ...ctx.drainMessages()];
      return { status: "completed" };
    };

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
            messages,
            launchAgent: launcher,
          }),
        },
      },
      { workerId: "worker-1", pollMs: 1000 },
    );

    await worker.tick();

    expect(drained).toEqual(["pre-launch message", "running message"]);
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "completed",
    });
    // Buffer fully drained.
    expect(messages.drain(session.id)).toEqual([]);
  });

  it("treats a cancelled session as a successful no-op for the job", async () => {
    const { sessions, queue, service } = setup();
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });
    const start = await service.start(session.id);
    // Cancel between queueing and the worker tick.
    await sessions.cancel(session.id);

    let launched = false;
    const launcher: LaunchAgent = async () => {
      launched = true;
      return { status: "completed" };
    };

    const worker = createExecutionWorker(
      {
        queue,
        handlers: {
          agent_session_start: createPreparedSessionStartHandler({
            queue,
            sessions,
            launchAgent: launcher,
          }),
        },
      },
      { workerId: "worker-1", pollMs: 1000 },
    );

    await worker.tick();

    expect(launched).toBe(false);
    await expect(queue.get(start.queueJobId)).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(sessions.get(session.id)).resolves.toMatchObject({
      status: "cancelled",
    });
  });
});

describe("session message bus", () => {
  it("is shared between service and handler so messages reach the launcher", async () => {
    const sessions = createInMemoryPreparedSessionStore();
    const queue = createInMemoryExecutionQueueStore();
    const messages = createSessionMessageBus();
    const service = createPreparedSessionService({
      sessions,
      queue,
      messages,
    });
    const session = await service.prepare({
      missionId: "m-1",
      role: "worker",
      config: { model: "gpt-test", prompt: "Implement feature" },
    });

    messages.push(session.id, "direct");
    expect(messages.drain(session.id)).toEqual(["direct"]);
    expect(messages.drain(session.id)).toEqual([]);
  });
});
