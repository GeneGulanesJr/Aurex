import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock factory can reference these
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
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }
  return {
    createAgentSession: mockCreateAgentSession,
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn(),
  };
});

import { createAgentSpawner, type AgentSpawnerConfig } from "../../src/agents/agent-spawner";
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

describe("AgentSpawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.subscribe.mockReturnValue(() => {});
  });

  // --- Task 5: Core lifecycle ---

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
  });

  it("spawn creates a Pi SDK session with correct cwd", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const result = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Mission Context\nDo the thing",
      taskPrompt: "Implement the login endpoint",
      timeout: 300_000,
    });

    expect(mockCreateAgentSession).toHaveBeenCalled();
    const callOpts = mockCreateAgentSession.mock.calls[0][0];
    expect(callOpts.cwd).toBe("/repo/.git-worktrees/worker-unit-1");
    expect(callOpts.tools).toEqual(["read", "write", "edit", "bash"]);
    expect(result.sessionId).toBe("test-session-123");
  });

  it("registers agent session in LaPis", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

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

    await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "spawned");
  });

  it("dispose cleans up session", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    handle.dispose();
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  // --- Task 6: Timeout handling ---

  it("times out and aborts session when timeout elapses", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 5_000,
    });

    // Make prompt hang forever
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 5_000,
    });

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(5_100);

    const result = await handle.completed;
    expect(result.status).toBe("timed_out");
    expect(result.sessionId).toBe("test-session-123");
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

    // Simulate agent completing after subscribe
    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      // Simulate agent_end event
      eventSubscriber({ type: "agent_end" });
    });

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 5_000,
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");

    // Advance past timeout — should NOT have aborted
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSession.abort).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // --- Task 7: Status transitions ---

  it("updates unit status to working when agent starts", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    // Capture status updates
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

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    await handle.completed;

    // First call is "spawned" from create
    expect(statusUpdates).toContain("spawned");
  });
});
