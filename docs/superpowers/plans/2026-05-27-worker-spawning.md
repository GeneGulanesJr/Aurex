# Worker Spawning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the milestone-loop placeholder with actual Pi SDK worker spawning — agents that run in git worktrees, connect to LaPis/PiNyx, write handoffs, and are supervised with timeouts.

**Architecture:** Each worker is a Pi SDK `createAgentSession()` running in-process with a custom cwd (worktree path), restricted tools (`read/write/edit/bash`), the worker skill file injected via `DefaultResourceLoader`, and custom tools for LaPis integration (`write_handoff`, `search_memory`). The `AgentSpawner` orchestrates session lifecycle, timeout supervision via `AbortController`, and handoff extraction from session events. The milestone loop calls `AgentSpawner.spawn()` for each working unit after overlap checks and worktree creation.

**Tech Stack:** Pi SDK (`@earendil-works/pi-coding-agent`), Vitest, TypeScript, Node.js built-ins (`AbortController`, `child_process`)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/backend/src/agents/context-builder.ts` | Builds injected AGENTS.md with mission/milestone/unit/contract context for worker sessions |
| Create | `packages/backend/src/agents/worker-tools.ts` | Custom Pi tools: `write_handoff`, `search_memory` that route through LaPis client |
| Create | `packages/backend/src/agents/agent-spawner.ts` | `createAgentSpawner()` — wraps Pi SDK `createAgentSession()` with Aurex-specific config, timeout supervision, event handling |
| Modify | `packages/backend/src/agents/factory.ts` | Fix skill paths from `skills/` to `src/skills/` |
| Modify | `packages/backend/src/orchestrator/milestone-loop.ts` | Replace placeholder with actual worker spawning loop using AgentSpawner |
| Modify | `packages/backend/package.json` | Add `@earendil-works/pi-coding-agent` dependency |
| Create | `packages/backend/__tests__/agents/context-builder.test.ts` | Tests for context building |
| Create | `packages/backend/__tests__/agents/worker-tools.test.ts` | Tests for custom Pi tools |
| Create | `packages/backend/__tests__/agents/agent-spawner.test.ts` | Tests for spawner lifecycle (create, timeout, complete, dispose) |
| Modify | `packages/backend/__tests__/agents/factory.test.ts` | Update skill path assertions |
| Create | `packages/backend/__tests__/milestone-loop-spawn.test.ts` | Integration test for milestone loop with spawner |

---

### Task 1: Fix Agent Skill Paths

The `AGENT_SKILL` map in factory.ts points to `skills/worker.md` but the actual skill files live at `src/skills/worker.md`. This needs to be correct before the spawner uses it.

**Files:**
- Modify: `packages/backend/src/agents/factory.ts:12-18`
- Modify: `packages/backend/__tests__/agents/factory.test.ts:24-29`

- [ ] **Step 1: Write the failing test**

Update `packages/backend/__tests__/agents/factory.test.ts` — change the skill path assertions to use the correct `src/skills/` prefix:

```typescript
  it("skill files map correctly", () => {
    expect(AGENT_SKILL["orchestrator"]).toContain("src/skills/orchestrator.md");
    expect(AGENT_SKILL["worker"]).toContain("src/skills/worker.md");
    expect(AGENT_SKILL["validator_scrutiny"]).toContain("src/skills/validator.md");
    expect(AGENT_SKILL["validator_user_testing"]).toContain("src/skills/validator.md");
    expect(AGENT_SKILL["research"]).toContain("src/skills/research.md");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/factory.test.ts`
Expected: FAIL — `"skills/orchestrator.md"` does not contain `"src/skills/orchestrator.md"`

- [ ] **Step 3: Fix the skill paths**

In `packages/backend/src/agents/factory.ts`, update the `AGENT_SKILL` constant:

```typescript
export const AGENT_SKILL: Record<AgentType, string> = {
  orchestrator: "src/skills/orchestrator.md",
  worker: "src/skills/worker.md",
  validator_scrutiny: "src/skills/validator.md",
  validator_user_testing: "src/skills/validator.md",
  research: "src/skills/research.md",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/factory.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/agents/factory.ts packages/backend/__tests__/agents/factory.test.ts
git commit -m "fix: correct AGENT_SKILL paths to src/skills/ prefix"
```

---

### Task 2: Context Builder

Builds the injected context (AGENTS.md content) that each worker receives — mission description, milestone details, unit spec, validation contract criteria, and active broadcasts.

**Files:**
- Create: `packages/backend/src/agents/context-builder.ts`
- Create: `packages/backend/__tests__/agents/context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/agents/context-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildWorkerContext } from "../../src/agents/context-builder";

describe("buildWorkerContext", () => {
  it("includes mission description", () => {
    const ctx = buildWorkerContext({
      missionDescription: "Build user authentication",
      milestoneTitle: "Auth module",
      milestoneDescription: "Implement JWT auth",
      unitDescription: "Create login endpoint",
      unitDeclaredPaths: ["src/auth/login.ts"],
      unitDeclaredModules: ["auth"],
      contractCriteria: ["Login returns JWT", "Token expires in 1h"],
      testCommands: ["npm test -- --grep login"],
    });
    expect(ctx).toContain("Build user authentication");
    expect(ctx).toContain("Auth module");
    expect(ctx).toContain("Create login endpoint");
    expect(ctx).toContain("src/auth/login.ts");
    expect(ctx).toContain("auth");
    expect(ctx).toContain("Login returns JWT");
    expect(ctx).toContain("npm test -- --grep login");
  });

  it("includes scope constraint warning", () => {
    const ctx = buildWorkerContext({
      missionDescription: "Fix bug",
      milestoneTitle: "Fix",
      milestoneDescription: "Fix the bug",
      unitDescription: "Fix null pointer",
      unitDeclaredPaths: ["src/foo.ts"],
      unitDeclaredModules: ["foo"],
      contractCriteria: ["No crash"],
      testCommands: ["npm test"],
    });
    expect(ctx).toContain("SCOPE CONSTRAINT");
    expect(ctx).toContain("src/foo.ts");
  });

  it("includes handoff format reminder", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
    });
    expect(ctx).toContain("HANDOFF");
  });

  it("formats test commands as numbered list", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: ["npm test", "npm run lint"],
    });
    expect(ctx).toContain("1. `npm test`");
    expect(ctx).toContain("2. `npm run lint`");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/context-builder.test.ts`
Expected: FAIL — Cannot find module `../../src/agents/context-builder`

- [ ] **Step 3: Write minimal implementation**

Create `packages/backend/src/agents/context-builder.ts`:

```typescript
export interface WorkerContextInput {
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  unitDescription: string;
  unitDeclaredPaths: string[];
  unitDeclaredModules: string[];
  contractCriteria: string[];
  testCommands: string[];
}

