import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit, MissionConfig, ValidationVerdict } from "@aurex/shared";

const { mockSession, mockCreateAgentSession } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "mock-session",
    isStreaming: false,
  };
  return { mockSession: session, mockCreateAgentSession: vi.fn().mockResolvedValue({ session }) };
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

vi.mock("node:child_process", () => ({ exec: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";

function makeMission(overrides?: Partial<Mission>): Mission {
  return {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
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
    validationContractId: "c-1",
    ...overrides,
  };
}

function createMockLapis(units: WorkingUnit[] = [], verdicts: ValidationVerdict[] = []): LaPisClient {
  return {
    getMission: vi.fn().mockResolvedValue(makeMission()),
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    createWorkingUnit: vi.fn().mockResolvedValue(units[0]),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    getContractHistory: vi.fn().mockResolvedValue([{ id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" } }]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

describe("milestone loop — validator phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate immediate agent_end for every spawned session
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("spawns validator pair after workers complete and both pass", async () => {
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const passVerdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "vs-1", verdict: "pass", findings: "OK", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "vu-1", verdict: "pass", findings: "OK", failedUnitIds: [], timestamp: "" },
    ];
    const lapis = createMockLapis([completedUnit], passVerdicts);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    // The negotiator should see pass verdicts and decide pass
    expect(result.status).toBe("checkpoint_needed");
    // Two validator sessions should have been registered (scrutiny + user_testing)
    const registrations = (lapis.registerAgentSession as any).mock.calls.map((c: any) => c[0]);
    expect(registrations.filter((t: string) => t === "validator_scrutiny" || t === "validator_user_testing").length).toBeGreaterThanOrEqual(2);
  });

  it("returns checkpoint_needed when validator fails and rescope limit hit", async () => {
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const failVerdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "vs-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const lapis = createMockLapis([completedUnit], failVerdicts);
    // Simulate exhausted retries and rescopes
    (lapis.incrementRetry as any).mockResolvedValue({ milestoneId: "ms-1", retries: 2, rescopes: 5 });
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);
    expect(result.status).toBe("checkpoint_needed");
  });
});
