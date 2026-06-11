import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit, ValidationVerdict } from "@aurex/shared";

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

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

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

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecAsync }));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import { makeHandoff } from "./helpers/make-handoff.js";

function makeMission(): Mission {
  return {
    id: "m-1", description: "Build app", status: "running",
    configJson: {
      modelHints: { orchestrator: "kilo/kilo-auto/free", worker: "kilo/kilo-auto/free", validator_scrutiny: "kilo/kilo-auto/free", validator_user_testing: "kilo/kilo-auto/free", research: "kilo/kilo-auto/free" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };
}

function makeMilestone(): Milestone {
  return {
    id: "ms-1", missionId: "m-1", title: "Phase 1", description: "Build", orderIndex: 0,
    status: "planned", validationContractId: "c-1",
  };
}

function makeUnit(id: string, paths: string[], modules: string[]): WorkingUnit {
  return {
    id, milestoneId: "ms-1", description: `Unit ${id}`,
    declaredPaths: paths, declaredModules: modules,
    status: "planned", taskBranch: "", worktreePath: "", sessionId: "",
  };
}

const passVerdict: ValidationVerdict = {
  verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s1",
  milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "",
};

const failVerdict: (failedIds: string[]) => ValidationVerdict = (failedIds) => ({
  verdict: "fail", validatorType: "validator_scrutiny", sessionId: "s1",
  milestoneId: "ms-1", contractId: "c-1", findings: "broke", failedUnitIds: failedIds,
  classification: "patchable", timestamp: "",
});


function createMockLapis(units: WorkingUnit[], verdicts: ValidationVerdict[], handoffs = units.map((unit) => makeHandoff(unit.id))): LaPisClient {
  let callCount = 0;
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockImplementation(async (msId: string) => {
      // First call returns planned units; subsequent calls return units reset to "planned"
      // (simulating retry resetting status)
      return units.map(u => ({ ...u, status: "planned" }));
    }),
    getContractHistory: vi.fn().mockResolvedValue([{
      id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "" },
    }]),
    getVerdicts: vi.fn().mockImplementation(async (msId: string) => {
      callCount++;
      // First negotiation: fail. Second negotiation (after retry): pass.
      if (callCount <= 1) return verdicts;
      return [passVerdict];
    }),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "s1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    createWorkingUnit: vi.fn().mockImplementation(async (_msId: string, unit: any) => ({
      id: `new-${Date.now()}`, ...unit, milestoneId: _msId, status: "planned", taskBranch: "", worktreePath: "", sessionId: "",
    })),
    getFindings: vi.fn().mockResolvedValue([]),
    logRescope: vi.fn().mockResolvedValue(undefined),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

describe("milestone loop — retry/rescope handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("retries failed units when negotiator returns 'retry'", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const verdicts = [failVerdict(["u-1"])];
    // incrementRetry: first call returns retries=0 (< maxRetries=2 → retry), second call returns retries=1
    const lapis = createMockLapis(units, verdicts);
    (lapis.incrementRetry as any).mockResolvedValueOnce({ milestoneId: "ms-1", retries: 0, rescopes: 0 });
    (lapis.incrementRetry as any).mockResolvedValueOnce({ milestoneId: "ms-1", retries: 1, rescopes: 0 });

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    // Should complete after retry
    expect(result.status).toBe("checkpoint_needed");

    // Worker should have been spawned more than once (initial + retry)
    const workerCalls = (lapis.registerAgentSession as any).mock.calls
      .filter((c: any[]) => c[0] === "worker");
    expect(workerCalls.length).toBeGreaterThanOrEqual(2);

    // incrementRetry should have been called at least twice (once for each negotiation round)
    expect((lapis.incrementRetry as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps successful unit branch metadata across validator retry cycles", async () => {
    const passUnit = makeUnit("u-pass", ["src/pass.ts"], ["pass"]);
    const failUnit = makeUnit("u-fail", ["src/fail.ts"], ["fail"]);
    const firstFail = failVerdict(["u-fail"]);
    const lapis = createMockLapis([passUnit, failUnit], [firstFail]);

    let unitFetchCount = 0;
    (lapis.getWorkingUnitsForMilestone as any).mockImplementation(async () => {
      unitFetchCount++;
      if (unitFetchCount === 1) {
        return [passUnit, failUnit];
      }
      return [
        { ...passUnit, status: "completed", taskBranch: "", worktreePath: "", sessionId: "" },
        { ...failUnit, status: "planned", taskBranch: "", worktreePath: "", sessionId: "" },
      ];
    });
    (lapis.getVerdicts as any)
      .mockResolvedValueOnce([firstFail])
      .mockResolvedValueOnce([passVerdict]);
    (lapis.incrementRetry as any)
      .mockResolvedValueOnce({ milestoneId: "ms-1", retries: 0, rescopes: 0 })
      .mockResolvedValueOnce({ milestoneId: "ms-1", retries: 1, rescopes: 0 });

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    const calls = mockExecAsync.mock.calls.map((c: any) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    const passBranchMerges = calls.filter((c: string) => c.includes("merge --no-ff --no-commit task/worker-u-pass/u-pass"));
    const failBranchMerges = calls.filter((c: string) => c.includes("merge --no-ff --no-commit task/worker-u-fail/u-fail"));
    expect(passBranchMerges.length).toBeGreaterThanOrEqual(2);
    expect(failBranchMerges.length).toBeGreaterThanOrEqual(2);
  });

  it("escalates to user instead of auto-rescoping when AUTO_RESCOPE_BATCH_LIMIT=0", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const verdicts = [failVerdict(["u-1"])];
    const lapis = createMockLapis(units, verdicts);

    // Retries exhausted, rescopeCount < effectiveMaxRescopes(0) is FALSE → escalate
    (lapis.incrementRetry as any)
      .mockResolvedValueOnce({ milestoneId: "ms-1", retries: 2, rescopes: 0 });

    (lapis.getVerdicts as any).mockResolvedValueOnce(verdicts);

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    // Should escalate to user instead of auto-rescoping
    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("validation_failed");
    }

    // PiNyx should NOT have been called — no auto-rescope
    expect((pinyx.chat as any).mock.calls.length).toBe(0);
  });

  it("asks for human direction after two automatic rescopes even when configured higher", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"] )];
    const verdicts = [failVerdict(["u-1"] )];
    const lapis = createMockLapis(units, verdicts);
    (lapis.incrementRetry as any).mockResolvedValue({ milestoneId: "ms-1", retries: 2, rescopes: 2 });

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("validation_failed");
      expect(result.summary).toContain("Auto-rescope is disabled");
    }
    expect(pinyx.chat).not.toHaveBeenCalled();
  });

  it("escalates when all retries and rescopes exhausted", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const verdicts = [failVerdict(["u-1"])];
    const lapis = createMockLapis(units, verdicts);

    // All limits exhausted
    (lapis.incrementRetry as any).mockResolvedValue({ milestoneId: "ms-1", retries: 5, rescopes: 5 });

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("validation_failed");
    }
  });
});
