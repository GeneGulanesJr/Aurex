import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "worker-session-1",
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
    defineTool: (tool: unknown) => tool,
  };
});

import { createAgentSpawner } from "../../src/agents/agent-spawner";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    logCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function spawnWorker(lapis: LaPisClient) {
  const spawner = createAgentSpawner({
    lapis,
    agentDir: "/test/.pi/agent",
    defaultTimeout: 60_000,
  });

  return spawner.spawn({
    agentType: "worker",
    agentId: "worker-unit-1",
    unitId: "unit-1",
    missionId: "m-1",
    milestoneId: "ms-1",
    cwd: "/test/repo",
    skillFilePath: "/app/src/skills/worker.md",
    contextContent: "# Worker context",
    taskPrompt: "Implement unit-1",
    timeout: 60_000,
  });
}

describe("AgentSpawner — worker handoff lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.abort.mockClear();
    mockSession.dispose.mockClear();
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.subscribe.mockReturnValue(() => {});
  });

  it("fails a worker that ends without an accepted handoff", async () => {
    const lapis = createMockLapis();
    mockSession.subscribe.mockImplementation((fn: (event: unknown) => void) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const handle = await spawnWorker(lapis);
    const result = await handle.completed;

    expect(result.status).toBe("failed");
    expect(result.error).toContain("write_handoff");
  });

  it("completes and aborts the worker session after LaPis accepts write_handoff", async () => {
    const lapis = createMockLapis();
    mockCreateAgentSession.mockImplementationOnce(async (opts: { customTools: Array<{ name: string; execute: Function }> }) => {
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          ...mockSession,
          subscribe(fn: (event: unknown) => void) {
            subscriber = fn;
            return () => {};
          },
          async prompt() {
            const handoffTool = opts.customTools.find((tool) => tool.name === "write_handoff");
            await handoffTool?.execute("handoff-call", {
              featureName: "Worker lifecycle",
              description: "Submitted handoff evidence",
              implemented: "Connected worker completion to handoff acceptance",
              remaining: "none",
              rationale: "The orchestrator needs accepted handoff evidence before validation.",
              assumptions: "LaPis accepts valid structured handoffs.",
              unresolvedUncertainties: "none",
              errorsEncountered: "none",
              commandsRun: JSON.stringify([{ command: "test fixture", exitCode: 0 }]),
              gitCommitHash: "abc123",
            });
            subscriber({ type: "agent_end" });
          },
        },
      };
    });

    const handle = await spawnWorker(lapis);
    const result = await handle.completed;

    expect(result.status).toBe("completed");
    expect(lapis.writeHandoff).toHaveBeenCalledWith("unit-1", expect.objectContaining({
      featureName: "Worker lifecycle",
    }));
    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });
});
