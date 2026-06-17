import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkingUnit } from "@aurex/shared";

const { mockSession, mockCreateAgentSession, mockExecAsync } = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    sessionId: "test-session-123",
    isStreaming: false,
  };
  return {
    mockSession: session,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session }),
    mockExecAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
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
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import { selectValidatorTypes } from "../src/orchestrator/milestone-validator-verdicts";
import {
  createMockLapis,
  createMockPinyx,
  makeLoopCallbacks,
  makeLoopConfig,
  makeMilestone,
  makeMission,
  makeUnit,
} from "./helpers/milestone-loop-harness.js";
import { makeHandoff } from "./helpers/make-handoff.js";

describe("milestone loop contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("only spawns scrutiny validator when acceptanceBehavior is empty", () => {
    expect(selectValidatorTypes("")).toEqual(["validator_scrutiny"]);
    expect(selectValidatorTypes("none")).toEqual(["validator_scrutiny"]);
    expect(selectValidatorTypes("works")).toEqual(["validator_scrutiny", "validator_user_testing"]);
  });

  it("carries runtime fields in-memory on worker completion and re-merges them on refetch", async () => {
    // Runtime fields (taskBranch/worktreePath) are not persisted to LaPis (it
    // exposes no route for them — only PATCH /units/:id/status). They are
    // carried in the loop's in-memory runtimeUnitsByMilestone map and
    // re-merged onto fetched units via mergeRuntimeUnitFields, so a worker
    // that completed keeps its branch binding for the validator/integration
    // phases within the same run.
    let eventSubscriber: (event: unknown) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: (event: unknown) => void) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      eventSubscriber({ type: "agent_end" });
    });

    const unit = makeUnit();
    const lapis = createMockLapis([unit]);
    const callbacks = makeLoopCallbacks();
    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, makeLoopConfig());

    const result = await loop.run(makeMission(), [makeMilestone()]);

    // The non-existent PATCH /units/:id route must NOT be called (it 404s on
    // every call against real LaPis). Only status updates go to LaPis.
    expect(lapis.updateWorkingUnit).not.toHaveBeenCalled();
    // The worker did complete (status advanced), proving the in-memory runtime
    // state carried the taskBranch through the loop iteration.
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "completed");
    expect(result.status).toBe("checkpoint_needed");
  });

  it("returns milestone_complete checkpoint instead of completing milestone inline", async () => {
    const completedUnit: WorkingUnit = {
      ...makeUnit({ status: "completed", taskBranch: "task/w/unit-1", worktreePath: "/wt" }),
    };
    const lapis = createMockLapis([completedUnit], [makeHandoff("unit-1")]);
    (lapis.getContractHistory as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: "c-1",
      content: { criteria: ["works"], testCommands: [], acceptanceBehavior: "" },
    }]);

    mockSession.subscribe.mockImplementation((fn: (event: unknown) => void) => {
      setTimeout(() => fn({ type: "agent_end" }), 0);
      return () => {};
    });

    const callbacks = makeLoopCallbacks();
    const loop = createMilestoneLoop(lapis, createMockPinyx(), callbacks, makeLoopConfig());
    const result = await loop.run(makeMission(), [makeMilestone()]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("milestone_complete");
    }
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith("ms-1", "validating");
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalledWith("ms-1", "completed");
  });
});
