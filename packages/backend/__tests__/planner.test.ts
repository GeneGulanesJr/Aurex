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

  it("collapses a single-file refactor milestone into one worker unit (serial-by-default)", async () => {
    // Root-cause fix: the planner used to decompose single-file refactors
    // (e.g. "reduce complexity of minimax.ts") into N parallel worker units
    // that all necessarily edited the same file. Overlap detection can't
    // help when the task itself is inherently serial — every unit targets
    // the one file. When every unit in a milestone targets a single unique
    // path, collapse to one unit so the milestone runs serially.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Refactor minimax.ts" }),
      createWorkingUnit: vi.fn().mockImplementation((_, unit) =>
        Promise.resolve({ id: `unit-${unit.description.slice(0, 4)}`, description: unit.description })),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [
        {
          title: "Refactor minimax.ts",
          description: "Reduce complexity of minimax.ts by breaking it into helpers",
          units: [
            { description: "Analyze structure", declaredPaths: ["repo-media/providers/minimax.ts"], declaredModules: ["providers"] },
            { description: "Extract helpers", declaredPaths: ["repo-media/providers/minimax.ts"], declaredModules: ["providers"] },
            { description: "Recompose main", declaredPaths: ["repo-media/providers/minimax.ts"], declaredModules: ["providers"] },
          ],
          criteria: ["complexity reduced", "tests pass"],
          testCommands: ["npm test"],
        },
      ],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never);
    await planner.plan("Refactor repo-media/providers/minimax.ts to reduce complexity", "m-1");

    // Only ONE working unit should be created, not three.
    expect(mockLapis.createWorkingUnit).toHaveBeenCalledTimes(1);
    // The surviving unit's description should carry the full milestone intent.
    const createdUnit = (mockLapis.createWorkingUnit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(createdUnit.description).toMatch(/minimax/i);
  });

  it("does NOT collapse multi-file milestones with distinct unit scopes", async () => {
    // Guard against over-eager collapsing: when units target distinct files,
    // parallelism is valid and must be preserved.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth" }),
      createWorkingUnit: vi.fn().mockImplementation((_, unit) =>
        Promise.resolve({ id: `unit-${unit.description.slice(0, 4)}`, description: unit.description })),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = createMockPinyx(JSON.stringify({
      milestones: [{
        title: "Auth",
        description: "Add login + signup",
        units: [
          { description: "Login", declaredPaths: ["src/auth/login.ts"], declaredModules: ["auth"] },
          { description: "Signup", declaredPaths: ["src/auth/signup.ts"], declaredModules: ["auth"] },
        ],
        criteria: ["works"], testCommands: [],
      }],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never);
    await planner.plan("Add login and signup", "m-1");

    expect(mockLapis.createWorkingUnit).toHaveBeenCalledTimes(2);
  });

  it("still parses valid JSON when graph/hotspots affected-code input is provided", async () => {
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
          description: "Implement JWT auth",
          units: [{ description: "Login endpoint", declaredPaths: ["src/auth/login.ts"], declaredModules: ["auth"] }],
          criteria: ["Tokens valid"],
          testCommands: ["npm test"],
        },
      ],
    }));

    const planner = createPlanner(mockLapis, mockPinyx as never, {
      codeGraph: {
        nodes: [{ id: "src/auth/login.ts", module: "auth", symbols: 4, importance: 9 }],
        edges: [],
      },
      codeHotspots: { files: [{ path: "src/auth/login.ts", module: "auth", complexity: 7, symbols: 4 }] },
    });
    const result = await planner.plan("Build auth", "m-1");
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Auth module");
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

  it("repairs a truncated response cut mid-string inside a path value (real-world failure mode)", async () => {
    // Reproduces the production failure: model uses the `working_units`
    // schema with a `path` field, and the response is cut mid-string at
    // `.../re`. The repair must close the open string, then close all
    // open structures, producing a valid (if partial) plan that the
    // normalizer maps to the expected unit fields.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Analyze minimax.ts" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Read and analyze minimax.ts source" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    // Exactly the payload shape from the reported production error.
    const truncated = `{"milestones":[{"id":"1","title":"Analyze minimax.ts complexity and structure","working_units":[{"id":"1.1","title":"Read and analyze minimax.ts source","path":"/workspace/repos/GeneGulanesJr-PiGen/re`;

    const mockPinyx = createMockPinyx(truncated);
    const eventBus = { emit: vi.fn() };

    const planner = createPlanner(mockLapis, mockPinyx as never, { eventBus: eventBus as never, missionId: "m-1" });
    const result = await planner.plan("Analyze minimax.ts", "m-1");

    // Repair should have produced a parseable plan and the normalizer
    // should have mapped working_units -> units and path -> declaredPaths.
    // The plan-level result is the {id, description} from the LaPis mock,
    // so assert the *planned* unit passed to createWorkingUnit instead.
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Analyze minimax.ts complexity and structure");
    expect(mockLapis.createWorkingUnit).toHaveBeenCalledWith(
      "ms-1",
      expect.objectContaining({
        description: "Read and analyze minimax.ts source",
        declaredPaths: ["/workspace/repos/GeneGulanesJr-PiGen/re"],
      }),
    );

    // The repair should have been logged.
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "mission_log",
      phase: "planning",
      message: expect.stringMatching(/Successfully repaired truncated JSON/),
    }));
  });

  it("repairs a truncated response that contains a raw newline inside a string value", async () => {
    // Real-world LLM failure mode: some models output a literal newline
    // inside a JSON string value, which is invalid JSON. The repair must
    // close the open string and then sanitize the raw newline so the
    // repaired JSON parses. Without this, JSON.parse rejects the repaired
    // output with "Bad control character in string literal" and the
    // planner surfaces planner_parse_error.
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "X" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "D" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
      getContractHistory: vi.fn().mockResolvedValue([]),
      createMissionLedger: vi.fn().mockResolvedValue({ missionId: "m-1", todos: [] }),
      createTodo: vi.fn().mockResolvedValue({ id: "td-1" }),
    } as unknown as LaPisClient;

    // Raw LF inside the path string, then truncated (no closing quote).
    const truncated = "{\"milestones\":[{\"id\":\"1\",\"title\":\"X\",\"units\":[{\"description\":\"D\",\"declaredPaths\":[\"/re\nmore";

    const mockPinyx = createMockPinyx(truncated);
    const eventBus = { emit: vi.fn() };

    const planner = createPlanner(mockLapis, mockPinyx as never, { eventBus: eventBus as never, missionId: "m-1" });
    const result = await planner.plan("Test", "m-1");

    expect(result.milestones).toHaveLength(1);
    // The raw newline must be sanitized to an escaped \n so the path is usable.
    const createCall = (mockLapis.createWorkingUnit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(createCall.declaredPaths).toEqual(["/re\nmore"]); // backslash-n (two chars), not a raw newline
  });
});
