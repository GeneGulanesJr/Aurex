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

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }) }));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import { makeHandoff } from "./helpers/make-handoff.js";

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


function createMockLapis(units: WorkingUnit[] = [], verdicts: ValidationVerdict[] = [], handoffs = units.map((unit) => makeHandoff(unit.id))): LaPisClient {
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
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "s1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getFindings: vi.fn().mockResolvedValue([]),
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
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "mock-session", verdict: "pass", findings: "OK", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "mock-session", verdict: "pass", findings: "OK", failedUnitIds: [], timestamp: "" },
    ];
    const lapis = createMockLapis([completedUnit], passVerdicts);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
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
    (lapis.getRetryCounter as any).mockResolvedValue({ milestoneId: "ms-1", retries: 2, rescopes: 5 });
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);
    expect(result.status).toBe("checkpoint_needed");
  });

  it("returns a runtime checkpoint when scrutiny times out while user testing writes a verdict", async () => {
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const userTestingVerdict: ValidationVerdict = {
      id: "v-2",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_user_testing",
      sessionId: "mock-session",
      verdict: "pass",
      findings: "OK",
      failedUnitIds: [],
      timestamp: "",
    };
    const lapis = createMockLapis([completedUnit], [userTestingVerdict]);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    let subscribeCount = 0;
    mockSession.subscribe.mockImplementation((fn: any) => {
      subscribeCount++;
      if (subscribeCount === 2) {
        return () => {};
      }
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const mission = makeMission({
      configJson: {
        ...makeMission().configJson,
        workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 5 },
      },
    });
    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(mission, [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      expect(result.summary).toContain("validator_scrutiny timed out before submitting write_verdict");
    }
    expect(lapis.writeVerdict).toHaveBeenCalledWith(
      "mock-session",
      expect.objectContaining({
        validatorType: "validator_scrutiny",
        verdict: "fail",
        findings: expect.stringContaining("timed out before calling write_verdict"),
      }),
    );
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "m-1",
      expect.objectContaining({ kind: "unclassifiable_error", milestoneId: "ms-1" }),
      expect.objectContaining({ summary: expect.stringContaining("validator_scrutiny timed out") }),
    );
  });

  it("does not spawn validators while working units are incomplete", async () => {
    const staleUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "working", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const lapis = createMockLapis([staleUnit], []);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      expect(result.summary).toContain("not completed");
    }
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "planned");
    const registrations = (lapis.registerAgentSession as any).mock.calls.map((call: any[]) => call[0]);
    expect(registrations).not.toContain("validator_scrutiny");
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "validation_blocked_incomplete_units",
      expect.stringContaining("not completed"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
  });

  it("returns a runtime checkpoint when scrutiny completes without writing a verdict (death-spiral guard)", async () => {
    // The classic death-spiral scenario: the validator session completes
    // successfully (no timeout, no error) but the model never called
    // write_verdict. Without the per-validator-type synthetic verdict
    // path, this would route through the negotiator and surface as
    // "Missing scrutiny validator verdict" — which triggers an auto-
    // rescope, new workers, same model behavior, and the cycle repeats.
    // With the fix, the loop writes a synthetic fail verdict for the
    // missing type and returns unclassifiable_error so the human can
    // re-plan with explicit guidance.
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const lapis = createMockLapis([completedUnit], []);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    // Default subscribe behavior: agent_end fires once per spawn.
    // Worker + validator both complete cleanly, but neither calls
    // write_verdict (the validator's write_verdict tool is never
    // exercised by the mock).
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      // The summary must clearly indicate this is a compliance failure,
      // not evidence the milestone scope is wrong.
      expect(result.summary).toContain("completed without submitting write_verdict");
    }
    // A synthetic fail verdict must have been written for the missing
    // validator type so the audit trail records what happened.
    expect(lapis.writeVerdict).toHaveBeenCalledWith(
      "mock-session",
      expect.objectContaining({
        validatorType: "validator_scrutiny",
        verdict: "fail",
        findings: expect.stringContaining("did not submit a formal verdict"),
      }),
    );
    // The escalator must be called with a runtime-failure context so
    // downstream consumers (UI, mission_log) can distinguish from a
    // plain validation_failed trigger.
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "validator_runtime_failure",
      expect.stringContaining("validator_scrutiny"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "m-1",
      expect.objectContaining({ kind: "unclassifiable_error", milestoneId: "ms-1" }),
      expect.objectContaining({ summary: expect.stringContaining("compliance failure") }),
    );
  });

  it("does not let a stale scrutiny verdict mask the current validator missing write_verdict", async () => {
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const staleScrutinyVerdict: ValidationVerdict = {
      id: "v-old",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "",
      verdict: "pass",
      findings: "Prior retry passed",
      failedUnitIds: [],
      timestamp: "2026-01-01T00:00:00Z",
    };
    const lapis = createMockLapis([completedUnit], [staleScrutinyVerdict]);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone({ description: "Implement auth. Acceptance: none" })]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      expect(result.summary).toContain("completed without submitting write_verdict");
    }
    expect(lapis.writeVerdict).toHaveBeenCalledWith(
      "mock-session",
      expect.objectContaining({
        validatorType: "validator_scrutiny",
        verdict: "fail",
        findings: expect.stringContaining("did not submit a formal verdict"),
      }),
    );
  });

  it("does not let a user-testing verdict mask a missing scrutiny verdict", async () => {
    // Reverse-direction death-spiral guard: the user-testing validator
    // writes a real verdict but the scrutiny validator doesn't. The
    // negotiator must NOT see this as "all verdicts present and user
    // testing passed" and approve the milestone. The per-validator-type
    // synthetic-verdict path must run for the missing type.
    const completedUnit: WorkingUnit = {
      id: "unit-1", milestoneId: "ms-1", description: "Do thing",
      declaredPaths: ["src/auth.ts"], declaredModules: ["auth"],
      status: "completed", taskBranch: "task/w-1/unit-1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const milestone = makeMilestone({
      description: "Implement auth. Acceptance: login button must be clickable.",
    });
    const userTestingVerdict: ValidationVerdict = {
      id: "v-ut",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_user_testing",
      sessionId: "mock-session",
      verdict: "pass",
      findings: "Login button works",
      failedUnitIds: [],
      timestamp: "",
    };
    const lapis = createMockLapis([completedUnit], [userTestingVerdict]);
    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
      onError: vi.fn(),
    };

    let subscribeCount = 0;
    mockSession.subscribe.mockImplementation((fn: any) => {
      subscribeCount++;
      // First two subscribes: worker (succeeds) + user_testing (succeeds).
      // The third subscribe: validator_scrutiny completes without verdict.
      if (subscribeCount <= 2) {
        setTimeout(() => fn({ type: "agent_end" }), 0);
      } else {
        setTimeout(() => fn({ type: "agent_end" }), 0);
      }
      return () => {};
    });

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot: "/test/repo",
      gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [milestone]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
    }
    // The synthetic verdict must be for validator_scrutiny specifically,
    // not for validator_user_testing (which already has a real verdict).
    const syntheticCalls = (lapis.writeVerdict as any).mock.calls.filter(
      (call: any[]) => (call[1] as any).validatorType === "validator_scrutiny",
    );
    expect(syntheticCalls).toHaveLength(1);
  });
});
