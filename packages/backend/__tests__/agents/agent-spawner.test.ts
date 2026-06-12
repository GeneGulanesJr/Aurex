import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn(),
    subscribe: vi.fn(),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "test-session-123",
    isStreaming: false,
  };
  return {
    mockSession: session,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => {
  class MockAuthStorage {
    static inMemory = vi.fn(() => ({ setRuntimeApiKey: vi.fn() }));
  }
  class MockModelRegistry {
    registered: any = null;
    static inMemory = vi.fn(() => new MockModelRegistry());
    registerProvider = vi.fn((_provider: string, config: any) => { this.registered = config; });
    find = vi.fn((_provider: string, modelId: string) => ({ provider: "pinyx", id: modelId }));
  }
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }
  return {
    createAgentSession: mockCreateAgentSession,
    AuthStorage: MockAuthStorage,
    ModelRegistry: MockModelRegistry,
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn((tool) => tool),
  };
});

vi.mock("@sinclair/typebox", () => ({
  Type: {
    Object: (schema: any) => schema,
    String: (opts?: any) => ({ type: "string", ...opts }),
    Number: (opts?: any) => ({ type: "number", ...opts }),
    Optional: (schema: any) => schema,
    Array: (schema: any) => ({ type: "array", items: schema }),
    Boolean: (opts?: any) => ({ type: "boolean", ...opts }),
    Literal: (value: any) => ({ const: value }),
    Union: (items: any[], opts?: any) => ({ anyOf: items, ...opts }),
  },
}));

import { createAgentSpawner, type AgentSpawnerConfig } from "../../src/agents/agent-spawner";
import { createAgentLogger } from "../../src/agents/agent-logger";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

const baseSpawnOpts = {
  agentType: "worker" as const,
  unitId: "unit-1",
  missionId: "mission-1",
  milestoneId: "ms-1",
  cwd: "/repo/worktree",
  skillFilePath: "/app/src/skills/worker.md",
  contextContent: "# Context",
  taskPrompt: "Do the work",
  timeout: 120_000,
};

