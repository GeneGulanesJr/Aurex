import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkingUnit, Mission, Milestone } from "@aurex/shared";

// Capture every spawn() call's options so we can assert the timeout each
// agent type received.
const spawnCalls: Array<{ agentType: string; timeout?: number }> = [];

vi.mock("../src/agents/agent-spawner.js", () => ({
  createAgentSpawner: () => ({
    spawn: async (opts: { agentType: string; timeout?: number }) => {
      spawnCalls.push({ agentType: opts.agentType, timeout: opts.timeout });
      return {
        sessionId: `fake-${opts.agentType}`,
        completed: Promise.resolve({ status: "completed" as const, sessionId: `fake-${opts.agentType}` }),
        abort: () => {},
        dispose: () => {},
      };
    },
  }),
}));

// Mock git exec calls from the worktree manager.
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecAsync }));

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
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => (
      handoffs.find((handoff) => handoff.unitId === unitId) ?? null
    )),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    getFindings: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
    setTodoStatus: vi.fn().mockResolvedValue(undefined),
    listTodosByMission: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue(undefined),
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

describe("milestone loop agent timeouts", () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  const unit: WorkingUnit = {
    id: "unit-1",
    milestoneId: "ms-1",
    description: "Create login endpoint",
    declaredPaths: ["src/auth/login.ts"],
    declaredModules: ["auth"],
    status: "planned" as never,
    taskBranch: "",
    worktreePath: "",
    sessionId: "",
  };

  function baseCallbacks() {
    return {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };
  }

  it("uses the dedicated researchTimeout for the research agent", async () => {
    const lapis = createMockLapis([unit]);
    const loop = createMilestoneLoop(lapis, createMockPinyx(), baseCallbacks(), {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      aurexRoot: "/aurex",
      gitMainBranch: "main",
      researchTimeout: 123_000,
      validatorTimeout: 456_000,
    });

    await loop.run(makeMission(), [makeMilestone()]);

    const researchSpawn = spawnCalls.find((c) => c.agentType === "research");
    expect(researchSpawn).toBeDefined();
    expect(researchSpawn!.timeout).toBe(123_000);
  });

  it("uses the dedicated validatorTimeout for validator agents", async () => {
    const lapis = createMockLapis([unit]);
    const loop = createMilestoneLoop(lapis, createMockPinyx(), baseCallbacks(), {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      aurexRoot: "/aurex",
      gitMainBranch: "main",
      researchTimeout: 123_000,
      validatorTimeout: 456_000,
    });

    await loop.run(makeMission(), [makeMilestone()]);

    const validatorSpawns = spawnCalls.filter((c) => c.agentType.startsWith("validator"));
    expect(validatorSpawns.length).toBeGreaterThan(0);
    for (const vs of validatorSpawns) {
      expect(vs.timeout).toBe(456_000);
    }
  });

  it("falls back to workerTimeouts.testHeavy when the dedicated timeout is not set", async () => {
    const lapis = createMockLapis([unit]);
    const loop = createMilestoneLoop(lapis, createMockPinyx(), baseCallbacks(), {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      aurexRoot: "/aurex",
      gitMainBranch: "main",
      // No researchTimeout / validatorTimeout set — should fall back to testHeavy (600_000).
    });

    await loop.run(makeMission(), [makeMilestone()]);

    const researchSpawn = spawnCalls.find((c) => c.agentType === "research");
    expect(researchSpawn!.timeout).toBe(600_000);

    const validatorSpawns = spawnCalls.filter((c) => c.agentType.startsWith("validator"));
    for (const vs of validatorSpawns) {
      expect(vs.timeout).toBe(600_000);
    }
  });

  it("re-fetches research findings after the worker phase so worker-driven verify/reject transitions are visible", async () => {
    const lapis = createMockLapis([unit]);
    const loop = createMilestoneLoop(lapis, createMockPinyx(), baseCallbacks(), {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      aurexRoot: "/aurex",
      gitMainBranch: "main",
    });

    await loop.run(makeMission(), [makeMilestone()]);

    // Without the post-worker refresh, getFindings is only called for the
    // initial load (1) and once after pre-research (2). The refresh added
    // after the worker phase guarantees a 3rd fetch so the validator phase
    // (and any retry iteration) sees the latest finding statuses.
    const getFindings = lapis.getFindings as ReturnType<typeof vi.fn>;
    expect(getFindings.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Every fetch must be scoped to this mission.
    for (const args of getFindings.mock.calls) {
      expect(args[0]).toBe("m-1");
    }
  });
});
