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
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createMissionRunnerPool } from "../src/orchestrator/mission-runner-pool";
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
      id: "ms-1", missionId: "m-1", title: "M1", description: "First",
      orderIndex: 0, status: "planned", validationContractId: "",
    }),
    createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1", description: "Unit" }),
    createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([]),
    getContractHistory: vi.fn().mockResolvedValue([
      { id: "c-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } },
    ]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny" },
    ]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    createCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "pending" }),
    getCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    resolveCheckpoint: vi.fn().mockResolvedValue({ id: "cp-1", status: "resolved", decision: "approve" }),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    listMissions: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
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

const emittedEvents: any[] = [];
const mockEventBus = {
  emit: vi.fn((event: any) => emittedEvents.push(event)),
  subscribe: vi.fn().mockReturnValue(() => {}),
  getEventsSince: vi.fn().mockReturnValue([]),
  getCurrentSeq: vi.fn().mockReturnValue(0),
};

describe("MissionRunnerPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emittedEvents.length = 0;
  });

  it("starts missions up to max concurrent", async () => {
    const lapis = createMockLapis();
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 2,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    const active = pool.getActiveMissions();
    expect(active.length).toBe(2);
    expect(active.every((m) => m.state !== "queued")).toBe(true);
  });

  it("queues overflow missions", () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    const active = pool.getActiveMissions();
    expect(active.length).toBe(2);
    const queued = active.find((m) => m.state === "queued");
    expect(queued).toBeDefined();
    expect(queued!.missionId).toBe("m-2");
    expect(queued!.queuePosition).toBe(1);
  });

  it("starts queued mission when slot frees on completion", async () => {
    const lapis = createMockLapis();
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    expect(pool.getStatus("m-2")?.state).toBe("queued");

    await pool.waitForCompletion("m-1");

    const status2 = pool.getStatus("m-2");
    expect(status2?.state).not.toBe("queued");
  });

  it("starts queued mission when slot frees on failure", async () => {
    const lapis = createMockLapis();
    (lapis.getMission as any).mockRejectedValue(new Error("fail"));

    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    await pool.waitForCompletion("m-1");

    const status2 = pool.getStatus("m-2");
    expect(status2?.state).not.toBe("queued");
  });

  it("abort removes mission from queue", () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    expect(pool.getStatus("m-2")?.state).toBe("queued");

    pool.abort("m-2");

    expect(pool.getStatus("m-2")).toBeNull();
  });;

  it("getStatus returns null for unknown mission", () => {
    const lapis = createMockLapis();
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 2,
    });

    expect(pool.getStatus("unknown")).toBeNull();
  });

  it("getActiveMissions returns running and queued with positions", () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockImplementation(() => new Promise(() => {}));

    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");
    pool.submit("m-3");

    const active = pool.getActiveMissions();
    expect(active.length).toBe(3);

    const running = active.filter((m) => m.state !== "queued");
    const queued = active.filter((m) => m.state === "queued");
    expect(running.length).toBe(1);
    expect(queued.length).toBe(2);
    expect(queued[0].queuePosition).toBe(1);
    expect(queued[1].queuePosition).toBe(2);
  });

  it("emits mission_queued, mission_started, and mission_completed events", async () => {
    const lapis = createMockLapis();
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 1,
    });

    pool.submit("m-1");
    pool.submit("m-2");

    const startedEvents = emittedEvents.filter((e) => e.type === "mission_started");
    expect(startedEvents.length).toBeGreaterThanOrEqual(1);
    expect(startedEvents[0].missionId).toBe("m-1");

    const queuedEvents = emittedEvents.filter((e) => e.type === "mission_queued");
    expect(queuedEvents.length).toBe(1);
    expect(queuedEvents[0].missionId).toBe("m-2");

    await pool.waitForCompletion("m-1");
    await pool.waitForCompletion("m-2");

    const completedEvents = emittedEvents.filter((e) => e.type === "mission_completed");
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("submit ignores duplicate missions", () => {
    const lapis = createMockLapis();
    const pool = createMissionRunnerPool({
      lapis,
      pinyx: createMockPinyx(),
      eventBus: mockEventBus as any,
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
      maxConcurrent: 3,
    });

    pool.submit("m-1");
    pool.submit("m-1");

    const active = pool.getActiveMissions();
    const m1Count = active.filter((m) => m.missionId === "m-1").length;
    expect(m1Count).toBe(1);
  });
});