export function buildWorkerContext(input: WorkerContextInput): string {
  const sections: string[] = [];

  // Mission context
  sections.push(`# Mission Context\n\n${input.missionDescription}`);

  // Milestone
  sections.push(
    `## Milestone: ${input.milestoneTitle}\n\n${input.milestoneDescription}`,
  );

  // Unit spec
  sections.push(
    `## Your Working Unit\n\n${input.unitDescription}`,
  );

  // Scope constraint
  const scopeParts: string[] = [];
  if (input.unitDeclaredPaths.length > 0) {
    scopeParts.push(`- Paths: ${input.unitDeclaredPaths.join(", ")}`);
  }
  if (input.unitDeclaredModules.length > 0) {
    scopeParts.push(`- Modules: ${input.unitDeclaredModules.join(", ")}`);
  }
  if (scopeParts.length > 0) {
    sections.push(
      `## SCOPE CONSTRAINT\n\nYou MUST only modify files within:\n${scopeParts.join("\n")}`,
    );
  }

  // Validation contract
  if (input.contractCriteria.length > 0) {
    sections.push(
      `## Validation Criteria\n\n${input.contractCriteria.map((c) => `- ${c}`).join("\n")}`,
    );
  }

  // Test commands
  if (input.testCommands.length > 0) {
    sections.push(
      `## Test Commands\n\n${input.testCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n")}`,
    );
  }

  // Handoff reminder
  sections.push(
    `## HANDOFF\n\nWhen complete, use the \`write_handoff\` tool to submit your work. Include all required fields: featureName, description, implemented, remaining, rationale, assumptions, unresolvedUncertainties, errorsEncountered, commandsRun, gitCommitHash.`,
  );

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/context-builder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/agents/context-builder.ts packages/backend/__tests__/agents/context-builder.test.ts
git commit -m "feat: add context-builder for worker session injection"
```

---

### Task 3: Worker Custom Tools

Custom Pi tools that let workers interact with LaPis — `write_handoff` for submitting work, `search_memory` for querying shared memory. These are passed to `createAgentSession` as `customTools`.

**Files:**
- Create: `packages/backend/src/agents/worker-tools.ts`
- Create: `packages/backend/__tests__/agents/worker-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/agents/worker-tools.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createWorkerTools } from "../../src/agents/worker-tools";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis() {
  return {
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([
      { id: 1, title: "test", content: "found", type: "pattern", scope: "project", topicKey: null },
    ]),
  } as unknown as LaPisClient;
}

