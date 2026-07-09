import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { registerReviewRoutes } from "../../src/routes/review-routes.js";
import type { LaPisClient } from "../../src/clients/lapis-client.js";
import type { ReviewReport } from "@aurex/shared";

function mockLapis(): LaPisClient {
  const settings = new Map<string, unknown>();
  return {
    ping: async () => {},
    getSetting: async (key: string) => settings.get(key) as never,
    setSetting: async (key: string, value: unknown) => { settings.set(key, value); },
    indexRepo: async () => ({}),
    getCodeSummary: async () => ({
      files: 2,
      symbols: 10,
      edges: 5,
      modules: [{ name: "src", fileCount: 2 }],
      entryPoints: ["index.ts"],
      cycles: { count: 0, paths: [] },
    }),
    getCodeHotspots: async () => ({
      files: [{ path: "src/a.ts", module: "src", complexity: 35, symbols: 5 }],
    }),
    getCodeGraph: async () => ({
      nodes: [{ id: "src/a.ts", module: "src", symbols: 5, importance: 1 }],
      edges: [],
    }),
    createMission: async () => { throw new Error("not implemented"); },
    getMission: async () => { throw new Error("not implemented"); },
    updateMissionStatus: async () => {},
    createMilestone: async () => { throw new Error("not implemented"); },
    updateMilestoneStatus: async () => {},
    createWorkingUnit: async () => { throw new Error("not implemented"); },
    getWorkingUnitsForMilestone: async () => [],
    updateWorkingUnitStatus: async () => {},
    updateWorkingUnit: async () => {},
    writeHandoff: async () => { throw new Error("not implemented"); },
    getHandoffsForMilestone: async () => [],
    getHandoffForUnit: async () => null,
    createContract: async () => { throw new Error("not implemented"); },
    supersedeContract: async () => { throw new Error("not implemented"); },
    getContractHistory: async () => [],
    writeVerdict: async () => { throw new Error("not implemented"); },
    classifyVerdict: async () => { throw new Error("not implemented"); },
    getVerdicts: async () => [],
    writeFinding: async () => { throw new Error("not implemented"); },
    transitionFinding: async () => { throw new Error("not implemented"); },
    getFindings: async () => [],
    getStandingContext: async () => null,
    setStandingContext: async () => {},
    writeAgentSession: async () => { throw new Error("not implemented"); },
    getAgentSessions: async () => [],
    getCostSummary: async () => ({ totalCost: 0, byAgent: {} }),
    getRetryCounter: async () => null,
    setRetryCounter: async () => {},
    writeRescopeEvent: async () => { throw new Error("not implemented"); },
    getRescopeEvents: async () => [],
    writeMemory: async () => ({ id: "m", content: "", createdAt: "" }),
    getMemories: async () => [],
    writeCheckpoint: async () => { throw new Error("not implemented"); },
    getCheckpoints: async () => [],
    compressMissionState: async () => ({ summary: null, tokensSaved: 0 }),
    getTodoLedger: async () => null,
    upsertTodoLedger: async () => { throw new Error("not implemented"); },
    createTodo: async () => { throw new Error("not implemented"); },
    updateTodo: async () => {},
    getTodos: async () => [],
    appendTodoEvent: async () => { throw new Error("not implemented"); },
    getTodoContext: async () => ({ todos: [], events: [] }),
  } as LaPisClient;
}

describe("review routes", () => {
  let app: ReturnType<typeof Fastify>;
  let lapis: LaPisClient;

  beforeAll(async () => {
    app = Fastify();
    lapis = mockLapis();
    await lapis.setSetting("repo:my-repo:path", process.cwd());
    registerReviewRoutes(app, {
      lapis,
      buildReadinessProfile: async (repoName) => ({
        repoName,
        profile: "node",
        packageManager: "pnpm",
        languages: ["TypeScript"],
        frameworks: [],
        monorepo: false,
        lockfiles: [],
        commands: [{ name: "test", command: "pnpm test", confidence: "high", source: "package.json" }],
        blockers: [],
        warnings: [],
        confidence: "high",
        generatedAt: new Date().toISOString(),
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /review returns isolated issues with fix prompts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/repos/my-repo/review",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { report: ReviewReport };
    expect(body.report.issues.length).toBeGreaterThan(0);
    expect(body.report.issues[0].fixPrompt).toContain("## Issue");
    expect(body.report.analysisVersion).toBe("3.0");
  });

  it("GET /review returns latest report", async () => {
    await app.inject({ method: "POST", url: "/api/repos/my-repo/review" });
    const res = await app.inject({ method: "GET", url: "/api/repos/my-repo/review" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { report: ReviewReport }).report.repoName).toBe("my-repo");
  });

  it("GET /review/:id/export returns markdown", async () => {
    const post = await app.inject({ method: "POST", url: "/api/repos/my-repo/review" });
    const { report } = post.json() as { report: ReviewReport };
    const res = await app.inject({
      method: "GET",
      url: `/api/repos/my-repo/review/${report.id}/export`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.body).toContain("# Code Review — my-repo");
    expect(res.body).toContain("## Issue");
  });

  it("PATCH /review/:id/issues/:issueId updates issue status for URL-safe ids", async () => {
    const post = await app.inject({ method: "POST", url: "/api/repos/my-repo/review" });
    const { report } = post.json() as { report: ReviewReport };
    const complexity = report.issues.find((i) => i.category === "complexity");
    expect(complexity).toBeDefined();
    expect(complexity!.id).not.toContain("/");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/repos/my-repo/review/${report.id}/issues/${encodeURIComponent(complexity!.id)}`,
      payload: { status: "dismissed" },
    });
    expect(res.statusCode).toBe(200);
    const updated = (res.json() as { report: ReviewReport }).report;
    expect(updated.issues.find((i) => i.id === complexity!.id)?.status).toBe("dismissed");
  });

  it("POST /review returns 404 when repo is not prepared", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/repos/unprepared-repo/review",
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toContain("not found");
  });

  it("GET /review returns 404 when no review exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/repos/empty-repo/review",
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH returns 400 for invalid status", async () => {
    const post = await app.inject({ method: "POST", url: "/api/repos/my-repo/review" });
    const { report } = post.json() as { report: ReviewReport };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/repos/my-repo/review/${report.id}/issues/${report.issues[0].id}`,
      payload: { status: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH returns 404 for unknown issue id", async () => {
    const post = await app.inject({ method: "POST", url: "/api/repos/my-repo/review" });
    const { report } = post.json() as { report: ReviewReport };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/repos/my-repo/review/${report.id}/issues/unknown-issue`,
      payload: { status: "dismissed" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /graph returns 404 when repo is not prepared", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/repos/no-such-repo/graph",
    });
    expect(res.statusCode).toBe(404);
  });
});
