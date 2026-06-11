import { describe, it, expect, vi } from "vitest";
import { createPlanner, type CodeSummary } from "../src/orchestrator/planner";
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

  it("repairs a truncated JSON response that has no closing brace (finishReason='stop')", async () => {
    // Real-world case: the provider's SSE stream is interrupted or the
    // model hits an internal limit but reports finishReason='stop' on
    // the final chunk. The response is a valid-looking object that just
    // never got its closing brace. Without the repair path this would
    // throw planner_parse_error; with the path, the parser closes the
    // open brackets and produces a valid plan.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth module" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Login endpoint" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    // No closing brace, finishReason=stop (misreported).
    const truncatedResponse = `{
      "milestones": [
        {
          "title": "Auth module",
          "description": "Implement JWT auth",
          "units": [
            { "description": "Login endpoint", "declaredPaths": ["src/auth/**"], "declaredModules": ["auth"] }
          ],
          "criteria": ["All tests pass"],
          "testCommands": ["npm test -- src/auth"]
        }`;

    const mockPinyx = {
      chat: vi.fn().mockResolvedValue({
        content: truncatedResponse,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      }),
      chatStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (text: string) => void) => {
        onChunk(truncatedResponse);
        return { content: truncatedResponse, finishReason: "stop", usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 } };
      }),
    };
    const eventBus = { emit: vi.fn() };

    const planner = createPlanner(mockLapis, mockPinyx as never, { eventBus: eventBus as never, missionId: "m-1" });
    const result = await planner.plan("Build authentication system", "m-1");

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Auth module");
    expect(result.milestones[0].units).toHaveLength(1);
    expect(result.milestones[0].units[0].description).toBe("Login endpoint");
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_log",
      phase: "planning",
      message: expect.stringContaining("Successfully repaired truncated JSON"),
    }));
  });

  it("repairs a JSON response where the closing brace exists but the trailing string was truncated mid-key", async () => {
    // Variant of the above: a closing brace is present, but the content
    // before it is broken (e.g. a string was truncated mid-character).
    // Direct JSON.parse fails; the repair path closes open strings,
    // brackets, and braces before re-parsing.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth module" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Login endpoint" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    // The 'description' string is truncated mid-word — no closing quote.
    // A trailing '}' exists from a partial previous attempt.
    const brokenResponse = `{"milestones": [{"title": "Auth", "description": "Implement JWT`;

    const mockPinyx = {
      chat: vi.fn().mockResolvedValue({
        content: brokenResponse,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      }),
      chatStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (text: string) => void) => {
        onChunk(brokenResponse);
        return { content: brokenResponse, finishReason: "stop", usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 } };
      }),
    };

    const planner = createPlanner(mockLapis, mockPinyx as never);
    const result = await planner.plan("Build authentication", "m-1");

    // Repair should produce at least a milestones array (possibly empty
    // after dropping the truncated record). The key invariant is that
    // the planner does NOT throw planner_parse_error for this case.
    expect(result.milestones).toBeDefined();
    expect(Array.isArray(result.milestones)).toBe(true);
  });

  it("includes codebase structure in the planning prompt when codeSummary is provided", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1", description: "Login" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const codeSummary: CodeSummary = {
      files: 120,
      symbols: 450,
      edges: 230,
      modules: [
        { name: "auth", fileCount: 15 },
        { name: "api", fileCount: 22 },
      ],
      entryPoints: ["src/index.ts", "src/server.ts"],
      cycles: { count: 1, paths: [["src/auth/jwt.ts", "src/auth/middleware.ts", "src/auth/jwt.ts"]] },
    };

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{
        title: "Auth module",
        description: "Implement JWT auth",
        units: [{ description: "Login endpoint", declaredPaths: ["src/auth/**"], declaredModules: ["auth"] }],
        criteria: ["Tests pass"],
        testCommands: ["npm test"],
      }],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never, { codeSummary });
    await planner.plan("Build auth", "m-1");

    const callArgs = (mockPinyx.chatStream as any).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Codebase Structure");
    expect(userMessage).toContain("auth (15 files)");
    expect(userMessage).toContain("api (22 files)");
    expect(userMessage).toContain("src/index.ts");
  });

  it("works without codeSummary (backwards compatible)", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1", description: "Login" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{
        title: "Auth",
        description: "Auth",
        units: [],
        criteria: [],
        testCommands: [],
      }],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never);
    await planner.plan("Build auth", "m-1");

    const callArgs = (mockPinyx.chatStream as any).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: any) => m.role === "user").content;
    expect(userMessage).not.toContain("Codebase Structure");
  });

  it("injects codeSummary sections into the user message when provided", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-1" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{ title: "M1", description: "First", units: [{ description: "U1", declaredPaths: [], declaredModules: [] }], criteria: [], testCommands: [] }],
    }));

    const codeSummary: CodeSummary = {
      files: 42,
      symbols: 380,
      edges: 120,
      modules: [{ name: "auth", fileCount: 8 }],
      entryPoints: ["src/index.ts"],
      cycles: { count: 0, paths: [] },
    };

    const planner = createPlanner(mockLapis, mockPinyx as never, { codeSummary });
    await planner.plan("Build auth", "m-1");

    // The PiNyx chatStream call should have received the codeSummary data
    // in the user message (planner.ts:123-135 builds codebaseSection and
    // pushes it onto the user message, not the system message).
    expect(mockPinyx.chatStream).toHaveBeenCalled();
    const request = (mockPinyx.chatStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage: string = request.messages[1].content;
    expect(userMessage).toContain("Total files: 42");
    expect(userMessage).toContain("Symbols: 380");
    expect(userMessage).toContain("Import edges: 120");
    expect(userMessage).toContain("auth");
    expect(userMessage).toContain("src/index.ts");
  });
});
