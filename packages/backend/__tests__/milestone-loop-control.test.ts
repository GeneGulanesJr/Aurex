import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit, ValidationVerdict } from "@aurex/shared";

// Loop control-flow tests:
//   1. Abort signal propagation — aborting the mission mid-worker must call
//      abort() on every active agent handle (so the session tears down) and
//      short-circuit the loop with a throw, never reaching validation.
//   2. Pre-unit cost cap — with multiple units, a cost that crosses the cap
//      DURING an earlier unit must trip the PRE-unit check before the next
//      unit spawns (previously only the post-unit branch was covered).
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
    // NOTE: defineTool returns undefined (not the def) so the spawner's
    // workerHandoffRequired flag stays false — worker sessions complete on
    // agent_end without requiring an explicit write_handoff tool call. This
    // matches the existing costcap/retry test fixtures and lets a unit reach
    // the post-unit cost check cleanly.
    defineTool: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecAsync }));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import { makeHandoff } from "./helpers/make-handoff.js";

function makeMission(costCap = 50): Mission {
  return {
    id: "m-1", description: "Build app", status: "running",
    configJson: {
      modelHints: { orchestrator: "o", worker: "w", validator_scrutiny: "v", validator_user_testing: "u", research: "r" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap, maxValidatorRetries: 2, maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };
}

function makeMilestone(): Milestone {
  return { id: "ms-1", missionId: "m-1", title: "Phase 1", description: "Build", orderIndex: 0, status: "planned", validationContractId: "c-1" };
}

function makeUnit(id: string): WorkingUnit {
  return { id, milestoneId: "ms-1", description: `Unit ${id}`, declaredPaths: ["src/auth/"], declaredModules: ["auth"], status: "planned", taskBranch: "", worktreePath: "", sessionId: "" };
}

const passVerdicts: ValidationVerdict[] = [
  { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "mock-session", milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "" },
];

function createMockLapis(units: WorkingUnit[], verdicts: ValidationVerdict[] = passVerdicts, handoffs = units.map((u) => makeHandoff(u.id))): LaPisClient {
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units.map((u) => ({ ...u, status: "planned" }))),
    getContractHistory: vi.fn().mockResolvedValue([{ id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "" } }]),
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    getSessionsForMilestone: vi.fn().mockResolvedValue([{ sessionId: "mock-session", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null }]),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    writeVerdict: vi.fn().mockResolvedValue({}),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => handoffs.find((h) => h.unitId === unitId) ?? null),
    getFindings: vi.fn().mockResolvedValue([
      { id: "f-1", missionId: "m-1", domain: ["auth"], title: "ctx", content: "skip research", relevance: "low", status: "active", createdAt: "" },
    ]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return { chat: vi.fn().mockResolvedValue({ content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), ping: vi.fn() } as unknown as PinyxClient;
}

function makeCallbacks() {
  return { onEscalation: vi.fn(), onAgentStatus: vi.fn(), onMilestoneProgress: vi.fn(), onCostUpdate: vi.fn(), onError: vi.fn() };
}

describe("milestone loop — abort & pre-unit cost cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockSession.subscribe.mockImplementation((fn: any) => { setTimeout(() => fn({ type: "agent_end" }), 0); return () => {}; });
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.abort.mockClear();
  });

  it("aborts every active agent handle when the mission signal fires mid-worker", async () => {
    const units = [makeUnit("u-1")];
    const lapis = createMockLapis(units);
    const callbacks = makeCallbacks();

    const controller = new AbortController();

    // Hold the worker session open: when it subscribes, abort the mission.
    // The loop's abortListener must call handle.abort() on the live handle,
    // which forwards to session.abort().
    mockSession.subscribe.mockImplementation((fn: any) => {
      // Fire the abort on the next tick, after the handle is registered.
      setTimeout(() => controller.abort(), 0);
      return () => {};
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // The aborted loop rethrows "Mission aborted" out of loop.run.
    await expect(loop.run(makeMission(), [makeMilestone()], controller.signal)).rejects.toThrow("Mission aborted");

    // The live worker handle had abort() called (forwarded to session.abort),
    // so the session was torn down rather than left running.
    expect(mockSession.abort).toHaveBeenCalled();
    // And the loop never reached validation / completion.
    expect(callbacks.onEscalation).not.toHaveBeenCalledWith(
      "m-1",
      expect.objectContaining({ kind: "milestone_complete" }),
      expect.anything(),
    );
  });

  it("trips the pre-unit cost cap check so the next unit never spawns", async () => {
    // Two units. Unit 1 completes and reports a cost that pushes cumulative
    // cost OVER the cap. Unit 2 must then hit the PRE-unit cap check (which
    // runs before spawning) and return cost_cap_exceeded — WITHOUT unit 2's
    // worker ever spawning. Previously only the post-unit branch was covered.
    const units = [makeUnit("u-1"), makeUnit("u-2")];
    const lapis = createMockLapis(units);
    const callbacks = makeCallbacks();

    // On the FIRST worker's session, emit a usage event that crosses the cap
    // ($60 > $50). The second worker must not fire this (it should never run).
    let workerSubscriptions = 0;
    mockSession.subscribe.mockImplementation((fn: any) => {
      workerSubscriptions += 1;
      if (workerSubscriptions === 1) {
        // Unit 1's worker: report cost over cap, then complete.
        fn({
          type: "message_update",
          assistantMessageEvent: {
            type: "message_stop",
            usage: { promptTokens: 30000, completionTokens: 30000, totalTokens: 60000, cost: 60 },
          },
        });
        setTimeout(() => fn({ type: "agent_end" }), 0);
      } else {
        // Any later worker (unit 2) should never reach subscribe because the
        // pre-unit cap check must return before it spawns.
        setTimeout(() => fn({ type: "agent_end" }), 0);
      }
      return () => {};
    });

    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    const result = await loop.run(makeMission(50), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("cost_cap_exceeded");
    }
    // Only ONE worker spawned (unit 1). Unit 2 never spawned because the
    // pre-unit cost cap short-circuited the loop before its worker ran.
    // registerAgentSession(agentType, sessionId, missionId, milestoneId, unitId)
    const workerSpawns = (lapis.registerAgentSession as any).mock.calls.filter((c: any[]) => c[0] === "worker");
    expect(workerSpawns).toHaveLength(1);
    expect(workerSpawns[0][4]).toBe("u-1");
    // Unit 2 was never marked completed.
    expect(lapis.updateWorkingUnitStatus).not.toHaveBeenCalledWith("u-2", "completed");
  });
});
