import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit, ValidationVerdict } from "@aurex/shared";

// Shared mock session + spawner factory. These tests exercise the two
// interrupt paths that previously could corrupt the shared feature branch or
// orphan an agent session:
//   1. spawner.spawn() throwing for a WORKER (model-resolution / concurrency /
//      session-creation failure) — the loop must reset the branch and route
//      through retry/escalate rather than crash the milestone.
//   2. a VALIDATOR's handle.completed rejecting mid-pair — the sibling
//      validator must still be disposed (no orphan) and the milestone must
//      not be approved on the strength of the lone survivor.
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
    // defineTool must return the tool object (with its `.name`) so the spawner
    // can register custom tools and tests can identify agent type by tool name.
    defineTool: vi.fn().mockImplementation((def: any) => def),
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
      modelHints: { orchestrator: "o", worker: "w", validator_scrutiny: "v", validator_user_testing: "u", research: "r" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };
  if (!overrides) return base;
  return { ...base, ...overrides, configJson: { ...base.configJson, ...(overrides.configJson ?? {}) } };
}

function makeMilestone(): Milestone {
  return { id: "ms-1", missionId: "m-1", title: "Phase 1", description: "Build", orderIndex: 0, status: "planned", validationContractId: "c-1" };
}

function makeUnit(id: string): WorkingUnit {
  return { id, milestoneId: "ms-1", description: `Unit ${id}`, declaredPaths: ["src/auth/"], declaredModules: ["auth"], status: "planned", taskBranch: "", worktreePath: "", sessionId: "" };
}

const passVerdict: ValidationVerdict = {
  verdict: "pass", validatorType: "validator_scrutiny", sessionId: "mock-session",
  milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "",
};

function createMockLapis(units: WorkingUnit[], verdicts: ValidationVerdict[] = [passVerdict], handoffs = units.map((u) => makeHandoff(u.id))): LaPisClient {
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    getContractHistory: vi.fn().mockResolvedValue([{ id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "login button works" } }]),
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "mock-session", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => handoffs.find((h) => h.unitId === unitId) ?? null),
    getFindings: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return { chat: vi.fn().mockResolvedValue({ content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), ping: vi.fn() } as unknown as PinyxClient;
}

function makeCallbacks() {
  return { onEscalation: vi.fn(), onAgentStatus: vi.fn(), onMilestoneProgress: vi.fn(), onCostUpdate: vi.fn(), onError: vi.fn() };
}

