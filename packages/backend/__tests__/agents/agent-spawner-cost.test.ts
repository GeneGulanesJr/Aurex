import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentType } from "@aurex/shared";

const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "cost-session-1",
    isStreaming: false,
  };
  return { mockSession: session, mockCreateAgentSession: vi.fn().mockResolvedValue({ session }) };
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

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createAgentSpawner } from "../../src/agents/agent-spawner";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

describe("agent spawner — cost tracking", () => {
  let onCost: ReturnType<typeof vi.fn>;
  let mockLapis: LaPisClient;
  let capturedSubscriber: ((event: any) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;

    mockSession.subscribe.mockImplementation((fn: any) => {
      capturedSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockResolvedValue(undefined);

    onCost = vi.fn();
    mockLapis = createMockLapis();
  });

  async function spawnWorker(): Promise<void> {
    const spawner = createAgentSpawner({
      lapis: mockLapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 120_000,
      onCost,
    });

    const handle = await spawner.spawn({
      agentType: "worker" as AgentType,
      agentId: "worker-u-1",
      unitId: "u-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/test/skills/worker.md",
      contextContent: "context",
      taskPrompt: "do the thing",
    });

    // Don't complete yet — tests will emit usage events first
    return handle as any;
  }

  async function completeHandle(handle: any): Promise<void> {
    if (capturedSubscriber) {
      capturedSubscriber({ type: "agent_end" });
    }
    await handle.completed;
    handle.dispose();
  }

  it("parses usage events and logs cost to LaPis", async () => {
    const handle = await spawnWorker();

    // Emit usage event before agent_end
    if (capturedSubscriber) {
      capturedSubscriber({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.003 },
        },
      });
    }

    await completeHandle(handle);

    expect(mockLapis.logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "cost-session-1",
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.003,
      }),
    );
  });

  it("calls onCost callback with cumulative totals", async () => {
    const handle = await spawnWorker();

    if (capturedSubscriber) {
      capturedSubscriber({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300, cost: 0.006 },
        },
      });
    }

    await completeHandle(handle);

    expect(onCost).toHaveBeenCalledWith(
      "m-1",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("accumulates costs across multiple usage events", async () => {
    const handle = await spawnWorker();

    if (capturedSubscriber) {
      capturedSubscriber({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.003 },
        },
      });
      capturedSubscriber({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300, cost: 0.006 },
        },
      });
    }

    await completeHandle(handle);

    // logCost should be called twice — once per usage event
    expect((mockLapis.logCost as any).mock.calls.length).toBe(2);
    // onCost should be called twice with accumulating totals
    expect(onCost).toHaveBeenCalledTimes(2);
  });

  it("accumulates onCost totals across multiple agent sessions from the same spawner", async () => {
    const spawner = createAgentSpawner({
      lapis: mockLapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 120_000,
      onCost,
    });

    async function spawnAndReport(sessionId: string, agentId: string, cost: number, totalTokens: number) {
      mockSession.sessionId = sessionId;
      const handle = await spawner.spawn({
        agentType: "worker" as AgentType,
        agentId,
        unitId: agentId.replace("worker-", ""),
        missionId: "m-1",
        milestoneId: "ms-1",
        cwd: "/test/repo",
        skillFilePath: "/test/skills/worker.md",
        contextContent: "context",
        taskPrompt: "do the thing",
      });
      capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: totalTokens / 2, completionTokens: totalTokens / 2, totalTokens, cost },
        },
      });
      await completeHandle(handle);
    }

    await spawnAndReport("cost-session-1", "worker-u-1", 0.003, 150);
    await spawnAndReport("cost-session-2", "worker-u-2", 0.006, 300);

    const lastCall = onCost.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("m-1");
    expect(lastCall?.[1]).toBeCloseTo(0.009);
    expect(lastCall?.[2]).toBe(450);
    expect(lastCall?.[3]).toBe(0.006);
  });

  it("handles events without usage data gracefully", async () => {
    const handle = await spawnWorker();

    if (capturedSubscriber) {
      capturedSubscriber({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", text: "hello" },
      });
    }

    await completeHandle(handle);

    expect(mockLapis.logCost).not.toHaveBeenCalled();
    expect(onCost).not.toHaveBeenCalled();
  });
});
