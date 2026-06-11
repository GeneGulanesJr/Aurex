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
import { makeHandoff } from "./helpers/make-handoff.js";


function createMockLapis(units: WorkingUnit[] = [], handoffs = units.map((unit) => makeHandoff(unit.id))): LaPisClient {
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
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    getFindings: vi.fn().mockResolvedValue([]),
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
      onError: vi.fn(),
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
      onError: vi.fn(),
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

  it("infers worker scope from the mission target path when LaPis returns sparse units", async () => {
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
      description: "",
      declaredPaths: [],
      declaredModules: [],
      status: "planned" as any,
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
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo/GeneGulanesJr-PiNyx",
      gitMainBranch: "main",
    });

    await loop.run(makeMission({
      description: "Refactor /repo/GeneGulanesJr-PiNyx/pinyx/src/server/mod.rs to reduce complexity.",
    }), [makeMilestone({
      title: "Analyze server module",
      description: "Analyze current server/mod.rs complexity and structure",
    })]);

    // Scope is filled in from the inferred paths, but the unit's own
    // description is NOT rewritten — that was the prior behavior we
    // removed because it silently overwrote planner identity.
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        declaredPaths: ["pinyx/src/server/mod.rs"],
        declaredModules: ["server"],
        description: "",
      }),
    );
  });

  it("preserves a planner-provided unit description while still inferring missing scope", async () => {
    // Scope-fallback safety: a unit that has a real description but no
    // declaredPaths/declaredModules should get the scope filled in
    // (paths inferred from the mission text) but the description must
    // NOT be overwritten with the milestone title. This is the
    // regression guard for the prior behavior that silently replaced
    // unit.description when scope was empty.
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
      description: "Implement refactor of classify() to reduce cyclomatic complexity from 18 to < 10",
      declaredPaths: [],
      declaredModules: [],
      status: "planned" as any,
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
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo/GeneGulanesJr-PiNyx",
      gitMainBranch: "main",
    });

    await loop.run(makeMission({
      description: "Refactor /repo/GeneGulanesJr-PiNyx/pinyx/src/server/classify.rs to reduce complexity.",
    }), [makeMilestone({
      title: "Analyze server module",
      description: "Analyze current server/classify.rs complexity and structure",
    })]);

    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        declaredPaths: ["pinyx/src/server/classify.rs"],
        declaredModules: ["server"],
        // The planner's description is preserved verbatim.
        description: "Implement refactor of classify() to reduce cyclomatic complexity from 18 to < 10",
      }),
    );
  });

  it("uses the selected worker timeout instead of disabling worker deadlines", async () => {
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
      status: "planned" as any,
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
      onError: vi.fn(),
    };
    const logger = { log: vi.fn() };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
      logger,
    });

    await loop.run(makeMission({
      configJson: {
        ...makeMission().configJson,
        workerTimeouts: { simple: 180_000, build: 300_000, testHeavy: 600_000 },
      },
    }), [makeMilestone()]);

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      agentType: "orchestrator",
      event: "config_decision",
      data: expect.objectContaining({ decision: "selectWorkerTimeout", timeout: 180_000 }),
    }));
    expect(logger.log).not.toHaveBeenCalledWith(expect.objectContaining({
      agentType: "worker",
      event: "config_decision",
      data: expect.objectContaining({ decision: "timeout_disabled" }),
    }));
  });

  it.each([
    "Inventory current public API and dependencies",
    "Measure baseline complexity and identify hotspots",
  ])("uses build timeout for analysis-heavy worker unit: %s", async (description) => {
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
      description,
      declaredPaths: ["pinyx/src/server/mod.rs"],
      declaredModules: ["server"],
      status: "planned" as any,
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
      onError: vi.fn(),
    };
    const logger = { log: vi.fn() };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo/GeneGulanesJr-PiNyx",
      gitMainBranch: "main",
      logger,
    });

    await loop.run(makeMission({
      configJson: {
        ...makeMission().configJson,
        workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      },
    }), [makeMilestone({
      title: "Analyze and map current complexity hotspots",
      description: "Analyze and map current complexity hotspots",
    })]);

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      agentType: "orchestrator",
      event: "config_decision",
      data: expect.objectContaining({
        decision: "selectWorkerTimeout",
        needsBuildWindow: true,
        timeout: 300_000,
      }),
    }));
  });

  it("retries a worker that completes without a handoff before validation", async () => {
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
      status: "planned" as any,
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };

    const lapis = createMockLapis([unit], []);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("failed to submit a valid handoff");
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "planned");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "worker_handoff_invalid",
      expect.stringContaining("valid handoff"),
      expect.objectContaining({ recoverable: true }),
    );
  });

  it("prunes worktrees for workers retried due to missing handoff", async () => {
    let eventSubscriber: (event: any) => void = () => {};
    (mockSession.subscribe as any).mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    (mockSession.prompt as any).mockImplementation(async () => {
      eventSubscriber({ type: "agent_end" });
    });

    const unit: WorkingUnit = {
      id: "unit-wt",
      milestoneId: "ms-1",
      description: "Create auth module",
      declaredPaths: ["src/auth/index.ts"],
      declaredModules: ["auth"],
      status: "planned" as any,
      taskBranch: "task/unit-wt",
      worktreePath: "/repo/.git-worktrees/unit-wt",
      sessionId: "",
    };

    const lapis = createMockLapis([unit], []);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    await loop.run(makeMission(), [makeMilestone()]);

    const allCalls = mockExecAsync.mock.calls.map((c: any) => JSON.stringify(c));
    const pruneCall = allCalls.find((c: string) => c.includes("worktree") && c.includes("remove"));
    expect(pruneCall).toBeDefined();
  });

});
