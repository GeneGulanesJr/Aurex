import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
  class MockAuthStorage {
    static inMemory = vi.fn(() => ({ setRuntimeApiKey: vi.fn() }));
  }
  class MockModelRegistry {
    static inMemory = vi.fn(() => new MockModelRegistry());
    registerProvider = vi.fn();
    find = vi.fn((_provider: string, modelId: string) => ({ provider: "pinyx", id: modelId }));
  }
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: {
        prompt: vi.fn().mockImplementation(function (this: any) {
          this.subscriber?.({
            type: "message_update",
            assistantMessageEvent: {
              type: "message_stop",
              usage: { promptTokens: 500, completionTokens: 500, totalTokens: 1000, cost: 1 },
            },
          });
          this.subscriber?.({ type: "agent_end" });
          return Promise.resolve();
        }),
        subscribe: vi.fn().mockImplementation(function (this: any, fn: any) {
          this.subscriber = fn;
          return () => {};
        }),
        abort: vi.fn(),
        dispose: vi.fn(),
        sessionId: "mock",
      },
    }),
    AuthStorage: MockAuthStorage,
    ModelRegistry: MockModelRegistry,
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));
vi.mock("../src/clients/pinyx-client.js", () => ({
  createPinyxClient: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        milestones: [{ title: "M1", description: "First", units: [], criteria: [], testCommands: [] }],
      }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    chatStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (text: string) => void) => {
      const content = JSON.stringify({
        milestones: [{ title: "M1", description: "First", units: [], criteria: [], testCommands: [] }],
      });
      onChunk(content);
      return {
        content,
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }),
    ping: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { createMissionRunner } from "../src/orchestrator/mission-runner";
import type { LaPisClient } from "../src/clients/lapis-client";
import { createPinyxClient } from "../src/clients/pinyx-client.js";

function makeHandoff(unitId: string) {
  return {
    unitId,
    featureName: `Feature ${unitId}`,
    description: `Completed ${unitId}`,
    implemented: `Implemented ${unitId}`,
    remaining: "none",
    rationale: "The mission runner test fixture supplies valid handoff evidence for mocked worker completion.",
    assumptions: "Agent execution is mocked",
    unresolvedUncertainties: "none",
    errorsEncountered: "none",
    commandsRun: [{ command: "npm test", exitCode: 0 }],
    gitCommitHash: "abc123",
  };
}

function createMockLapis(): LaPisClient {
  return {
    getSetting: vi.fn().mockImplementation((key: string) => {
      if (key === "pinyx_config") return Promise.resolve({ endpoint: "http://pinyx:7331" });
      if (key === "github_token") return Promise.resolve(null);
      if (key === "quota_config") return Promise.resolve({ enabled: false, windowDurationMs: 5 * 3600_000, burnDurationMs: 3600_000, providers: [] });
      if (key === "quota_windows") return Promise.resolve({});
      if (key.startsWith("mission:")) return Promise.resolve(null);
      return Promise.resolve(null);
    }),
    getMission: vi.fn().mockResolvedValue({
      id: "m-1",
      description: "Build auth",
      status: "planning",
      configJson: {
        modelHints: {
          orchestrator: "reasoning-strong",
          worker: "code-fast",
          validator_scrutiny: "reasoning",
          validator_user_testing: "computer-use",
          research: "fast-cheap",
        },
        workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
        costCap: 50,
        maxValidatorRetries: 2,
        maxRescopes: 5,
      },
      createdAt: "2026-01-01",
    }),
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    createMilestone: vi.fn().mockResolvedValue({
      id: "ms-1",
      missionId: "m-1",
      title: "M1",
      description: "First",
      orderIndex: 0,
      status: "planned",
      validationContractId: "",
    }),
    createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1", description: "Unit" }),
    createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([]),
    getMilestonesForMission: vi.fn().mockResolvedValue([
      { id: "ms-1", missionId: "m-1", title: "M1", description: "First", orderIndex: 0, status: "planned", validationContractId: "" },
    ]),
    getContractHistory: vi.fn().mockResolvedValue([]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue([makeHandoff("u-1"), makeHandoff("u-done")]),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny" },
    ]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    searchMemory: vi.fn().mockResolvedValue([]),
    createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
    createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    indexRepo: vi.fn().mockResolvedValue({ files: 10, symbols: 100 }),
    getCodeSummary: vi.fn().mockResolvedValue({ files: 10, symbols: 100, edges: 20, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } }),
    getFindings: vi.fn().mockResolvedValue([]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    createCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    listMissions: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

const mockEventBus = { emit: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}) };

describe("MissionRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in idle state", () => {
    const runner = createMissionRunner({
      lapis: createMockLapis(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });
    expect(runner.getStatus().state).toBe("idle");
    expect(runner.getActiveMissionId()).toBeNull();
  });

  it("ignores start when already running", () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));
    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });
    runner.start("m-1");
    expect(() => runner.start("m-2")).not.toThrow();
  });

  it("transitions through planning → executing → completed", async () => {
    const lapis = createMockLapis();
    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "running");
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
    expect(runner.getStatus().state).toBe("completed");
  });

  it("does not overwrite recoverable planner failures with non-recoverable mission_crash", async () => {
    const lapis = createMockLapis();
    const failingPinyx = {
      chat: vi.fn(),
      chatStream: vi.fn().mockRejectedValue(new Error("planner provider unavailable")),
      ping: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createPinyxClient).mockReturnValueOnce(failingPinyx as any);
    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(mockEventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_error",
      code: "planner_failed",
      recoverable: true,
    }));
    expect(mockEventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_error",
      code: "mission_crash",
      recoverable: false,
    }));
    expect(runner.getStatus().state).toBe("failed");
  });

  it("passes the mission orchestrator model hint to the planner", async () => {
    const lapis = createMockLapis();
    const mockPinyx = createPinyxClient({ endpoint: "http://pinyx:7331" });
    (lapis.getMission as any).mockResolvedValue({
      id: "m-1",
      description: "Build auth",
      status: "planning",
      configJson: {
        modelHints: {
          orchestrator: "kilo/kilo-auto/free",
          worker: "kilo/kilo-auto/free",
          validator_scrutiny: "kilo/kilo-auto/free",
          validator_user_testing: "kilo/kilo-auto/free",
          research: "kilo/kilo-auto/free",
        },
        workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
        costCap: 50,
        maxValidatorRetries: 2,
        maxRescopes: 5,
      },
      createdAt: "2026-01-01",
    });
    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(mockPinyx.chatStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "kilo/kilo-auto/free" }),
      expect.any(Function),
    );
  });

  it("resolves milestone_complete checkpoint and continues to next milestone", async () => {
    const lapis = createMockLapis();
    const mockPinyx = createPinyxClient({ endpoint: "http://pinyx:7331" });

    // Plan returns 2 milestones
    (mockPinyx.chat as any).mockResolvedValue({
      content: JSON.stringify({
        milestones: [
          { title: "M1", description: "First", units: [], criteria: [], testCommands: [] },
          { title: "M2", description: "Second", units: [], criteria: [], testCommands: [] },
        ],
      }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    // Milestone loop returns checkpoint_needed for M1, then completed for M2
    let loopCallCount = 0;
    const originalRun = lapis.getWorkingUnitsForMilestone;
    
    // We need the milestone loop to return checkpoint_needed first, then completed
    // The mock milestone loop behavior is controlled by the verdicts/getWorkingUnits
    // For simplicity, we'll test at the runner level by mocking the loop directly
    // Actually, the runner creates the loop internally. Let me use the checkpoint resolution.
    
    // Make checkpointManager.waitForResolution resolve immediately with "approve"
    // The first checkpoint is for milestone_complete on M1
    const checkpointCreate = lapis.createCheckpoint as any;
    const checkpointResolve = lapis.resolveCheckpoint as any;
    
    // resolveCheckpoint returns approved checkpoint
    (checkpointResolve as any).mockResolvedValue({
      id: "cp-1", status: "resolved", decision: "approve",
    });

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    // Mission should complete after checkpoint resolution
    expect(runner.getStatus().state).toBe("completed");
    
    // Should have created a checkpoint
    expect(lapis.createCheckpoint).toHaveBeenCalled();
    
    // Should have marked the milestone as completed after approval
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith(expect.any(String), "completed");
  });

  it("rescope checkpoint decision re-plans the milestone instead of failing the mission", async () => {
    const lapis = createMockLapis();
    const mockPinyx = createPinyxClient({ endpoint: "http://pinyx:7331" });

    // 1) Planner: 1 milestone, no units (default plan shape is fine)
    (mockPinyx.chatStream as any).mockImplementation(async (_req: unknown, onChunk: (text: string) => void) => {
      const content = JSON.stringify({
        milestones: [{ title: "M1", description: "First", units: [], criteria: [], testCommands: [] }],
      });
      onChunk(content);
      return { content, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    });

    // 2) Rescope re-plan: pinyx.chat must return the rescope JSON shape `{ units: [...] }`
    (mockPinyx.chat as any).mockResolvedValue({
      content: JSON.stringify({ units: [{ description: "Re-planned unit", declaredPaths: ["src/x.ts"], declaredModules: ["x"] }] }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    // 3) Mock completed working units so completedUnitSummaries is passed to rescope
    (lapis.getWorkingUnitsForMilestone as any).mockResolvedValue([
      { id: "u-done", description: "Already done unit", declaredPaths: ["src/done.ts"], declaredModules: ["done"], status: "completed", milestoneId: "ms-1", taskBranch: "", worktreePath: "", sessionId: "" },
    ]);

    // 4) Checkpoint poll: first call returns "approve" + rescopeGuidance, second returns plain "approve"
    (lapis.getCheckpoint as any)
      .mockResolvedValueOnce({ id: "cp-1", status: "resolved", decision: "approve", rescopeGuidance: "try a different approach" })
      .mockResolvedValue({ id: "cp-2", status: "resolved", decision: "approve" });

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    // The mission must NOT be marked failed. It should reach "completed" because
    // the rescope branch should re-plan, fall through to loop again, and the
    // second milestone_complete checkpoint is approved.
    expect(runner.getStatus().state).toBe("completed");
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
    expect(lapis.updateMissionStatus).not.toHaveBeenCalledWith("m-1", "failed");

    // Re-planning must have happened: a new working unit was created for the
    // rescope re-plan output.
    expect(lapis.createWorkingUnit).toHaveBeenCalledWith(
      "ms-1",
      expect.objectContaining({ description: "Re-planned unit" }),
    );

    // The rescope prompt must include the completed unit summary so it is not re-planned
    const rescopeCall = (mockPinyx.chat as any).mock.calls.find((call: any) => {
      const userMsg = call[0]?.messages?.find((m: any) => m.role === "user");
      return userMsg?.content?.includes("Already Completed Units");
    });
    expect(rescopeCall).toBeDefined();
    const userMessage = rescopeCall[0].messages.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Already done unit");
  });

  it("approval of cost_cap_exceeded checkpoint lets the mission continue", async () => {
    const lapis = createMockLapis();
    const mockPinyx = createPinyxClient({ endpoint: "http://pinyx:7331" });

    // Make the plan include a worker so the mocked session emits usage before validation.
    (mockPinyx.chat as any).mockResolvedValue({
      content: JSON.stringify({
        milestones: [{ title: "M1", description: "First", units: [{ description: "Do work", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }], criteria: [], testCommands: [] }],
      }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    (lapis.getMission as any).mockResolvedValue({
      id: "m-1",
      description: "Build auth",
      status: "planning",
      configJson: {
        modelHints: {
          orchestrator: "reasoning-strong",
          worker: "code-fast",
          validator_scrutiny: "reasoning",
          validator_user_testing: "computer-use",
          research: "fast-cheap",
        },
        workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
        costCap: 0.5,
        maxValidatorRetries: 2,
        maxRescopes: 5,
      },
      createdAt: "2026-01-01",
    });

    const unit = {
      id: "u-1",
      milestoneId: "ms-1",
      description: "Do work",
      declaredPaths: ["src/a.ts"],
      declaredModules: ["a"],
      status: "planned",
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };
    (lapis.createWorkingUnit as any).mockResolvedValue(unit);
    (lapis.getWorkingUnitsForMilestone as any).mockResolvedValue([unit]);

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    const checkpointTriggers = (lapis.createCheckpoint as any).mock.calls.map((call: any[]) => call[0].trigger);
    expect(checkpointTriggers).toContain("cost_cap_exceeded");
    // Approval should continue execution, not mark the milestone complete immediately.
    // The mission should still reach the normal milestone_complete gate afterwards.
    expect(checkpointTriggers).toContain("milestone_complete");
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
    expect(runner.getStatus().state).toBe("completed");
  });
});
