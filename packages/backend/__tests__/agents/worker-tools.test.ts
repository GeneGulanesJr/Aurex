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

    await (handoffTool as any).execute("tc-1", {
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

  it("calls onHandoffAccepted after LaPis accepts a handoff", async () => {
    const lapis = createMockLapis();
    const onHandoffAccepted = vi.fn();
    const tools = createWorkerTools(lapis, "unit-456", { onHandoffAccepted });
    const handoffTool = tools.find((t) => t.name === "write_handoff")!;

    await (handoffTool as any).execute("tc-1", {
      featureName: "F",
      description: "D",
      implemented: "I",
      remaining: "R",
      rationale: "Detailed rationale",
      assumptions: "A",
      unresolvedUncertainties: "U",
      errorsEncountered: "E",
      commandsRun: "[]",
      gitCommitHash: "deadbeef",
    });

    expect(onHandoffAccepted).toHaveBeenCalledTimes(1);
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