describe("AgentSpawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.subscribe.mockReturnValue(() => {});
  });

  it("creates a spawner with correct config", () => {
    const config: AgentSpawnerConfig = {
      lapis: createMockLapis(),
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    };
    const spawner = createAgentSpawner(config);
    expect(spawner).toBeDefined();
    expect(typeof spawner.spawn).toBe("function");
    expect(typeof spawner.shutdown).toBe("function");
    expect(typeof spawner.getActiveCount).toBe("function");
    expect(typeof spawner.getActiveSessions).toBe("function");
  });

  it("spawn creates a Pi SDK session with correct cwd", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const result = await spawner.spawn({
      ...baseSpawnOpts,
      cwd: "/repo/.git-worktrees/worker-unit-1",
      timeout: 300_000,
    });

    expect(mockCreateAgentSession).toHaveBeenCalled();
    const callOpts = mockCreateAgentSession.mock.calls[0][0];
    expect(callOpts.cwd).toBe("/repo/.git-worktrees/worker-unit-1");
    expect(callOpts.tools).toEqual(["read", "write", "edit", "bash", "write_handoff", "search_memory"]);
    expect(result.sessionId).toBe("test-session-123");
  });

  it("routes spawned agents through the configured PiNyx model", async () => {
    const lapis = {
      ...createMockLapis(),
      getSetting: vi.fn().mockResolvedValue({ endpoint: "http://pinyx:7331/" }),
    } as unknown as LaPisClient;
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn({
      ...baseSpawnOpts,
      model: "kilo/kilo-auto",
    });

    const callOpts = mockCreateAgentSession.mock.calls[0][0];
    expect(callOpts.model).toEqual({ provider: "pinyx", id: "kilo/kilo-auto" });
    expect(callOpts.modelRegistry).toBeDefined();
    expect(callOpts.authStorage).toBeDefined();
  });

  it("includes custom completion tools in the Pi SDK allowlist", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn(baseSpawnOpts);
    await spawner.spawn({
      ...baseSpawnOpts,
      agentType: "validator_scrutiny",
      agentId: "validator-1",
      contractId: "contract-1",
      unitId: undefined,
    });
    await spawner.spawn({
      ...baseSpawnOpts,
      agentType: "research",
      agentId: "research-1",
      unitId: undefined,
    });

    expect(mockCreateAgentSession.mock.calls[0][0].tools).toEqual(
      expect.arrayContaining(["write_handoff", "search_memory"]),
    );
    expect(mockCreateAgentSession.mock.calls[1][0].tools).toEqual(
      expect.arrayContaining(["write_verdict"]),
    );
    expect(mockCreateAgentSession.mock.calls[2][0].tools).toEqual(
      expect.arrayContaining(["read", "grep", "find", "ls", "write_finding", "search_memory"]),
    );
  });

  it("registers agent session in LaPis", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn(baseSpawnOpts);

    expect(lapis.registerAgentSession).toHaveBeenCalledWith(
      "worker",
      "test-session-123",
      "mission-1",
      "ms-1",
      "unit-1",
    );
  });

  it("updates working unit status to spawned", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn(baseSpawnOpts);

    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "spawned");
  });

  it("dispose cleans up session", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const handle = await spawner.spawn(baseSpawnOpts);
    handle.dispose();
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it("times out and aborts session when timeout elapses", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 5_000,
    });

    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const handle = await spawner.spawn({
      ...baseSpawnOpts,
      agentType: "research",
      unitId: undefined,
      timeout: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_100);

    const result = await handle.completed;
    expect(result.status).toBe("timed_out");
    expect(result.sessionId).toBe("test-session-123");
    expect(mockSession.abort).toHaveBeenCalled();

    vi.useRealTimers();
  });


  it("extends timeout when an active agent continues doing tool work", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 5_000,
    });

    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const handle = await spawner.spawn({
      ...baseSpawnOpts,
      timeout: 5_000,
      extendTimeoutOnActivity: true,
      maxTimeout: 20_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    eventSubscriber({
      type: "message_update",
      assistantMessageEvent: {
        toolCall: { name: "read", arguments: { path: "src/index.ts" } },
      },
    });

    await vi.advanceTimersByTimeAsync(4_900);
    expect(mockSession.abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    const result = await handle.completed;

    expect(result.status).toBe("timed_out");
    expect(mockSession.abort).toHaveBeenCalled();

    vi.useRealTimers();
  });


  it("does not abort during an active long-running tool until max timeout is exhausted", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const logger = createAgentLogger();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 5_000,
      logger,
    });

    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const handle = await spawner.spawn({
      ...baseSpawnOpts,
      timeout: 5_000,
      extendTimeoutOnActivity: true,
      maxTimeout: 12_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    eventSubscriber({
      type: "tool_execution_start",
      toolCallId: "bash-1",
      toolName: "bash",
      args: { command: "pnpm test" },
    });

    await vi.advanceTimersByTimeAsync(5_100);
    expect(mockSession.abort).not.toHaveBeenCalled();
    expect(logger.getEntries({ event: "config_decision" }).some((entry) => (entry.data as any)?.activity === "active_tool_execution")).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await handle.completed;

    expect(result.status).toBe("timed_out");
    expect(mockSession.abort).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("does not timeout if agent completes first", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      eventSubscriber({ type: "agent_end" });
    });

    const handle = await spawner.spawn({
      ...baseSpawnOpts,
      agentType: "research",
      unitId: undefined,
      timeout: 5_000,
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSession.abort).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("completes a worker when write_handoff is accepted even without agent_end", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    mockSession.prompt.mockResolvedValue(undefined);

    const handle = await spawner.spawn(baseSpawnOpts);
    const callOpts = mockCreateAgentSession.mock.calls[0][0];
    const handoffTool = callOpts.customTools.find((tool: any) => tool.name === "write_handoff");

    await handoffTool.execute("tc-1", {
      featureName: "Classify refactor",
      description: "Refactored classify",
      implemented: "Extracted helper functions",
      remaining: "none",
      rationale: "The helpers isolate branching logic while preserving the public classifier behavior.",
      assumptions: "Existing tests cover the behavior being preserved.",
      unresolvedUncertainties: "none",
      errorsEncountered: "none",
      commandsRun: JSON.stringify([{ command: "npm test", exitCode: 0 }]),
      gitCommitHash: "abc123",
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");
    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });

  it("updates unit status to working when agent starts", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const statusUpdates: string[] = [];
    (lapis.updateWorkingUnitStatus as any).mockImplementation(async (_id: string, status: string) => {
      statusUpdates.push(status);
    });

    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      eventSubscriber({ type: "agent_start" });
      eventSubscriber({ type: "agent_end" });
    });

    const handle = await spawner.spawn(baseSpawnOpts);
    await handle.completed;

    expect(statusUpdates).toContain("spawned");
  });

  describe("handle tracking", () => {
    it("tracks active handles", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      expect(spawner.getActiveCount()).toBe(0);

      await spawner.spawn(baseSpawnOpts);
      expect(spawner.getActiveCount()).toBe(1);
      expect(spawner.getActiveSessions()).toContain("test-session-123");
    });

    it("removes handle from tracking on completion", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });

      let resolvePrompt!: () => void;
      mockSession.prompt.mockImplementation(async () => {
        await new Promise<void>((resolve) => { resolvePrompt = resolve; });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      expect(spawner.getActiveCount()).toBe(1);

      eventSubscriber({ type: "agent_end" });
      resolvePrompt();
      await handle.completed;
      expect(spawner.getActiveCount()).toBe(0);
    });

    it("removes handle from tracking on dispose", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      expect(spawner.getActiveCount()).toBe(1);

      handle.dispose();
      expect(spawner.getActiveCount()).toBe(0);
    });

    it("shutdown aborts and disposes all active handles", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      mockSession.prompt.mockReturnValue(new Promise(() => {}));

      await spawner.spawn(baseSpawnOpts);
      expect(spawner.getActiveCount()).toBe(1);

      spawner.shutdown();
      expect(spawner.getActiveCount()).toBe(0);
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });
  });

  describe("logger integration", () => {
    it("logs spawned event when agent is created", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      await spawner.spawn(baseSpawnOpts);

      const spawned = logger.getEntries({ event: "spawned" });
      expect(spawned).toHaveLength(1);
      expect(spawned[0].sessionId).toBe("test-session-123");
      expect(spawned[0].agentType).toBe("worker");
      expect(spawned[0].missionId).toBe("mission-1");
    });

    it("logs prompt_sent event", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      await spawner.spawn(baseSpawnOpts);

      const sent = logger.getEntries({ event: "prompt_sent" });
      expect(sent).toHaveLength(1);
    });

    it("logs completed event on agent_end", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn({
        ...baseSpawnOpts,
        agentType: "research",
        unitId: undefined,
      });
      await handle.completed;

      const completed = logger.getEntries({ event: "completed" });
      expect(completed).toHaveLength(1);
    });

    it("logs failed event on error", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({
          type: "message_update",
          assistantMessageEvent: { type: "error", message: "boom" },
        });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      const result = await handle.completed;

      expect(result.status).toBe("failed");
      const failed = logger.getEntries({ event: "failed" });
      expect(failed).toHaveLength(1);
      expect(failed[0].data?.error).toBe("boom");
    });

    it("logs timed_out event on timeout", async () => {
      vi.useFakeTimers();
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 5_000,
        logger,
      });

      mockSession.prompt.mockReturnValue(new Promise(() => {}));

      const handle = await spawner.spawn({ ...baseSpawnOpts, timeout: 5_000 });
      await vi.advanceTimersByTimeAsync(5_100);
      await handle.completed;

      const timed = logger.getEntries({ event: "timed_out" });
      expect(timed).toHaveLength(1);

      vi.useRealTimers();
    });

    it("logs tool_call events", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({
          type: "message_update",
          assistantMessageEvent: { toolCall: { name: "write_handoff" } },
        });
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      await handle.completed;

      const toolCalls = logger.getEntries({ event: "tool_call" });
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].data?.tool).toBe("write_handoff");
    });

    it("logs aborted event on abort", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      mockSession.prompt.mockReturnValue(new Promise(() => {}));

      const handle = await spawner.spawn(baseSpawnOpts);
      handle.abort();

      const aborted = logger.getEntries({ event: "aborted" });
      expect(aborted).toHaveLength(1);
    });

    it("logs cost_update events", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({
          type: "message_update",
          assistantMessageEvent: {
            usage: { cost: 0.05, totalTokens: 1000, promptTokens: 500, completionTokens: 500 },
          },
        });
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      await handle.completed;

      const costEntries = logger.getEntries({ event: "cost_update" });
      expect(costEntries).toHaveLength(1);
      expect(costEntries[0].data?.cost).toBe(0.05);
    });

    it("handles nested cost.total shape", async () => {
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({
          type: "message_update",
          assistantMessageEvent: {
            usage: { cost: { total: 0.12 }, totalTokens: 2000 },
          },
        });
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      await handle.completed;

      const costEntries = logger.getEntries({ event: "cost_update" });
      expect(costEntries).toHaveLength(1);
      expect(costEntries[0].data?.cost).toBe(0.12);
    });

    it("warns on unexpected cost shape and skips zero-cost with no tokens", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lapis = createMockLapis();
      const logger = createAgentLogger();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        logger,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({
          type: "message_update",
          assistantMessageEvent: {
            usage: { cost: "free" },
          },
        });
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      await handle.completed;

      expect(warnSpy).toHaveBeenCalledWith(
        "[spawner] Unexpected usage.cost shape:", "free",
      );
      const costEntries = logger.getEntries({ event: "cost_update" });
      expect(costEntries).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  describe("concurrency limit", () => {
    it("spawn succeeds when under limit", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        maxConcurrent: 5,
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      expect(handle.sessionId).toBe("test-session-123");
    });

    it("spawn throws when at limit", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        maxConcurrent: 1,
      });

      mockSession.prompt.mockReturnValue(new Promise(() => {}));
      await spawner.spawn(baseSpawnOpts);

      await expect(spawner.spawn(baseSpawnOpts)).rejects.toThrow("concurrency limit reached");
    });

    it("spawn succeeds after a handle completes", async () => {
      const lapis = createMockLapis();
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
        maxConcurrent: 1,
      });

      let eventSubscriber: (event: any) => void = () => {};
      mockSession.subscribe.mockImplementation((fn: any) => {
        eventSubscriber = fn;
        return () => {};
      });
      mockSession.prompt.mockImplementation(async () => {
        eventSubscriber({ type: "agent_end" });
      });

      const handle = await spawner.spawn(baseSpawnOpts);
      await handle.completed;

      mockSession.prompt.mockResolvedValue(undefined);
      mockSession.subscribe.mockReturnValue(() => {});

      const handle2 = await spawner.spawn(baseSpawnOpts);
      expect(handle2.sessionId).toBe("test-session-123");
    });
  });

  describe("resolvePinyxModel error paths", () => {
    // Use unique model IDs per test to avoid cache collisions with the
    // module-level pinyxModelCache.

    it("falls back to default when lapis.getSetting is not a function", async () => {
      const lapis = createMockLapis() as LaPisClient;
      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({
        ...baseSpawnOpts,
        model: "test/no-getSetting",
      });

      const callOpts = mockCreateAgentSession.mock.calls[0][0];
      expect(callOpts.model).toBeUndefined();
      expect(callOpts.modelRegistry).toBeUndefined();
      expect(callOpts.authStorage).toBeUndefined();
    });

    it("falls back to default when getSetting rejects", async () => {
      const lapis = {
        ...createMockLapis(),
        getSetting: vi.fn().mockRejectedValue(new Error("db error")),
      } as unknown as LaPisClient;

      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({
        ...baseSpawnOpts,
        model: "test/getSetting-rejects",
      });

      const callOpts = mockCreateAgentSession.mock.calls[0][0];
      expect(callOpts.model).toBeUndefined();
    });

    it("falls back to default when pinyx_config has no endpoint", async () => {
      const lapis = {
        ...createMockLapis(),
        getSetting: vi.fn().mockResolvedValue({ endpoint: "" }),
      } as unknown as LaPisClient;

      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({
        ...baseSpawnOpts,
        model: "test/no-endpoint",
      });

      const callOpts = mockCreateAgentSession.mock.calls[0][0];
      expect(callOpts.model).toBeUndefined();
    });

    it("caches model config across spawns with same endpoint", async () => {
      const lapis = {
        ...createMockLapis(),
        getSetting: vi.fn().mockResolvedValue({ endpoint: "http://pinyx:7331/" }),
      } as unknown as LaPisClient;

      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({ ...baseSpawnOpts, model: "test/cache-model" });
      await spawner.spawn({ ...baseSpawnOpts, model: "test/cache-model" });

      // ModelRegistry.inMemory should only be called once — the second spawn
      // reuses the cached { model, modelRegistry, authStorage } entry.
      const MockModelRegistry = vi.mocked(await import("@earendil-works/pi-coding-agent")).ModelRegistry;
      expect(MockModelRegistry.inMemory).toHaveBeenCalledTimes(1);
    });

    it("re-resolves model when endpoint changes", async () => {
      let callIdx = 0;
      const lapis = {
        ...createMockLapis(),
        getSetting: vi.fn().mockImplementation(async () => {
          callIdx++;
          return { endpoint: callIdx === 1 ? "http://pinyx-old:7331/" : "http://pinyx-new:7331/" };
        }),
      } as unknown as LaPisClient;

      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({ ...baseSpawnOpts, model: "test/endpoint-change" });
      await spawner.spawn({ ...baseSpawnOpts, model: "test/endpoint-change" });

      // Two different endpoints -> two cache entries -> two inMemory calls
      const MockModelRegistry = vi.mocked(await import("@earendil-works/pi-coding-agent")).ModelRegistry;
      expect(MockModelRegistry.inMemory).toHaveBeenCalledTimes(2);
    });

    it("clears cache on shutdown", async () => {
      const lapis = {
        ...createMockLapis(),
        getSetting: vi.fn().mockResolvedValue({ endpoint: "http://pinyx:7331/" }),
      } as unknown as LaPisClient;

      const spawner = createAgentSpawner({
        lapis,
        agentDir: "/home/user/.pi/agent",
        defaultTimeout: 120_000,
      });

      await spawner.spawn({ ...baseSpawnOpts, model: "test/shutdown-cache" });
      spawner.shutdown();
      await spawner.spawn({ ...baseSpawnOpts, model: "test/shutdown-cache" });

      // After shutdown clears the cache, the second spawn should re-register
      const MockModelRegistry = vi.mocked(await import("@earendil-works/pi-coding-agent")).ModelRegistry;
      expect(MockModelRegistry.inMemory).toHaveBeenCalledTimes(2);
    });
  });

});