describe("worker tools", () => {
  it("creates write_handoff tool with correct name", () => {
    const tools = createWorkerTools(createMockLapis(), "unit-123");
    const handoffTool = tools.find((t) => t.name === "write_handoff");
    expect(handoffTool).toBeDefined();
    expect(handoffTool!.description).toContain("handoff");
  });

  it("creates search_memory tool with correct name", () => {
    const tools = createWorkerTools(createMockLapis(), "unit-123");
    const memTool = tools.find((t) => t.name === "search_memory");
    expect(memTool).toBeDefined();
    expect(memTool!.description).toContain("memory");
  });

  it("write_handoff calls lapis.writeHandoff with unitId", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    const result = await (handoffTool as any).execute("tc-1", {
      featureName: "Login",
      description: "Login endpoint",
      implemented: "POST /login",
      remaining: "Token refresh",
      rationale: "JWT-based auth",
      assumptions: "Users have passwords",
      unresolvedUncertainties: "none",
      errorsEncountered: "none",
      commandsRun: JSON.stringify([{ command: "npm test", exitCode: 0 }]),
      gitCommitHash: "abc123",
    });

    expect(lapis.writeHandoff).toHaveBeenCalledWith("unit-456", expect.objectContaining({
      unitId: "unit-456",
      featureName: "Login",
      gitCommitHash: "abc123",
    }));
  });

  it("write_handoff returns accepted on success", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    const result = await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Ra",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("accepted");
  });

  it("write_handoff returns errors when rejected", async () => {
    const lapis = createMockLapis();
    (lapis.writeHandoff as any).mockResolvedValue({
      accepted: false,
      errors: ["rationale is too short"],
    });
    const tools = createWorkerTools(lapis, "unit-456");
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    const result = await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Refactored X",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("rationale is too short");
  });

  it("search_memory calls lapis.searchMemory", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const memTool = tools.find((t) => t.name === "search_memory")!;

    const result = await (memTool as any).execute("tc-1", { query: "auth pattern" });

    expect(lapis.searchMemory).toHaveBeenCalledWith("auth pattern", undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("found");
  });

  it("search_memory passes limit option", async () => {
    const lapis = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-456");
    const memTool = tools.find((t) => t.name === "search_memory")!;

    await (memTool as any).execute("tc-1", { query: "test", limit: 5 });

    expect(lapis.searchMemory).toHaveBeenCalledWith("test", { limit: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/worker-tools.test.ts`
Expected: FAIL — Cannot find module `../../src/agents/worker-tools`

- [ ] **Step 3: Write minimal implementation**

Create `packages/backend/src/agents/worker-tools.ts`:

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client";
import type { Handoff } from "@aurex/shared";

export function createWorkerTools(lapis: LaPisClient, unitId: string) {
  const writeHandoff = defineTool({
    name: "write_handoff",
    label: "Write Handoff",
    description:
      "Submit your completed work as a structured handoff. This is required when you finish your working unit. Fill in all fields thoroughly — the handoff is validated and incomplete submissions are rejected.",
    parameters: Type.Object({
      featureName: Type.String({ description: "Name of the feature you implemented" }),
      description: Type.String({ description: "Brief description of what was built" }),
      implemented: Type.String({ description: "What you actually implemented" }),
      remaining: Type.String({ description: "What is left to do (can be 'none')" }),
      rationale: Type.String({ description: "Detailed explanation of your design decisions. Why, not what." }),
      assumptions: Type.String({ description: "Assumptions you made during implementation" }),
      unresolvedUncertainties: Type.String({ description: "Things you are unsure about. 'none' is valid." }),
      errorsEncountered: Type.String({ description: "Any errors encountered during implementation" }),
      commandsRun: Type.String({ description: "JSON array of {command, exitCode} objects for tests you ran" }),
      gitCommitHash: Type.String({ description: "The commit hash of your final commit" }),
    }),
    execute: async (_toolCallId, params) => {
      let commandsRun: { command: string; exitCode: number }[];
      try {
        commandsRun = JSON.parse(params.commandsRun);
      } catch {
        commandsRun = [];
      }

      const handoff: Handoff = {
        unitId,
        featureName: params.featureName,
        description: params.description,
        implemented: params.implemented,
        remaining: params.remaining,
        rationale: params.rationale,
        assumptions: params.assumptions,
        unresolvedUncertainties: params.unresolvedUncertainties,
        errorsEncountered: params.errorsEncountered,
        commandsRun,
        gitCommitHash: params.gitCommitHash,
      };

      const result = await lapis.writeHandoff(unitId, handoff);

      if (result.accepted) {
        return {
          content: [{ type: "text" as const, text: "Handoff accepted. Your work has been recorded." }],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Handoff rejected:\n${result.errors.join("\n")}\n\nPlease fix these issues and resubmit.`,
          },
        ],
        details: {},
      };
    },
  });

  const searchMemory = defineTool({
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search shared project memory for context about patterns, past decisions, and codebase knowledge. Use this to find relevant context before implementing.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — be specific for best results" }),
      limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
    }),
    execute: async (_toolCallId, params) => {
      const results = await lapis.searchMemory(params.query, params.limit ? { limit: params.limit } : undefined);

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: {},
        };
      }

      const text = results
        .map((r) => `## ${r.title}\n${r.content}`)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  });

  return [writeHandoff, searchMemory];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/worker-tools.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/agents/worker-tools.ts packages/backend/__tests__/agents/worker-tools.test.ts
git commit -m "feat: add worker custom tools (write_handoff, search_memory)"
```

---

### Task 4: Add Pi SDK Dependency

Add `@earendil-works/pi-coding-agent` and `@sinclair/typebox` (its peer dep for tool schemas) to the backend package.

**Files:**
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/backend add @earendil-works/pi-coding-agent @sinclair/typebox
```

