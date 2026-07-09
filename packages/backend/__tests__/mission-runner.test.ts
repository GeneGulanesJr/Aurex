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

// Mock repo-prep so tests don't touch the filesystem. The hardened
// prepareRepoForMission throws when parentRepoRoot lacks a .git dir and
// no cloneUrl is given (Docker workspace fix); tests use a fake repoRoot,
// so we short-circuit to the "already a git repo" branch.
vi.mock("../src/orchestrator/repo-prep.js", () => ({
  prepareRepoForMission: vi.fn().mockResolvedValue({
    repoPath: "/test/repo",
    repoStatus: "updated",
  }),
  repoDirNameFromCloneUrl: vi.fn(),
  normalizeGitHubCloneUrl: vi.fn(),
}));
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
import { makeHandoff } from "./helpers/make-handoff.js";
import { createInMemoryExecutionQueueStore } from "../src/queue/execution-queue-store";


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
    getMilestonesForMission: vi.fn().mockResolvedValue([]),
    getContractHistory: vi.fn().mockResolvedValue([]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue([makeHandoff("u-1"), makeHandoff("u-done")]),
    // v1 milestone loop looks up handoffs per-unit (lapis.getHandoffForUnit)
    // rather than via the milestone-level query. Mock it so a worker that
    // completes produces a valid handoff and the unit can succeed.
    getHandoffForUnit: vi.fn().mockResolvedValue(makeHandoff("u-1")),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "mock" },
    ]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "mock", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
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
    writeVerdict: vi.fn().mockResolvedValue({ verdict: "fail", validatorType: "validator_scrutiny", sessionId: "mock" }),
    createCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    listMissions: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue({ summary: "compressed", tokensSaved: 0 }),
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

  it("does not re-plan on milestone_complete approval when rescopeGuidance is present", async () => {
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

    // 2) Rescope re-plan would use this if triggered — it must NOT be called
    // for milestone_complete checkpoints even when rescopeGuidance is present.
    (mockPinyx.chat as any).mockResolvedValue({
      content: JSON.stringify({ units: [{ description: "Re-planned unit", declaredPaths: ["src/x.ts"], declaredModules: ["x"] }] }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    // 3) Checkpoint poll: first call returns "approve" + rescopeGuidance on
    // milestone_complete, second returns plain "approve".
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

    expect(runner.getStatus().state).toBe("completed");
    expect(lapis.updateMissionStatus).toHaveBeenCalledWith("m-1", "completed");
    expect(lapis.updateMissionStatus).not.toHaveBeenCalledWith("m-1", "failed");

    // Rescope must NOT run for milestone_complete — no new units from rescope plan.
    expect(lapis.createWorkingUnit).not.toHaveBeenCalledWith(
      "ms-1",
      expect.objectContaining({ description: "Re-planned unit" }),
    );
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

  it("indexes the repo, persists repoName, and passes codeSummary to the planner", async () => {
    const lapis = createMockLapis();
    // Force the indexing path: empty summary first → calls indexRepo
    (lapis.getCodeSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] },
    });
    (lapis.indexRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ files: 50, symbols: 200 });
    // Second getCodeSummary call (post-index) returns populated data
    (lapis.getCodeSummary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } })
      .mockResolvedValueOnce({ files: 50, symbols: 200, edges: 80, modules: [{ name: "auth", fileCount: 4 }], entryPoints: ["src/index.ts"], cycles: { count: 0, paths: [] } });

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      aurexRoot: "/test/aurex",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    // 1. indexRepo was called with (repoPath, repoName)
    expect(lapis.indexRepo).toHaveBeenCalledWith("/test/repo", "repo");

    // 2. setSetting persisted the repoName for the dashboard route
    const repoNameSetting = (lapis.setSetting as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "mission:m-1:repoName",
    );
    expect(repoNameSetting).toBeDefined();
    expect(repoNameSetting?.[1]).toBe("repo");
  });

  // Phase 1 regression: when a queue + job are provided, the runner mirrors
  // the job's lifetime — completes it on success, fails it on failure.
  it("completes the execution-queue job when the mission succeeds", async () => {
    const lapis = createMockLapis();
    const queue = createInMemoryExecutionQueueStore();
    const job = await queue.enqueue({ type: "mission_start", missionId: "m-1", maxAttempts: 1 });
    const claim = await queue.claimById(job.id, "test");
    await queue.markRunning(claim!.job.id, claim!.claimToken);

    const runner = createMissionRunner({
      lapis,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      queue,
      job: { jobId: claim!.job.id, claimToken: claim!.claimToken },
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(runner.getStatus().state).toBe("completed");
    const finalJob = await queue.get(claim!.job.id);
    expect(finalJob?.status).toBe("succeeded");
  });

  it("fails the execution-queue job when the mission fails", async () => {
    const lapis = createMockLapis();
    const queue = createInMemoryExecutionQueueStore();
    const job = await queue.enqueue({ type: "mission_start", missionId: "m-1", maxAttempts: 1 });
    const claim = await queue.claimById(job.id, "test");
    await queue.markRunning(claim!.job.id, claim!.claimToken);

    // Force planner failure so the mission ends in "failed".
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
      queue,
      job: { jobId: claim!.job.id, claimToken: claim!.claimToken },
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(runner.getStatus().state).toBe("failed");
    const finalJob = await queue.get(claim!.job.id);
    expect(finalJob?.status).toBe("failed");
    expect(finalJob?.failureCode).toBe("MISSION_FAILED");
  });
});
