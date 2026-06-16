import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResearchFinding, LaPisClient as _LC } from "@aurex/shared";

// Passthrough defineTool so we can call .execute() directly on the config.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  defineTool: (cfg: unknown) => cfg,
}));

import { createWorkerTools } from "../src/agents/worker-tools";
import type { LaPisClient } from "../src/clients/lapis-client";

function makeFinding(overrides: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: "finding-1",
    missionId: "m-1",
    authorId: "research-ms-1",
    domain: ["auth"],
    title: "Auth uses JWT",
    content: "The auth module validates JWTs via jsonwebtoken",
    relevance: "high",
    status: "unverified",
    verifiedTaskId: null,
    ttl: null,
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockLapis(findings: ResearchFinding[] = []): {
  lapis: LaPisClient;
  transitionFinding: ReturnType<typeof vi.fn>;
  getFindings: ReturnType<typeof vi.fn>;
} {
  const transitionFinding = vi.fn().mockResolvedValue(makeFinding());
  const getFindings = vi.fn().mockResolvedValue(findings);
  const lapis = {
    getFindings,
    transitionFinding,
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    searchMemory: vi.fn().mockResolvedValue([]),
  } as unknown as LaPisClient;
  return { lapis, transitionFinding, getFindings };
}

function getTool(tools: ReturnType<typeof createWorkerTools>, name: string) {
  const tool = tools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool as unknown as {
    name: string;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: Record<string, never> }>;
  };
}

async function runTool(tools: ReturnType<typeof createWorkerTools>, name: string, params: Record<string, unknown>) {
  const tool = getTool(tools, name);
  return tool.execute("tc-1", params);
}

describe("worker finding tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verify_finding", () => {
    it("transitions an unverified finding to verified with standing context", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding()]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "verify_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("verified");
      expect(transitionFinding).toHaveBeenCalledWith(
        "finding-1",
        "verified",
        "ws-1",
        { taskId: "unit-1", workerSessionId: "ws-1" },
      );
    });

    it("rejects verifying an already-verified finding without calling transition", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding({ status: "verified" })]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "verify_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("Cannot transition");
      expect(transitionFinding).not.toHaveBeenCalled();
    });

    it("rejects verifying an expired finding without calling transition", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding({ status: "expired" })]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "verify_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("Cannot transition");
      expect(transitionFinding).not.toHaveBeenCalled();
    });

    it("returns a not-found message when the finding does not exist", async () => {
      const { lapis, transitionFinding } = createMockLapis([]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "verify_finding", { findingId: "nope" });

      expect(result.content[0].text).toContain("not found");
      expect(transitionFinding).not.toHaveBeenCalled();
    });

    it("returns a graceful message when missionId is not set", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding()]);
      const tools = createWorkerTools(lapis, "unit-1", { getSessionId: () => "ws-1" });

      const result = await runTool(tools, "verify_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("mission context is not available");
      expect(transitionFinding).not.toHaveBeenCalled();
    });
  });

  describe("reject_finding", () => {
    it("transitions an unverified finding to rejected", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding()]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "reject_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("rejected");
      expect(transitionFinding).toHaveBeenCalledWith(
        "finding-1",
        "rejected",
        "ws-1",
        { taskId: "unit-1", workerSessionId: "ws-1" },
      );
    });

    it("rejects an already-rejected finding without calling transition", async () => {
      const { lapis, transitionFinding } = createMockLapis([makeFinding({ status: "rejected" })]);
      const tools = createWorkerTools(lapis, "unit-1", {
        missionId: "m-1",
        getSessionId: () => "ws-1",
      });

      const result = await runTool(tools, "reject_finding", { findingId: "finding-1" });

      expect(result.content[0].text).toContain("Cannot transition");
      expect(transitionFinding).not.toHaveBeenCalled();
    });
  });

  it("still includes write_handoff and search_memory tools", () => {
    const { lapis } = createMockLapis();
    const tools = createWorkerTools(lapis, "unit-1", {
      missionId: "m-1",
      getSessionId: () => "ws-1",
    });
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("write_handoff");
    expect(names).toContain("search_memory");
    expect(names).toContain("verify_finding");
    expect(names).toContain("reject_finding");
  });
});
