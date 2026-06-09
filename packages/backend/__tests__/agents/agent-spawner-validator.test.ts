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

  it("counts tool calls in a validator session and aborts when cap is exceeded", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    // Override the default subscribe mock: emit many tool_call events.
    // The spawner should abort the session when the cap is exceeded
    // (well before any agent_end).
    mockSession.subscribe.mockImplementation((fn: any) => {
      for (let i = 0; i < 30; i++) {
        setTimeout(() => fn({
          type: "message_update",
          assistantMessageEvent: {
            type: "tool_call",
            toolCall: { name: "bash", arguments: { command: `ls -la ${i}` } },
          },
        }), i);
      }
      // Never emit agent_end — the spawner should abort the session itself.
      return () => {};
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("tool_call_cap");
  });

  it("writes a synthetic fail verdict to LaPis when validator exceeds tool-call cap", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    mockSession.subscribe.mockImplementation((fn: any) => {
      for (let i = 0; i < 30; i++) {
        setTimeout(() => fn({
          type: "message_update",
          assistantMessageEvent: {
            type: "tool_call",
            toolCall: { name: "read", arguments: { path: `file-${i}.ts` } },
          },
        }), i);
      }
      return () => {};
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("tool_call_cap");

    // The synthetic verdict must be written to LaPis so the negotiator
    // can route to retry/rescope.
    expect(lapis.writeVerdict).toHaveBeenCalledWith(
      "validator-session-1",
      expect.objectContaining({
        milestoneId: "ms-1",
        contractId: "c-1",
        validatorType: "validator_scrutiny",
        verdict: "fail",
        failedUnitIds: expect.any(Array),
      }),
    );
  });
});
