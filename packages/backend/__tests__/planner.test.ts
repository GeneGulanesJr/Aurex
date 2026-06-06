import { describe, it, expect, vi } from "vitest";
import { createPlanner } from "../src/orchestrator/planner";
import type { LaPisClient } from "../src/clients/lapis-client";

function createMockPinyx(responseContent: string) {
  return {
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    }),
    chatStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (text: string) => void) => {
      // Simulate streaming by delivering the full content at once
      onChunk(responseContent);
      return {
        content: responseContent,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      };
    }),
  };
}

describe("planner", () => {
  it("plans milestones from mission description via PiNyx", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth module" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Login endpoint" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [
        {
          title: "Auth module",
          description: "Implement JWT authentication",
          units: [{ description: "Login endpoint", declaredPaths: ["src/auth/**"], declaredModules: ["auth"] }],
          criteria: ["All tests pass", "JWT tokens valid"],
          testCommands: ["npm test -- src/auth"],
        },
      ],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never);
    const result = await planner.plan("Build authentication system", "m-1");

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Auth module");
    expect(mockLapis.createMilestone).toHaveBeenCalled();
    expect(mockLapis.createContract).toHaveBeenCalled();
    expect(mockLapis.createMissionLedger).toHaveBeenCalledWith(expect.objectContaining({
      missionId: "m-1",
      sourceMission: "Build authentication system",
    }));
    expect(mockLapis.createTodo).toHaveBeenCalledTimes(2);
    expect(mockLapis.createTodo).toHaveBeenCalledWith("m-1", expect.objectContaining({
      title: "Milestone 1: Auth module",
      lapisContextQuery: expect.stringContaining("Auth"),
    }));
    expect(mockLapis.createTodo).toHaveBeenCalledWith("m-1", expect.objectContaining({
      title: "Login endpoint",
      scope: expect.objectContaining({ in: ["src/auth/**", "auth"] }),
      validatorInstructions: expect.arrayContaining([expect.stringContaining("Treat outside-scope suggestions as optional")]),
    }));
  });

  it("uses the configured orchestrator model for PiNyx planning", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Smoke" }),
      createWorkingUnit: vi.fn(),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{ title: "Smoke", description: "No-op", units: [], criteria: [], testCommands: [] }],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never, { model: "kilo/kilo-auto/free" });
    await planner.plan("Smoke mission", "m-1");

    expect(mockPinyx.chatStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "kilo/kilo-auto/free" }),
      expect.any(Function),
    );
  });

  it("supersedes the previous contract before creating a new one when a contract already exists", async () => {
    const existingContract = {
      id: "c-old",
      milestoneId: "ms-1",
      version: 1,
      supersededBy: null,
      supersedes: null,
      rescopeEventId: null,
      content: { criteria: ["old"], testCommands: ["npm test"], acceptanceBehavior: "old" },
    };
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Login" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-new", version: 2 }),
      supersedeContract: vi.fn().mockResolvedValue({ id: "c-new", version: 2 }),
      getContractHistory: vi.fn().mockResolvedValue([existingContract]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
      logRescope: vi.fn().mockResolvedValue({ id: "r-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{
        title: "Auth",
        description: "Implement JWT",
        units: [{ description: "Login", declaredPaths: ["src/auth/**"], declaredModules: ["auth"] }],
        criteria: ["Tests pass"],
        testCommands: ["npm test"],
      }],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never);
    await planner.plan("Build auth", "m-1");

    // The old contract must be superseded, not silently overwritten.
    expect(mockLapis.supersedeContract).toHaveBeenCalledWith(
      "c-old",
      expect.objectContaining({ content: expect.objectContaining({ criteria: ["Tests pass"] }) }),
      expect.objectContaining({ reason: expect.any(String) }),
    );
    // And the new contract must come from supersede, not from a plain create.
    expect(mockLapis.createContract).not.toHaveBeenCalled();
  });

  it("emits planner_parse_error when fallback JSON extraction also fails", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn(),
      createWorkingUnit: vi.fn(),
      createContract: vi.fn(),
      getContractHistory: vi.fn(),
      createMissionLedger: vi.fn(),
      createTodo: vi.fn(),
    } as unknown as LaPisClient;
    const mockPinyx = createMockPinyx("Here is a broken object: { definitely not json }");
    const eventBus = { emit: vi.fn() };

    const planner = createPlanner(mockLapis, mockPinyx as never, { eventBus: eventBus as never, missionId: "m-1" });

    await expect(planner.plan("Broken plan", "m-1")).rejects.toThrow("Planner returned invalid JSON");
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_error",
      missionId: "m-1",
      code: "planner_parse_error",
      recoverable: true,
    }));
  });
});