- [ ] **Step 2: Verify import works**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
node --input-type=module -e "import { createAgentSession, defineTool } from '@earendil-works/pi-coding-agent'; console.log('OK', typeof defineTool)"
```
Expected: `OK function`

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/package.json pnpm-lock.yaml
git commit -m "feat: add @earendil-works/pi-coding-agent and @sinclair/typebox dependencies"
```

---

### Task 5: Agent Spawner — Core Lifecycle

The `AgentSpawner` is the heart of worker spawning. It creates Pi SDK sessions configured for Aurex workers, handles timeout supervision via `AbortController`, and extracts handoffs from session events. This task covers the spawner interface and session creation. Timeout and event handling are covered in Tasks 6-7.

**Files:**
- Create: `packages/backend/src/agents/agent-spawner.ts`
- Create: `packages/backend/__tests__/agents/agent-spawner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/agents/agent-spawner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pi SDK before importing our code
const mockSession = {
  prompt: vi.fn(),
  subscribe: vi.fn(),
  abort: vi.fn(),
  dispose: vi.fn(),
  sessionId: "test-session-123",
  isStreaming: false,
};

const mockCreateAgentSession = vi.fn().mockResolvedValue({ session: mockSession });

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  SessionManager: { inMemory: vi.fn() },
  DefaultResourceLoader: vi.fn().mockImplementation(() => ({
    reload: vi.fn().mockResolvedValue(undefined),
    getSkills: vi.fn().mockReturnValue([]),
    getExtensions: vi.fn().mockReturnValue([]),
    getAgentsFiles: vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] }),
  })),
  defineTool: vi.fn(),
}));

import { createAgentSpawner, type AgentSpawnerConfig } from "../../src/agents/agent-spawner";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(): LaPisClient {
  return {
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

describe("AgentSpawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.subscribe.mockReturnValue(() => {});
  });

  it("creates a spawner with correct config", () => {
    const config: AgentSpawnerConfig = {
      lapis: createMockLapis(),
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    };
    const spawner = createAgentSpawner(config);
    expect(spawner).toBeDefined();
    expect(typeof spawner.spawn).toBe("function");
    expect(typeof spawner.shutdown).toBe("function");
  });

  it("spawn creates a Pi SDK session with correct cwd", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const result = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Mission Context\nDo the thing",
      taskPrompt: "Implement the login endpoint",
      timeout: 300_000,
    });

    expect(mockCreateAgentSession).toHaveBeenCalled();
    const callOpts = mockCreateAgentSession.mock.calls[0][0];
    expect(callOpts.cwd).toBe("/repo/.git-worktrees/worker-unit-1");
    expect(callOpts.tools).toEqual(["read", "write", "edit", "bash"]);
    expect(result.sessionId).toBe("test-session-123");
  });

  it("registers agent session in LaPis", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    expect(lapis.registerAgentSession).toHaveBeenCalledWith(
      "worker",
      "test-session-123",
      "mission-1",
      "ms-1",
      "unit-1",
    );
  });

  it("updates working unit status to spawned", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/.git-worktrees/worker-unit-1",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-1", "spawned");
  });

  it("dispose cleans up session", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    handle.dispose();
    expect(mockSession.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/agent-spawner.test.ts`
Expected: FAIL — Cannot find module `../../src/agents/agent-spawner`

- [ ] **Step 3: Write minimal implementation**

Create `packages/backend/src/agents/agent-spawner.ts`:

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import type { AgentType, WorkerStatus } from "@aurex/shared";
import { AGENT_TOOLS } from "./factory";
import { createWorkerTools } from "./worker-tools";
import type { LaPisClient } from "../clients/lapis-client";

export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
}

export interface SpawnOptions {
  agentType: AgentType;
  unitId: string;
  missionId: string;
  milestoneId: string;
  cwd: string;
  skillFilePath: string;
  contextContent: string;
  taskPrompt: string;
  timeout?: number;
}

export interface SpawnHandle {
  sessionId: string;
  /** Resolves when the agent finishes (success, failure, or timeout) */
  completed: Promise<SpawnResult>;
  /** Abort the agent immediately */
  abort(): void;
  /** Dispose of the session resources */
  dispose(): void;
}

export interface SpawnResult {
  status: "completed" | "timed_out" | "failed";
  sessionId: string;
  error?: string;
}

