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
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "test-session-123" },
      { verdict: "pass", validatorType: "validator_user_testing", sessionId: "test-session-123" },
    ]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "s1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    getContractHistory: vi.fn().mockResolvedValue([{
      content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" },
    }]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => (
      handoffs.find((handoff) => handoff.unitId === unitId) ?? null
    )),
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

    // A worker should have been spawned (session created). One unit →
    // research + worker + 2 end-of-milestone validators = 4 agent sessions.
    expect(mockCreateAgentSession).toHaveBeenCalled();
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(4);

    // Agent status callbacks should have been called
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        declaredPaths: ["src/auth/login.ts"],
        declaredModules: ["auth"],
        taskBranch: "feature/m-1/1",
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

    // Scope and description are filled from milestone/mission context when
    // LaPis returns a sparse unit with no actionable task text.
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        declaredPaths: ["pinyx/src/server/mod.rs"],
        declaredModules: ["server"],
        description: "Analyze current server/mod.rs complexity and structure",
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

  it("uses configured wall-clock deadlines for worker agents", async () => {
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

    expect(logger.log).not.toHaveBeenCalledWith(expect.objectContaining({
      agentType: "worker",
      event: "config_decision",
      data: expect.objectContaining({ decision: "timeout_disabled" }),
    }));
  });

  it.each([
    "Inventory current public API and dependencies",
    "Measure baseline complexity and identify hotspots",
  ])("gives analysis-heavy worker unit a configured deadline: %s", async (description) => {
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

    expect(logger.log).not.toHaveBeenCalledWith(expect.objectContaining({
      agentType: "worker",
      event: "config_decision",
      data: expect.objectContaining({ decision: "timeout_disabled" }),
    }));
  });

  it("falls back to milestone text when worker unit description is empty", async () => {
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
        workerTimeouts: { simple: 180_000, build: 300_000, testHeavy: 600_000 },
      },
    }), [makeMilestone({
      title: "Analyze current server/mod.rs structure and complexity hotspots",
      description: "Analyze current server/mod.rs structure and complexity hotspots",
    })]);

    expect(logger.log).not.toHaveBeenCalledWith(expect.objectContaining({
      agentType: "worker",
      event: "config_decision",
      data: expect.objectContaining({ decision: "timeout_disabled" }),
    }));
    expect(callbacks.onAgentStatus).toHaveBeenCalledWith(
      "worker-unit-1", "worker", "spawned", "ms-1",
      expect.objectContaining({
        description: "Analyze current server/mod.rs structure and complexity hotspots",
      }),
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(expect.stringContaining(
      "Implement: Analyze current server/mod.rs structure and complexity hotspots",
    ));
  });


  it("retries timed-out workers once, then checkpoints instead of stalling", async () => {
    (mockSession.subscribe as any).mockImplementation(() => () => {});
    (mockSession.prompt as any).mockResolvedValue(undefined);

    const unit: WorkingUnit = {
      id: "unit-timeout",
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
    (lapis.getFindings as any).mockResolvedValue([
      { id: "finding-1", missionId: "m-1", domain: ["auth"], title: "Existing context", content: "Skip pre-worker research", relevance: "low", status: "active", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    (lapis.getContractHistory as any).mockResolvedValue([{
      id: "contract-1",
      content: { criteria: ["works"], testCommands: [], acceptanceBehavior: "" },
    }]);
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission({
      configJson: {
        ...makeMission().configJson,
        workerTimeouts: { simple: 5, build: 5, testHeavy: 5 },
        maxPerUnitRetries: 1,
      },
    }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("timed out after 2 attempt(s)");
    // Pre-worker research is skipped (findings already present), so only
    // the 2 worker attempts (1 initial + 1 retry) create agent sessions.
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-timeout", "planned");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "worker_timeout",
      expect.stringContaining("timed out"),
      expect.objectContaining({ recoverable: true }),
    );
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

    const result = await loop.run(makeMission({
      configJson: { ...makeMission().configJson, maxPerUnitRetries: 1 },
    }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("valid handoff");
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "planned");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "worker_handoff_invalid",
      expect.stringContaining("valid handoff"),
      expect.objectContaining({ recoverable: true }),
    );
  });

  it("prunes the feature worktree when the milestone completes", async () => {
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
      taskBranch: "",
      worktreePath: "",
      sessionId: "",
    };

    // Valid handoff → unit passes → validator passes → milestone_complete prunes the feature worktree.
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

    const result = await loop.run(makeMission(), [makeMilestone()]);
    expect(result.status).toBe("checkpoint_needed");

    const allCalls = mockExecAsync.mock.calls.map((c: any) => JSON.stringify(c));
    const pruneCall = allCalls.find((c: string) => c.includes("worktree") && c.includes("remove"));
    expect(pruneCall).toBeDefined();
  });

  it("reports handoff fetch failures distinctly from missing worker handoffs", async () => {
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
    // The per-unit handoff lookup throws → distinct fetch-failure path.
    (lapis.getHandoffForUnit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LaPis unavailable"));
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

    await loop.run(makeMission({ configJson: { ...makeMission().configJson, maxPerUnitRetries: 1 } }), [makeMilestone()]);

    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "worker_handoff_fetch_failed",
      expect.stringContaining("could not be loaded"),
      expect.objectContaining({
        details: { errors: [expect.stringContaining("handoff fetch failed")] },
      }),
    );
  });

  it("falls back to per-unit handoff lookup when milestone query misses a stored handoff", async () => {
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
    (lapis.getHandoffsForMilestone as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (lapis.getHandoffForUnit as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandoff("unit-1"));
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

    expect(lapis.getHandoffForUnit).toHaveBeenCalledWith("unit-1");
    expect(callbacks.onError).not.toHaveBeenCalledWith(
      "m-1",
      "worker_handoff_invalid",
      expect.any(String),
      expect.anything(),
    );
    expect(callbacks.onError).not.toHaveBeenCalledWith(
      "m-1",
      "worker_handoff_fetch_failed",
      expect.any(String),
      expect.anything(),
    );
  });

});
