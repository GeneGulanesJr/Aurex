import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "validator-session-1",
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

import { createAgentSpawner } from "../../src/agents/agent-spawner";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getContractHistory: vi.fn().mockResolvedValue([]),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue([]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

describe("AgentSpawner — validator types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.subscribe.mockReturnValue(() => {});
    mockSession.prompt.mockResolvedValue(undefined);
    // Simulate immediate agent_end
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });
  });

  it("spawns a validator_scrutiny agent with read-only tools", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    const handle = await spawner.spawn({
      agentType: "validator_scrutiny",
      unitId: "unit-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/app/src/skills/validator.md",
      contextContent: "# Validate milestone",
      taskPrompt: "Validate milestone ms-1 against contract c-1",
      timeout: 60_000,
      contractId: "c-1",
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");
    expect(lapis.registerAgentSession).toHaveBeenCalledWith(
      "validator_scrutiny",
      "validator-session-1",
      "m-1",
      "ms-1",
      "unit-1",
    );
  });

  it("spawns a validator_user_testing agent", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    const handle = await spawner.spawn({
      agentType: "validator_user_testing",
      unitId: "unit-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/app/src/skills/validator.md",
      contextContent: "# User test milestone",
      taskPrompt: "Test user flows",
      timeout: 120_000,
      contractId: "c-1",
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");
  });

  it("strips memory-layer extension from validator sessions", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    const handle = await spawner.spawn({
      agentType: "validator_scrutiny",
      unitId: "unit-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/app/src/skills/validator.md",
      contextContent: "# Validate milestone",
      taskPrompt: "Validate milestone ms-1",
      timeout: 60_000,
      contractId: "c-1",
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");
    expect(lapis.registerAgentSession).toHaveBeenCalledWith(
      "validator_scrutiny",
      "validator-session-1",
      "m-1",
      "ms-1",
      "unit-1",
    );
  });
});