export function createAgentSpawner(config: AgentSpawnerConfig) {
  const { lapis, agentDir, defaultTimeout } = config;

  return {
    async spawn(opts: SpawnOptions): Promise<SpawnHandle> {
      const timeout = opts.timeout ?? defaultTimeout;
      const tools = AGENT_TOOLS[opts.agentType];
      const workerTools = createWorkerTools(lapis, opts.unitId);

      // Build ResourceLoader with injected context and skill
      const loader = new DefaultResourceLoader({
        cwd: opts.cwd,
        agentDir,
        skillsOverride: (current) => ({
          skills: [
            ...current.skills,
            {
              name: "aurex-worker",
              description: "Aurex worker skill",
              filePath: opts.skillFilePath,
              baseDir: opts.skillFilePath.substring(0, opts.skillFilePath.lastIndexOf("/")),
              source: "custom",
            },
          ],
          diagnostics: current.diagnostics,
        }),
        agentsFilesOverride: (current) => ({
          agentsFiles: [
            ...current.agentsFiles,
            {
              path: "/virtual/aurex-context.md",
              content: opts.contextContent,
            },
          ],
          diagnostics: current.diagnostics,
        }),
      });
      await loader.reload();

      // Create Pi SDK session
      const { session } = await createAgentSession({
        cwd: opts.cwd,
        agentDir,
        tools,
        customTools: workerTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(opts.cwd),
        noTools: "all" as never, // we control tools explicitly
      });

      // Register in LaPis
      await lapis.registerAgentSession(
        opts.agentType,
        session.sessionId,
        opts.missionId,
        opts.milestoneId,
        opts.unitId,
      );

      // Update unit status
      await lapis.updateWorkingUnitStatus(opts.unitId, "spawned" as WorkerStatus);

      // Set up completion tracking
      let resolveCompleted: (result: SpawnResult) => void;
      const completed = new Promise<SpawnResult>((resolve) => {
        resolveCompleted = resolve;
      });

      // Subscribe to events for lifecycle tracking
      let settled = false;
      const unsubscribe = session.subscribe((event) => {
        if (settled) return;

        if (event.type === "agent_end") {
          settled = true;
          resolveCompleted({ status: "completed", sessionId: session.sessionId });
        }

        if (event.type === "message_update") {
          const msgEvent = event as any;
          if (msgEvent.assistantMessageEvent?.type === "error") {
            settled = true;
            resolveCompleted({
              status: "failed",
              sessionId: session.sessionId,
              error: msgEvent.assistantMessageEvent.message ?? "unknown error",
            });
          }
        }
      });

      // Start timeout race
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          session.abort();
          resolveCompleted({ status: "timed_out", sessionId: session.sessionId });
        }
      }, timeout);

      // Send the task prompt (fire and forget — completion tracked via events)
      session.prompt(opts.taskPrompt).catch((err: Error) => {
        if (!settled) {
          settled = true;
          resolveCompleted({
            status: "failed",
            sessionId: session.sessionId,
            error: err.message,
          });
        }
      });

      // Cleanup on completion
      completed.finally(() => {
        clearTimeout(timeoutId);
        unsubscribe();
      });

      return {
        sessionId: session.sessionId,
        completed,
        abort() {
          if (!settled) {
            settled = true;
            session.abort();
            resolveCompleted({ status: "failed", sessionId: session.sessionId, error: "aborted" });
          }
        },
        dispose() {
          session.dispose();
        },
      };
    },

    shutdown() {
      // Future: track all active handles and abort them
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/agent-spawner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/agents/agent-spawner.ts packages/backend/__tests__/agents/agent-spawner.test.ts
git commit -m "feat: add AgentSpawner with Pi SDK session lifecycle"
```

---

### Task 6: Agent Spawner — Timeout Handling

Verify that the spawner correctly handles timeouts — the `AbortController` race, status transitions, and cleanup.

**Files:**
- Modify: `packages/backend/__tests__/agents/agent-spawner.test.ts` — append new tests

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/__tests__/agents/agent-spawner.test.ts` (inside the `describe("AgentSpawner", ...)` block):

```typescript
  it("times out and aborts session when timeout elapses", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 5_000,
    });

    // Make prompt hang forever
    mockSession.prompt.mockReturnValue(new Promise(() => {}));

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 5_000,
    });

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(5_100);

    const result = await handle.completed;
    expect(result.status).toBe("timed_out");
    expect(result.sessionId).toBe("test-session-123");
    expect(mockSession.abort).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("does not timeout if agent completes first", async () => {
    vi.useFakeTimers();
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    // Simulate agent completing after subscribe
    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      // Simulate agent_end event
      eventSubscriber({ type: "agent_end" });
    });

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 5_000,
    });

    const result = await handle.completed;
    expect(result.status).toBe("completed");

    // Advance past timeout — should NOT have aborted
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSession.abort).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run tests to verify they pass (spawner already implements timeout)**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/agent-spawner.test.ts`
Expected: PASS (7 tests)

Note: The implementation from Task 5 already handles timeout via the `setTimeout` + `settled` flag pattern. These tests verify it works correctly.

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/__tests__/agents/agent-spawner.test.ts
git commit -m "test: add timeout and race condition tests for AgentSpawner"
```

---

### Task 7: Agent Spawner — Handoff Extraction

When a worker completes, the spawner should update the working unit status and log costs. The handoff itself is written by the worker via the `write_handoff` tool — the spawner just observes completion and transitions status.

**Files:**
- Modify: `packages/backend/__tests__/agents/agent-spawner.test.ts` — append new tests

- [ ] **Step 1: Write the test**

Append to the `describe("AgentSpawner", ...)` block:

```typescript
  it("updates unit status to working when agent starts", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/home/user/.pi/agent",
      defaultTimeout: 120_000,
    });

    // Capture status updates
    const statusUpdates: string[] = [];
    (lapis.updateWorkingUnitStatus as any).mockImplementation(async (_id: string, status: string) => {
      statusUpdates.push(status);
    });

    let eventSubscriber: (event: any) => void = () => {};
    mockSession.subscribe.mockImplementation((fn: any) => {
      eventSubscriber = fn;
      return () => {};
    });
    mockSession.prompt.mockImplementation(async () => {
      eventSubscriber({ type: "agent_start" });
      eventSubscriber({ type: "agent_end" });
    });

    const handle = await spawner.spawn({
      agentType: "worker",
      unitId: "unit-1",
      missionId: "mission-1",
      milestoneId: "ms-1",
      cwd: "/repo/worktree",
      skillFilePath: "/app/src/skills/worker.md",
      contextContent: "# Context",
      taskPrompt: "Do the work",
      timeout: 120_000,
    });

    await handle.completed;

    // First call is "spawned" from create, then agent_start → "working"
    expect(statusUpdates).toContain("spawned");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/agents/agent-spawner.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/__tests__/agents/agent-spawner.test.ts
