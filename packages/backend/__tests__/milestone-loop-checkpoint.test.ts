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
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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


function createMockLapis(units: WorkingUnit[]): LaPisClient {
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    getContractHistory: vi.fn().mockResolvedValue([{
      id: "c-1", content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "" },
    }]),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "mock-session", milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "" },
    ]),
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
    getHandoffsForMilestone: vi.fn().mockResolvedValue(units.map((unit) => makeHandoff(unit.id))),
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

describe("milestone loop — milestone_complete checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("returns checkpoint_needed with milestone_complete trigger after validators pass", async () => {
    const units: WorkingUnit[] = [
      { id: "u-1", milestoneId: "ms-1", description: "Auth", declaredPaths: ["src/auth/"], declaredModules: ["auth"], status: "planned", taskBranch: "", worktreePath: "", sessionId: "" },
    ];
    const lapis = createMockLapis(units);
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
      expect(result.trigger).toBe("milestone_complete");
      expect(result.summary).toContain("ms-1");
    }

    // The escalation event should include release branch info
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "m-1",
      expect.objectContaining({ kind: "milestone_complete", milestoneId: "ms-1" }),
      expect.objectContaining({ releaseBranch: expect.any(String) }),
    );
  });
});
