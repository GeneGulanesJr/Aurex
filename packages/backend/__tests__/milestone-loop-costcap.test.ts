import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";

const { mockSession, mockCreateAgentSession, capturedOnCost } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "cost-cap-session",
    isStreaming: false,
  };
  let onCostFn: ((mId: string, cost: number, tokens: number, delta: number) => void) | null = null;
  return {
    mockSession: session,
    mockCreateAgentSession: vi.fn().mockImplementation(async (opts: any) => {
      // Capture the onCost callback from the spawner config
      // The spawner is created inside createMilestoneLoop, so we capture it
      // through the session subscribe mechanism
      return { session };
    }),
    capturedOnCost: { fn: null as any },
  };
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

function makeMission(costCap: number): Mission {
  return {
    id: "m-1", description: "Build app", status: "running",
    configJson: {
      modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap, maxValidatorRetries: 2, maxRescopes: 5,
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
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s1", milestoneId: "ms-1", contractId: "c-1", findings: "", failedUnitIds: [], timestamp: "" },
    ]),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
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

describe("milestone loop — cost cap enforcement", () => {
  let onCostCallback: ((mId: string, cost: number, tokens: number, delta: number) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    onCostCallback = null;
    mockSession.subscribe.mockImplementation((fn: any) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });
    mockSession.prompt.mockResolvedValue(undefined);
  });

  it("returns checkpoint_needed when cost exceeds cap", async () => {
    const units: WorkingUnit[] = [
      { id: "u-1", milestoneId: "ms-1", description: "Auth", declaredPaths: ["src/auth/"], declaredModules: ["auth"], status: "planned", taskBranch: "", worktreePath: "", sessionId: "" },
    ];
    const lapis = createMockLapis(units);
    const pinyx = createMockPinyx();

    // Capture the onCost callback
    let capturedOnCost: Function | null = null;
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn().mockImplementation((_mId: string, _cost: number, _tokens: number, _delta: number) => {
        // This fires during spawning — but we need to simulate cost exceeding cap
      }),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // The spawner emits cost via onCost callback which calls onCostUpdate.
    // But the milestone loop's onCost callback is synchronous — it just forwards.
    // We need the cost check to happen after the callback fires.
    // 
    // The cleanest way: mock the session to emit a usage event with high cost,
    // and have the spawner's onCost callback track cumulative cost.
    // Then the milestone loop checks cost after worker batch completes.

    // Simulate: worker session emits usage event showing cost > cap
    mockSession.subscribe.mockImplementation((fn: any) => {
      // Emit a usage event showing $60 cost (cap is $50)
      fn({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 30000, completionTokens: 30000, totalTokens: 60000, cost: 60 },
        },
      });
      // Then agent_end
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const result = await loop.run(makeMission(50), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("cost_cap_exceeded");
      expect(result.summary).toContain("cost");
    }
  });

  it("does not trigger when cost is under cap", async () => {
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
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main",
    });

    // Simulate usage event with cost well under cap ($10 < $50)
    mockSession.subscribe.mockImplementation((fn: any) => {
      fn({
        type: "message_update",
        assistantMessageEvent: {
          type: "message_stop",
          usage: { promptTokens: 5000, completionTokens: 5000, totalTokens: 10000, cost: 10 },
        },
      });
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const result = await loop.run(makeMission(50), [makeMilestone()]);

    // Should NOT be cost_cap_exceeded — should proceed to milestone_complete
    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("milestone_complete");
    }
  });
});