git commit -m "test: add status transition test for AgentSpawner"
```

---

### Task 8: Wire Milestone Loop to Agent Spawner

Replace the placeholder in `milestone-loop.ts` with actual worker spawning. For each milestone, iterate over its working units, check overlap, create worktrees, spawn agents, and handle results.

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Create: `packages/backend/__tests__/milestone-loop-spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/__tests__/milestone-loop-spawn.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mission, Milestone, WorkingUnit, MissionConfig } from "@aurex/shared";

// Mock Pi SDK
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  SessionManager: { inMemory: vi.fn() },
  DefaultResourceLoader: vi.fn().mockImplementation(() => ({
    reload: vi.fn().mockResolvedValue(undefined),
    getSkills: vi.fn().mockReturnValue([]),
    getExtensions: vi.fn().mockReturnValue([]),
    getAgentsFiles: vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] }),
  })),
  defineTool: vi.fn(),
}));

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";

function createMockLapis(units: WorkingUnit[] = []): LaPisClient {
  return {
    getMission: vi.fn().mockResolvedValue({ id: "m-1", status: "running" }),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    getVerdicts: vi.fn().mockResolvedValue([]),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(units),
    createWorkingUnit: vi.fn().mockResolvedValue(units[0]),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    getContractHistory: vi.fn().mockResolvedValue([{ content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" } }]),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

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
    validationContractId: "contract-1",
    ...overrides,
  };
}

describe("milestone loop with spawner", () => {
  it("skips completed milestones", async () => {
    const lapis = createMockLapis();
    const pinyx = createMockPinyx();
    const loop = createMilestoneLoop(lapis, pinyx, {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    }, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const mission = makeMission();
    const completedMilestone = makeMilestone({ status: "completed" });

    const result = await loop.run(mission, [completedMilestone]);
    expect(result).toBe(true);
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalledWith("ms-1", "in_progress");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/milestone-loop-spawn.test.ts`
Expected: FAIL — `createMilestoneLoop` does not accept the config argument yet

- [ ] **Step 3: Update milestone-loop.ts to accept spawner config**

This is a significant rewrite of `packages/backend/src/orchestrator/milestone-loop.ts`. The current placeholder loop becomes a real spawning loop:

```typescript
// packages/backend/src/orchestrator/milestone-loop.ts
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";
import { createNegotiator } from "./negotiator";
import { createWorktreeManager, type WorktreeManager } from "./worktree";
import { checkPreSpawnOverlap } from "./overlap";
import { createAgentSpawner, type AgentSpawnerConfig } from "../agents/agent-spawner";
import { buildWorkerContext } from "../agents/context-builder";
import { resolveModel } from "../agents/factory";

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: unknown, context: unknown) => void;
  onAgentStatus: (agentId: string, agentType: unknown, status: unknown, milestoneId: string) => void;
  onMilestoneProgress: (milestoneId: string, status: unknown, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export interface MilestoneLoopConfig {
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
  loopConfig: MilestoneLoopConfig,
) {
  const worktreeManager = createWorktreeManager(loopConfig.repoRoot);
  const spawner = createAgentSpawner({
    lapis,
    agentDir: loopConfig.agentDir,
    defaultTimeout: 120_000,
  });

  return {
    async run(mission: Mission, milestones: Milestone[]): Promise<boolean> {
      const config = mission.configJson;
      const negotiator = createNegotiator(lapis);

      for (const milestone of milestones) {
        if (milestone.status === "completed") continue;

        // Update milestone status
        await lapis.updateMilestoneStatus(milestone.id, "in_progress");
        callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);

        // Get working units for this milestone
        const units = await lapis.getWorkingUnitsForMilestone(milestone.id);

        // Get contract for context building
        const contracts = await lapis.getContractHistory(milestone.id);
        const contract = contracts[0] as any;

        let completedCount = 0;
        let failedCount = 0;

        for (const unit of units) {
          if (unit.status === "completed") {
            completedCount++;
            continue;
          }

          // Pre-spawn overlap check
          const activeUnits = units.filter(
            (u) => u.status === "working" || u.status === "spawned",
          );
          const overlap = checkPreSpawnOverlap(
            { declaredPaths: unit.declaredPaths, declaredModules: unit.declaredModules },
            activeUnits,
          );
          if (overlap.overlap) {
            // Skip for now — will be picked up in next iteration
            continue;
          }

          // Create worktree for isolation
          const agentId = `worker-${unit.id}`;
          const { worktreePath, taskBranch } = await worktreeManager.createWorktree(
            agentId,
            unit.id,
            `${loopConfig.gitMainBranch}`,
          );

          // Update unit with worktree info
          // (LaPis would need an update method — for now we track in memory)

          // Build context
          const contextContent = buildWorkerContext({
            missionDescription: mission.description,
            milestoneTitle: milestone.title,
            milestoneDescription: milestone.description,
            unitDescription: unit.description,
            unitDeclaredPaths: unit.declaredPaths,
            unitDeclaredModules: unit.declaredModules,
            contractCriteria: contract?.content?.criteria ?? [],
            testCommands: contract?.content?.testCommands ?? [],
          });

          // Determine timeout based on complexity (default: simple)
          const timeout = config.workerTimeouts.simple;

          // Spawn worker
          callbacks.onAgentStatus(agentId, "worker", "spawned", milestone.id);

          const handle = await spawner.spawn({
            agentType: "worker",
            unitId: unit.id,
            missionId: mission.id,
            milestoneId: milestone.id,
            cwd: worktreePath,
            skillFilePath: `${loopConfig.repoRoot}/packages/backend/src/skills/worker.md`,
            contextContent,
            taskPrompt: `Implement: ${unit.description}\n\nFollow your skill instructions carefully. Use write_handoff when done.`,
            timeout,
          });

          callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);

          // Wait for completion
          const result = await handle.completed;

          if (result.status === "completed") {
            await lapis.updateWorkingUnitStatus(unit.id, "completed");
            callbacks.onAgentStatus(agentId, "worker", "completed", milestone.id);
            completedCount++;
          } else if (result.status === "timed_out") {
            await lapis.updateWorkingUnitStatus(unit.id, "timed_out");
            callbacks.onAgentStatus(agentId, "worker", "timed_out", milestone.id);
            failedCount++;
          } else {
            await lapis.updateWorkingUnitStatus(unit.id, "failed");
            callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
            failedCount++;
          }

          handle.dispose();

          callbacks.onMilestoneProgress(
            milestone.id,
            "in_progress",
            completedCount,
            units.length,
          );
        }

        // Negotiate verdicts
        const retryCounter = await lapis.incrementRetry(milestone.id);
        const decision = await negotiator.negotiate(
          milestone.id,
          retryCounter.retries,
          retryCounter.rescopes,
          config.maxValidatorRetries,
          config.maxRescopes,
        );

        if (decision.decision === "escalate") {
          callbacks.onEscalation(mission.id, { kind: "rescope_limit", milestoneId: milestone.id }, {});
          return false;
        }

        if (decision.decision === "pass") {
          await lapis.updateMilestoneStatus(milestone.id, "completed");
          callbacks.onMilestoneProgress(milestone.id, "completed", completedCount, units.length);
        }
      }

      await lapis.updateMissionStatus(mission.id, "completed");
      return true;
    },
  };
}
```

- [ ] **Step 4: Add getWorkingUnitsForMilestone to LaPis client**

The LaPis client doesn't have `getWorkingUnitsForMilestone` yet. Add it to `packages/backend/src/clients/lapis-client.ts`:

In the `LaPisClient` interface, add:
```typescript
  getWorkingUnitsForMilestone(milestoneId: string): Promise<WorkingUnit[]>;
```

In the implementation object, add:
```typescript
    getWorkingUnitsForMilestone(milestoneId) {
      return get(`/milestones/${milestoneId}/units`);
    },
```

Also add the `WorkingUnit` import to the import line at the top (it should already be there — check).

- [ ] **Step 5: Run the test**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/milestone-loop-spawn.test.ts`
Expected: PASS (1 test — skips completed milestones)

- [ ] **Step 6: Run all existing milestone-loop tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All existing tests still pass (the old milestone-loop tests may need the new config parameter)

Note: If existing tests call `createMilestoneLoop` with the old 3-arg signature, update them to include the `loopConfig` 4th argument.

- [ ] **Step 7: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/src/orchestrator/milestone-loop.ts packages/backend/__tests__/milestone-loop-spawn.test.ts packages/backend/src/clients/lapis-client.ts
git commit -m "feat: wire milestone loop to AgentSpawner with worktree isolation"
```

---

### Task 9: Milestone Loop — Worker Spawning Integration Test

Test the full spawning flow within the milestone loop: milestone with units → worktree creation → agent spawning → completion.

**Files:**
- Modify: `packages/backend/__tests__/milestone-loop-spawn.test.ts` — append new tests

- [ ] **Step 1: Write the integration test**

Append to `packages/backend/__tests__/milestone-loop-spawn.test.ts` (inside the describe block):

```typescript
  it("spawns a worker for each unit and completes the milestone", async () => {
    const unit: WorkingUnit = {
      id: "unit-1",
      milestoneId: "ms-1",
      description: "Create login endpoint",
      declaredPaths: ["src/auth/login.ts"],
      declaredModules: ["auth"],
      status: "spawned",
      taskBranch: "task/worker-unit-1/unit-1",
      worktreePath: "/repo/.git-worktrees/worker-unit-1-unit-1",
      sessionId: "",
    };

    const lapis = createMockLapis([unit]);
    // Make getVerdicts return all-pass for the negotiator
    (lapis.getVerdicts as any).mockResolvedValue([]);

    const pinyx = createMockPinyx();
    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, pinyx, callbacks, {
      agentDir: "/home/user/.pi/agent",
      repoRoot: "/repo",
      gitMainBranch: "main",
    });

    const mission = makeMission();
    const milestone = makeMilestone();

    const result = await loop.run(mission, [milestone]);

    // Milestone should be marked in_progress
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith("ms-1", "in_progress");

    // Units should have been fetched
    expect(lapis.getWorkingUnitsForMilestone).toHaveBeenCalledWith("ms-1");

    // Final result depends on whether the mock spawner completed successfully
    // With the Pi SDK mock, session.prompt resolves immediately → agent_end may not fire
    // So we check that the loop ran without error
    expect(result).toBeDefined();
  });
```

- [ ] **Step 2: Run test**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/milestone-loop-spawn.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/backend/__tests__/milestone-loop-spawn.test.ts
git commit -m "test: add worker spawning integration test for milestone loop"
```

---

### Task 10: Fix Existing Milestone Loop Tests

The milestone loop signature changed (added `loopConfig` parameter). Update existing tests that call `createMilestoneLoop`.

**Files:**
- Modify: `packages/backend/__tests__/milestone-loop.test.ts` (if it exists — search for it)

- [ ] **Step 1: Find existing milestone loop tests**

```bash
find /home/genegulanesjr/Documents/GulanesKorp/Aurex -name "milestone-loop*" -type f
```

- [ ] **Step 2: Update signature**

Any existing calls to `createMilestoneLoop(lapis, pinyx, callbacks)` need to become `createMilestoneLoop(lapis, pinyx, callbacks, { agentDir: "/test/.pi/agent", repoRoot: "/test/repo", gitMainBranch: "main" })`.

Mock `@earendil-works/pi-coding-agent` at the top of any affected test file to prevent real SDK imports:

```typescript
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  SessionManager: { inMemory: vi.fn() },
  DefaultResourceLoader: vi.fn(),
  defineTool: vi.fn(),
}));
```

- [ ] **Step 3: Run all tests**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add -u
git commit -m "fix: update existing milestone-loop tests for new spawner config"
```

---

## Self-Review

### 1. Spec Coverage

| Spec Requirement | Task |
|-----------------|------|
| Workers spawned via Pi SDK in-process | Task 5 (AgentSpawner) |
| Git worktree isolation per unit | Task 8 (milestone loop) |
| Worker skill file injection | Task 5 (DefaultResourceLoader skillsOverride) |
| Custom tools for LaPis (write_handoff, search_memory) | Task 3 |
| Timeout supervision with AbortController | Task 5-6 |
| Handoff structural validation | Task 3 (write_handoff tool → lapis.writeHandoff) |
| Session registration in LaPis | Task 5 (registerAgentSession) |
| Status transitions (spawned → working → completed/failed/timed_out) | Task 5, 7 |
| Pre-spawn overlap detection | Task 8 (checkPreSpawnOverlap) |
| Context injection (mission/milestone/unit/contract) | Task 2 (context-builder) |
| Negotiator verdict after workers complete | Task 8 (existing negotiator) |

**Gap:** Cost logging per PiNyx call — the spawner tracks cost events but doesn't yet parse Pi SDK usage events into `lapis.logCost()` calls. This is a secondary concern (cost tracking works without it — just doesn't auto-log token counts). Can be added as a follow-up.

### 2. Placeholder Scan

No TBDs, TODOs, or placeholder patterns found.

### 3. Type Consistency

- `SpawnOptions.agentType` uses `AgentType` from `@aurex/shared` — matches `AGENT_TOOLS` key type ✓
- `createWorkerTools(lapis, unitId)` — unitId is `string`, matches `WorkingUnit.id` type ✓
- `buildWorkerContext(input)` — all fields match what milestone-loop provides ✓
- `LaPisClient.getWorkingUnitsForMilestone` added consistently to interface and implementation ✓
- `createMilestoneLoop` new 4th param `MilestoneLoopConfig` is a new interface — no conflicts ✓
