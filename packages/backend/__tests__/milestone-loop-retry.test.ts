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

function makeMission(overrides?: Partial<Mission>): Mission {
  const base: Mission = {
    id: "m-1", description: "Build app", status: "running",
    configJson: {
      modelHints: { orchestrator: "kilo/kilo-auto/free", worker: "kilo/kilo-auto/free", validator_scrutiny: "kilo/kilo-auto/free", validator_user_testing: "kilo/kilo-auto/free", research: "kilo/kilo-auto/free" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    configJson: { ...base.configJson, ...(overrides.configJson ?? {}) },
  };
}

function makeMilestone(): Milestone {
  return { id: "ms-1", missionId: "m-1", title: "Phase 1", description: "Build", orderIndex: 0, status: "planned", validationContractId: "c-1" };
}

function makeUnit(id: string, paths: string[], modules: string[]): WorkingUnit {
  return { id, milestoneId: "ms-1", description: `Unit ${id}`, declaredPaths: paths, declaredModules: modules, status: "planned", taskBranch: "", worktreePath: "", sessionId: "" };
}

const passVerdict: ValidationVerdict = {
  verdict: "pass", validatorType: "validator_scrutiny", sessionId: "mock-session",
  milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "",
};

const failVerdict: (failedIds: string[]) => ValidationVerdict = (failedIds) => ({
  verdict: "fail", validatorType: "validator_scrutiny", sessionId: "mock-session",
  milestoneId: "ms-1", contractId: "c-1", findings: "broke", failedUnitIds: failedIds,
  classification: "patchable", timestamp: "",
});

function createMockLapis(units: WorkingUnit[], verdicts: ValidationVerdict[], handoffs = units.map((unit) => makeHandoff(unit.id))): LaPisClient {
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units.map((u) => ({ ...u, status: "planned" }))),
    getContractHistory: vi.fn().mockResolvedValue([{ id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "" } }]),
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "mock-session", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => handoffs.find((h) => h.unitId === unitId) ?? null),
    createWorkingUnit: vi.fn().mockImplementation(async (_msId: string, unit: any) => ({ id: `new-${Date.now()}`, ...unit, milestoneId: _msId, status: "planned", taskBranch: "", worktreePath: "", sessionId: "" })),
    getFindings: vi.fn().mockResolvedValue([]),
    logRescope: vi.fn().mockResolvedValue(undefined),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return { chat: vi.fn().mockResolvedValue({ content: '{"units":[{"description":"retry unit","declaredPaths":["src/auth/"],"declaredModules":["auth"]}]}', finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), ping: vi.fn() } as unknown as PinyxClient;
}

function makeCallbacks() {
  return { onEscalation: vi.fn(), onAgentStatus: vi.fn(), onMilestoneProgress: vi.fn(), onCostUpdate: vi.fn(), onError: vi.fn() };
}

describe("milestone loop — sequential retry/rescope handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockSession.subscribe.mockImplementation((fn: any) => { setTimeout(() => fn({ type: "agent_end" }), 0); return () => {}; });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("retries a unit that completes without a handoff up to the per-unit budget, then escalates", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const lapis = createMockLapis(units, [passVerdict], []);
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission({ configJson: { maxPerUnitRetries: 1 } as any }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("valid handoff");
    const workerSpawns = (lapis.registerAgentSession as any).mock.calls.filter((c: any[]) => c[0] === "worker");
    expect(workerSpawns.length).toBe(2);
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("u-1", "planned");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1", "worker_handoff_invalid",
      expect.stringContaining("valid handoff"),
      expect.objectContaining({ recoverable: true }),
    );
  });

  it("retries and escalates when the smoke check keeps failing", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const lapis = createMockLapis(units, [passVerdict]);
    const callbacks = makeCallbacks();

    // Make bash commands fail (smoke check) while letting git pass.
    mockExecAsync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "bash") return Promise.reject(Object.assign(new Error("typecheck errors"), { stderr: "typecheck failed" }));
      return Promise.resolve({ stdout: "", stderr: "" });
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission({ configJson: { maxPerUnitRetries: 1 } as any }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("Smoke check failed");
    const workerSpawns = (lapis.registerAgentSession as any).mock.calls.filter((c: any[]) => c[0] === "worker");
    expect(workerSpawns.length).toBe(2);
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1", "smoke_check_failed",
      expect.stringContaining("Smoke check failed"),
      expect.objectContaining({ recoverable: true }),
    );
  });

  it("escalates to the user (validation_failed) instead of auto-rescoping when auto-rescope is disabled", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const verdicts = [failVerdict(["u-1"])];
    const lapis = createMockLapis(units, verdicts);
    const pinyx = createMockPinyx();
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("validation_failed");
      expect(result.summary).toContain("Auto-rescope is disabled");
    }
    expect((pinyx.chat as any).mock.calls.length).toBe(0);
  });

  it("auto-rescopes (planner re-plan) when a budget remains, then escalates after it is exhausted", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const verdicts = [failVerdict(["u-1"])];
    const lapis = createMockLapis(units, verdicts);
    let rescopeCount = 0;
    (lapis.logRescope as any).mockImplementation(async () => { rescopeCount += 1; });
    (lapis.getRetryCounter as any).mockImplementation(async () => ({ milestoneId: "ms-1", retries: 0, rescopes: rescopeCount }));
    const pinyx = createMockPinyx();
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission({
      configJson: { maxRescopes: 2, maxAutoRescopes: 1 } as any,
    }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("validation_failed");
    }
    expect((pinyx.chat as any).mock.calls.length).toBe(1);
    expect((lapis.logRescope as any).mock.calls.length).toBe(1);
  });

  it("escalates when getWorkingUnitsForMilestone fails", async () => {
    const lapis = createMockLapis([makeUnit("u-1", ["src/auth/"], ["auth"])], [failVerdict(["u-1"])]);
    (lapis.getWorkingUnitsForMilestone as any).mockRejectedValue(new Error("LaPis timeout"));
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      expect(result.summary).toContain("Failed to load working units");
    }
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1", "lapis_units_fetch_failed",
      expect.stringContaining("Failed to load working units"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
  });

  it("completes the milestone (release + checkpoint) when the end-of-milestone validator passes", async () => {
    const units = [makeUnit("u-1", ["src/auth/"], ["auth"])];
    const lapis = createMockLapis(units, [passVerdict]);
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("milestone_complete");
      expect(result.summary).toContain("Release branch");
    }
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("u-1", "completed");
  });
});