describe("milestone loop — interrupt hardening (worker spawn failure & validator rejection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockSession.subscribe.mockImplementation((fn: any) => { setTimeout(() => fn({ type: "agent_end" }), 0); return () => {}; });
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.dispose.mockClear();
    mockSession.abort.mockClear();
  });

  it("resets the feature branch and escalates IMMEDIATELY (no retry) on a deterministic worker spawn failure", async () => {
    // A deterministic spawn error (bad model / provider config) will fail
    // identically on every retry, so the loop must NOT burn the per-unit retry
    // budget — it resets the branch and escalates on the FIRST attempt.
    const units = [makeUnit("u-1")];
    const lapis = createMockLapis(units);
    // Pre-populate findings so pre-worker research is SKIPPED.
    (lapis.getFindings as any).mockResolvedValue([
      { id: "f-1", missionId: "m-1", domain: ["auth"], title: "ctx", content: "skip research", relevance: "low", status: "active", createdAt: "" },
    ]);
    const callbacks = makeCallbacks();

    const preUnitSha = "preunit-sha-xyz";
    mockExecAsync.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "git" && args?.includes("rev-parse") && args?.includes("HEAD")) {
        return { stdout: `${preUnitSha}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockImplementation(async (opts: any) => {
      const hasWorkerTool = Array.isArray(opts.customTools)
        && opts.customTools.some((t: any) => t?.name === "write_handoff");
      if (hasWorkerTool) {
        throw new Error("model resolution failed: no such provider");
      }
      return { session: mockSession };
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // maxPerUnitRetries is 1, but a deterministic error must NOT retry.
    const result = await loop.run(makeMission({ configJson: { maxPerUnitRetries: 1 } as any }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("could not be spawned");
    expect(result.summary).toContain("not retried");
    // The branch was hard-reset to the pre-unit SHA on the spawn failure.
    const calls = mockExecAsync.mock.calls.map((c: any) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    expect(calls.some((c) => c.includes(`reset --hard ${preUnitSha}`))).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1", "worker_spawn_failed",
      expect.stringContaining("could not be spawned"),
      expect.objectContaining({ recoverable: true }),
    );
    // CRITICAL: exactly ONE worker spawn attempt happened (no retry despite
    // budget=1). Count via createAgentSession calls that carried the worker
    // tool — registerAgentSession is NOT reached when spawn throws.
    const workerSpawnAttempts = mockCreateAgentSession.mock.calls.filter(
      (c: any[]) => Array.isArray(c[0]?.customTools) && c[0].customTools.some((t: any) => t?.name === "write_handoff"),
    );
    expect(workerSpawnAttempts).toHaveLength(1);
    // The unit was marked blocked, NOT reset to "planned" for retry.
    expect(lapis.updateWorkingUnitStatus).not.toHaveBeenCalledWith("u-1", "planned");
  });

  it("retries a TRANSIENT worker spawn failure up to the budget, then escalates", async () => {
    // A transient spawn error (concurrency limit, which clears when another
    // agent finishes) is worth retrying. The loop must reset the branch, retry
    // within the budget, then escalate only after the budget is exhausted.
    const units = [makeUnit("u-1")];
    const lapis = createMockLapis(units);
    (lapis.getFindings as any).mockResolvedValue([
      { id: "f-1", missionId: "m-1", domain: ["auth"], title: "ctx", content: "skip research", relevance: "low", status: "active", createdAt: "" },
    ]);
    const callbacks = makeCallbacks();

    const preUnitSha = "preunit-sha-xyz";
    mockExecAsync.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "git" && args?.includes("rev-parse") && args?.includes("HEAD")) {
        return { stdout: `${preUnitSha}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockImplementation(async (opts: any) => {
      const hasWorkerTool = Array.isArray(opts.customTools)
        && opts.customTools.some((t: any) => t?.name === "write_handoff");
      if (hasWorkerTool) {
        // Transient: the spawner's concurrency-limit message. Retry-worthy.
        throw new Error("AgentSpawner concurrency limit reached (2). Active sessions: a, b");
      }
      return { session: mockSession };
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // maxPerUnitRetries: 1 → 1 initial + 1 retry = 2 attempts before escalate.
    const result = await loop.run(makeMission({ configJson: { maxPerUnitRetries: 1 } as any }), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    expect(result.summary).toContain("could not be spawned");
    expect(result.summary).toContain("after 2 attempt(s)");
    // TWO worker spawn attempts: the initial + one retry (transient = retried).
    // Count via createAgentSession calls carrying the worker tool.
    const workerSpawnAttempts = mockCreateAgentSession.mock.calls.filter(
      (c: any[]) => Array.isArray(c[0]?.customTools) && c[0].customTools.some((t: any) => t?.name === "write_handoff"),
    );
    expect(workerSpawnAttempts).toHaveLength(2);
    // The unit WAS reset to "planned" so the retry could pick it up.
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("u-1", "planned");
  });

  it("disposes the surviving validator handle (no orphan) and never approves the milestone when one validator rejects mid-pair", async () => {
    // Two validators run via Promise.allSettled. If one's spawn() throws (a
    // session-creation / model-resolution failure), the SIBLING that succeeded
    // must STILL be disposed — otherwise its session is orphaned (still
    // subscribed, never torn down). Previously a Promise.all rejection
    // abandoned the surviving handle because handle.dispose() ran only on the
    // success path, AFTER the await that never completed.
    //
    // To prove "no orphan" concretely (not just "no false approval"), each
    // spawn returns a DISTINCT mock session so we can assert per-session
    // dispose() calls: the rejecting spawn produces no handle (0 dispose), and
    // the succeeding spawn's handle MUST be disposed exactly once.
    const completedUnit: WorkingUnit = {
      ...makeUnit("u-1"), status: "completed",
      taskBranch: "feature/m-1/1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const lapis = createMockLapis([completedUnit], [passVerdict], []);
    const callbacks = makeCallbacks();

    let validatorSpawnSeen = false;
    const disposedSessions: string[] = [];
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockImplementation(async (opts: any) => {
      const hasVerdictTool = Array.isArray(opts.customTools)
        && opts.customTools.some((t: any) => t?.name === "write_verdict");
      if (hasVerdictTool) {
        if (!validatorSpawnSeen) {
          // First validator (scrutiny) — spawn() throws before a handle exists.
          validatorSpawnSeen = true;
          throw new Error("validator session crashed mid-review");
        }
        // Second validator (user_testing) — succeeds with a distinct session
        // whose dispose() records itself so we can prove it was torn down.
        const session = {
          prompt: vi.fn().mockResolvedValue(undefined),
          subscribe: (fn: any) => { setTimeout(() => fn({ type: "agent_end" }), 0); return () => {}; },
          abort: vi.fn(),
          dispose: () => { disposedSessions.push("user_testing"); },
          sessionId: "user-testing-session",
          isStreaming: false,
        };
        return { session };
      }
      return { session: mockSession };
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(), [makeMilestone()]);

    // The milestone must not have been approved (no milestone_complete).
    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).not.toBe("milestone_complete");
    }
    expect(callbacks.onEscalation).not.toHaveBeenCalledWith(
      "m-1",
      expect.objectContaining({ kind: "milestone_complete" }),
      expect.anything(),
    );
    // THE core assertion: the surviving (user_testing) validator's session was
    // disposed exactly once. Under the old Promise.all bug this would be 0
    // (orphaned) because the rejection short-circuited the sibling's finally.
    expect(disposedSessions).toEqual(["user_testing"]);
  });
});

describe("milestone loop — observability for recoverable failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockSession.subscribe.mockImplementation((fn: any) => { setTimeout(() => fn({ type: "agent_end" }), 0); return () => {}; });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("reports research_spawn_failed when pre-worker research cannot spawn", async () => {
    const units = [makeUnit("u-1")];
    const lapis = createMockLapis(units);
    const callbacks = makeCallbacks();

    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockImplementation(async (opts: any) => {
      const hasResearchTool = Array.isArray(opts.customTools)
        && opts.customTools.some((t: any) => t?.name === "write_finding");
      if (hasResearchTool) {
        throw new Error("concurrency limit reached");
      }
      return { session: mockSession };
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    await loop.run(makeMission(), [makeMilestone()]);

    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "research_spawn_failed",
      expect.stringContaining("could not be spawned"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
  });

  it("reports feature_diff_failed when git diff fails during validation", async () => {
    const completedUnit: WorkingUnit = {
      id: "u-1", milestoneId: "ms-1", description: "Unit u-1",
      declaredPaths: ["src/auth/"], declaredModules: ["auth"],
      status: "completed", taskBranch: "feature/m-1/1", worktreePath: "/wt", sessionId: "sess-1",
    };
    const lapis = createMockLapis([completedUnit]);
    (lapis.getFindings as any).mockResolvedValue([
      { id: "f-1", missionId: "m-1", domain: ["auth"], title: "ctx", content: "skip research", relevance: "low", status: "active", createdAt: "" },
    ]);
    const callbacks = makeCallbacks();

    mockExecAsync.mockImplementation(async (_cmd: string, args?: string[]) => {
      if (args?.includes("diff")) {
        throw new Error("fatal: bad revision");
      }
      return { stdout: "", stderr: "" };
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    await loop.run(makeMission(), [makeMilestone()]);

    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "feature_diff_failed",
      expect.stringContaining("Could not collect feature diff"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
  });

  it("reports research_findings_fetch_failed when LaPis findings cannot load", async () => {
    const units = [makeUnit("u-1")];
    const lapis = createMockLapis(units);
    (lapis.getFindings as any).mockRejectedValue(new Error("db unavailable"));
    const callbacks = makeCallbacks();

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    await loop.run(makeMission(), [makeMilestone()]);

    expect(callbacks.onError).toHaveBeenCalledWith(
      "m-1",
      "research_findings_fetch_failed",
      expect.stringContaining("Could not load research findings"),
      expect.objectContaining({ milestoneId: "ms-1", recoverable: true }),
    );
  });
});
