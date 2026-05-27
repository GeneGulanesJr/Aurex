import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }
  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: {
        prompt: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue(() => {}),
        abort: vi.fn(),
        dispose: vi.fn(),
        sessionId: "mock",
      },
    }),
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ exec: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createMissionRunner } from "../src/orchestrator/mission-runner";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";

function createMockLapis(): LaPisClient {
  return {
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
    getContractHistory: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue([]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    createCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    listMissions: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        milestones: [{ title: "M1", description: "First", units: [], criteria: [], testCommands: [] }],
      }),
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

const mockEventBus = { emit: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}) };

describe("MissionRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in idle state", () => {
    const runner = createMissionRunner({
      lapis: createMockLapis(),
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });
    expect(runner.getStatus().state).toBe("idle");
    expect(runner.getActiveMissionId()).toBeNull();
  });

  it("rejects start when already running", () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));
    const runner = createMissionRunner({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });
    runner.start("m-1");
    expect(() => runner.start("m-2")).toThrow(/already running/);
  });

  it("transitions through planning → executing → completed", async () => {
    const lapis = createMockLapis();
    const runner = createMissionRunner({
      lapis,
      pinyx: createMockPinyx(),
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

  it("passes the mission orchestrator model hint to the planner", async () => {
    const lapis = createMockLapis();
    const pinyx = createMockPinyx();
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
      pinyx,
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const done = runner.waitForCompletion();
    runner.start("m-1");
    await done;

    expect(pinyx.chat).toHaveBeenCalledWith(expect.objectContaining({ model: "kilo/kilo-auto/free" }));
  });
});
