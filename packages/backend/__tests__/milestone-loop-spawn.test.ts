import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkingUnit, Mission, Milestone } from "@aurex/shared";

// Use vi.hoisted for shared mock references
const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
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

// Mock Pi SDK
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

// Mock git exec calls from worktree manager
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));;
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";

function createMockLapis(units: WorkingUnit[] = []): LaPisClient {
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny" },
      { verdict: "pass", validatorType: "validator_user_testing" },
    ]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "s1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    getContractHistory: vi.fn().mockResolvedValue([{
      content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" },
    }]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue([]),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "{}",
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

function makeMission(overrides?: Partial<Mission>): Mission {
  return {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    id: "ms-1",
    missionId: "m-1",
    title: "Auth module",
    description: "Implement auth",
    orderIndex: 0,
    status: "planned",
    validationContractId: "contract-1",
    ...overrides,
  };
}

describe("milestone loop with spawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("skips completed milestones", async () => {
    const lapis = createMockLapis();
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const mission = makeMission();
    const completedMilestone = makeMilestone({ status: "completed" });

    const result = await loop.run(mission, [completedMilestone]);
    expect(result.status).toBe("completed");
    // No milestones to process, mission completed
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
  });

  it("spawns a worker for each unit and processes the milestone", async () => {
    // Make session fire agent_end when prompt is called
    let eventSubscriber: (event: any) => void = () => {};
    (mockSession.subscribe as any).mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    (mockSession.prompt as any).mockImplementation(async () => {
      eventSubscriber({ type: "agent_end" });
    });

    const unit: WorkingUnit = {
      id: "unit-1",
      milestoneId: "ms-1",
      description: "Create login endpoint",
      declaredPaths: ["src/auth/login.ts"],
      declaredModules: ["auth"],
      status: "planned" as any, // Not yet active — will be processed by the loop
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };

    const lapis = createMockLapis([unit]);
    const pinyx = createMockPinyx();

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const mission = makeMission();
    const milestone = makeMilestone();

    const result = await loop.run(mission, [milestone]);

    // Milestone should be marked in_progress
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith("ms-1", "in_progress");

    // Units should have been fetched
    expect(lapis.getWorkingUnitsForMilestone).toHaveBeenCalledWith("ms-1");

    // Contract should have been fetched
    expect(lapis.getContractHistory).toHaveBeenCalledWith("ms-1");

    // A worker should have been spawned (session created)
    expect(mockCreateAgentSession).toHaveBeenCalled();
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(4);

    // Agent status callbacks should have been called
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        declaredPaths: ["src/auth/login.ts"],
        declaredModules: ["auth"],
        taskBranch: "task/worker-unit-1/unit-1",
        description: "Create login endpoint",
      }),
    );
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "working", "ms-1",
    );
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "research-ms-1", "research", "spawned", "ms-1",
    );
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "research-ms-1", "research", "researching", "ms-1",
    );
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "validator_scrutiny-ms-1", "validator_scrutiny", "reviewing", "ms-1",
    );
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "validator_user_testing-ms-1", "validator_user_testing", "reviewing", "ms-1",
    );

    // Unit should be marked completed
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "completed");

    // Milestone progress should be updated
    expect(callbacks.onMilestoneProgress).toHaveBeenCalledWith(
      "ms-1", "in_progress", 1, 1,
    );
  });
});
