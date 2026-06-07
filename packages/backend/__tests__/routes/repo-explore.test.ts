import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRepoExploreRoutes } from "../../src/routes/repo-explore";
import type { LaPisClient } from "../../src/clients/lapis-client";

function createMockLapis(settings: Record<string, unknown> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings[key] = value; }),
    indexRepo: vi.fn(async () => ({ files: 10, symbols: 50, error: null })),
    getCodeSummary: vi.fn(async () => ({
      files: 10,
      symbols: 50,
      edges: 30,
      modules: [{ name: "src/core", fileCount: 5 }],
      entryPoints: ["main.ts"],
      cycles: { count: 0, paths: [] },
    })),
    getCodeHotspots: vi.fn(async () => ({
      files: [
        { path: "src/core/main.ts", module: "core", complexity: 25, symbols: 8 },
        { path: "src/core/utils.ts", module: "core", complexity: 12, symbols: 4 },
      ],
    })),
  } as unknown as LaPisClient;
}

function buildApp(settings: Record<string, unknown> = {}) {
  const lapis = createMockLapis(settings);
  const app = Fastify();
  registerRepoExploreRoutes(app, { lapis });
  return { app, lapis };
}

describe("Repo explore routes", () => {
  describe("POST /api/repos/:repoName/explore", () => {
    it("returns 404 when repo path is not stored", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/unknown-repo/explore",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Repository not found. Run prepare first." });
    });

    it("indexes the repo and returns summary", async () => {
      const { app, lapis } = buildApp({
        "repo:my-repo:path": "/workspace/repos/my-repo",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/my-repo/explore",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("completed");
      expect(body.repoName).toBe("my-repo");
      expect(body.summary).toBeDefined();
      expect(body.summary.files).toBe(10);
      expect(lapis.indexRepo).toHaveBeenCalledWith("/workspace/repos/my-repo", "my-repo");
    });

    it("returns failed when indexing errors", async () => {
      const { lapis, app } = buildApp({
        "repo:bad-repo:path": "/workspace/repos/bad-repo",
      });
      (lapis.indexRepo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk full"));

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/bad-repo/explore",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "failed", error: "disk full" });
    });
  });

  describe("GET /api/repos/:repoName/summary", () => {
    it("returns code summary for a repo", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/summary",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ files: 10, symbols: 50, edges: 30 });
    });
  });

  describe("GET /api/repos/:repoName/hotspots", () => {
    it("returns hotspot data for a repo", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/hotspots",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.files).toHaveLength(2);
      expect(body.files[0].complexity).toBe(25);
    });
  });

  describe("GET /api/repos/:repoName/suggestions", () => {
    it("returns suggestions from summary and hotspot data", async () => {
      const { app } = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/suggestions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.suggestions).toBeInstanceOf(Array);
      // Should include high_complexity suggestion for main.ts (complexity 25)
      const complexitySuggestion = body.suggestions.find((s: any) => s.category === "high_complexity");
      expect(complexitySuggestion).toBeDefined();
      expect(complexitySuggestion.title).toContain("main.ts");
    });

    it("includes cycle suggestion when cycles detected", async () => {
      const { lapis, app } = buildApp();
      (lapis.getCodeSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        files: 10, symbols: 50, edges: 30,
        modules: [{ name: "src/core", fileCount: 5 }],
        entryPoints: ["main.ts"],
        cycles: { count: 2, paths: [["a", "b", "a"], ["c", "d", "c"]] },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/suggestions",
      });

      const body = res.json();
      const cycleSuggestion = body.suggestions.find((s: any) => s.category === "cycles");
      expect(cycleSuggestion).toBeDefined();
      expect(cycleSuggestion.priority).toBe("high");
      expect(cycleSuggestion.detail).toContain("2");
    });

    it("includes structure suggestion for large modules", async () => {
      const { lapis, app } = buildApp();
      (lapis.getCodeSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        files: 100, symbols: 500, edges: 300,
        modules: [
          { name: "src/core", fileCount: 25 },
          { name: "src/utils", fileCount: 5 },
        ],
        entryPoints: ["main.ts"],
        cycles: { count: 0, paths: [] },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/suggestions",
      });

      const body = res.json();
      const structSuggestion = body.suggestions.find((s: any) => s.category === "structure");
      expect(structSuggestion).toBeDefined();
      expect(structSuggestion.title).toContain("src/core");
      expect(structSuggestion.detail).toContain("25");
    });

    it("returns empty suggestions when analysis fails gracefully", async () => {
      const { lapis, app } = buildApp();
      (lapis.getCodeSummary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("LaPis down"));
      (lapis.getCodeHotspots as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("LaPis down"));

      const res = await app.inject({
        method: "GET",
        url: "/api/repos/my-repo/suggestions",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().suggestions).toEqual([]);
    });
  });
});
