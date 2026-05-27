import { describe, it, expect, vi } from "vitest";
import { createResearchTools } from "../../src/agents/research-tools";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis() {
  return {
    writeFinding: vi.fn().mockResolvedValue({
      id: "f-1",
      missionId: "m-1",
      authorId: "research-1",
      domain: ["auth"],
      title: "Auth patterns",
      content: "Uses JWT",
      relevance: "high",
      status: "unverified",
      verifiedTaskId: null,
      ttl: null,
      expiresAt: null,
      createdAt: "2026-01-01",
    }),
    searchMemory: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
}

describe("research tools", () => {
  it("creates write_finding tool", () => {
    const tools = createResearchTools(createMockLapis(), {
      missionId: "m-1",
      authorId: "research-1",
    });
    const tool = tools.find((t) => t.name === "write_finding");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("finding");
  });

  it("creates search_memory tool", () => {
    const tools = createResearchTools(createMockLapis(), {
      missionId: "m-1",
      authorId: "research-1",
    });
    const tool = tools.find((t) => t.name === "search_memory");
    expect(tool).toBeDefined();
  });

  it("write_finding submits a finding to LaPis", async () => {
    const lapis = createMockLapis();
    const tools = createResearchTools(lapis, {
      missionId: "m-1",
      authorId: "research-1",
    });
    const tool = tools.find((t) => t.name === "write_finding")!;

    const result = await (tool as any).execute("tc-1", {
      domain: '["auth", "middleware"]',
      title: "Auth patterns",
      content: "Uses JWT for stateless auth",
      relevance: "high",
    });

    expect(lapis.writeFinding).toHaveBeenCalledWith("research-1", expect.objectContaining({
      missionId: "m-1",
      domain: ["auth", "middleware"],
      title: "Auth patterns",
      relevance: "high",
    }));

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("accepted");
  });

  it("write_finding handles malformed domain JSON", async () => {
    const lapis = createMockLapis();
    const tools = createResearchTools(lapis, {
      missionId: "m-1",
      authorId: "research-1",
    });
    const tool = tools.find((t) => t.name === "write_finding")!;

    await (tool as any).execute("tc-1", {
      domain: "not-json",
      title: "Test",
      content: "Test content",
      relevance: "medium",
    });

    expect(lapis.writeFinding).toHaveBeenCalledWith("research-1", expect.objectContaining({
      domain: [],
    }));
  });

  it("search_memory delegates to lapis", async () => {
    const lapis = createMockLapis();
    (lapis.searchMemory as any).mockResolvedValue([
      { id: 1, title: "test", content: "found", type: "pattern", scope: "project", topicKey: null },
    ]);
    const tools = createResearchTools(lapis, {
      missionId: "m-1",
      authorId: "research-1",
    });
    const tool = tools.find((t) => t.name === "search_memory")!;

    const result = await (tool as any).execute("tc-1", { query: "auth" });
    expect(lapis.searchMemory).toHaveBeenCalledWith("auth", undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("found");
  });
});
