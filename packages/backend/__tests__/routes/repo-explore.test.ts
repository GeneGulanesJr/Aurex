import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import Fastify from "fastify";
import { registerRepoExploreRoutes } from "../../src/routes/repo-explore";
import type { LaPisClient } from "../../src/clients/lapis-client";
import type { BumblebeeClient } from "../../src/clients/bumblebee-client";

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

function createMockBumblebee(): BumblebeeClient {
  return {
    isAvailable: vi.fn(async () => ({ available: true, version: "test", path: "mock" })),
    scan: vi.fn(async () => ({
      packages: [{
        id: "pkg-1",
        scanId: "scan-1",
        ecosystem: "npm",
        packageName: "lodash",
        normalizedName: "lodash",
        version: "4.17.20",
        packageManager: "npm",
        sourceType: "prod",
        sourceFile: "package.json",
        confidence: "high" as const,
      }],
      findings: [{
        id: "finding-1",
        scanId: "scan-1",
        missionId: "",
        findingType: "package_exposure",
        severity: "critical" as const,
        catalogId: "catalog-1",
        catalogName: "Compromised package",
        ecosystem: "npm",
        packageName: "lodash",
        normalizedName: "lodash",
        version: "4.17.20",
        sourceType: "prod",
        sourceFile: "package.json",
        confidence: "high" as const,
        evidence: "lodash@4.17.20 matched catalog entry",
      }],
    })),
  };
}

function buildApp(settings: Record<string, unknown> = {}, opts: { bumblebee?: BumblebeeClient } = {}) {
  const lapis = createMockLapis(settings);
  const app = Fastify();
  registerRepoExploreRoutes(app, { lapis, bumblebeeClient: opts.bumblebee });
  return { app, lapis, bumblebee: opts.bumblebee };
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

    it("includes a mutation field in the response", async () => {
      // Create a temp repo with a Stryker config so the scanner finds it
      const repoDir = await mkdtemp(join(tmpdir(), "aurex-explore-mutation-"));
      await writeFile(join(repoDir, "stryker.config.mjs"), "export default {};");
      const { app } = buildApp({
        "repo:my-repo:path": repoDir,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/my-repo/explore",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mutation).toBeDefined();
      expect(body.mutation.strykerConfigured).toBe(true);
      expect(body.mutation.configPath).toBe("stryker.config.mjs");
      expect(body.mutation.score).toBeNull();
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


  describe("GET /api/repos/:repoName/readiness", () => {
    it("detects package manager, scripts, and warnings", async () => {
      const root = await mkdtemp(join(tmpdir(), "aurex-repo-"));
      await writeFile(join(root, "package.json"), JSON.stringify({
        scripts: { test: "vitest run", build: "tsc -b" },
        dependencies: { react: "latest" },
        devDependencies: { vitest: "latest" },
      }));
      await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const { app, lapis } = buildApp({ "repo:ready-repo:path": root });

      const res = await app.inject({ method: "GET", url: "/api/repos/ready-repo/readiness" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.packageManager).toBe("pnpm");
      expect(body.commands.some((cmd: any) => cmd.command === "pnpm test")).toBe(true);
      expect(body.commands.some((cmd: any) => cmd.command === "pnpm build")).toBe(true);
      expect(lapis.setSetting).toHaveBeenCalledWith("repo:ready-repo:readiness", expect.objectContaining({ repoName: "ready-repo" }));
    });
  });

  describe("POST /api/repos/:repoName/scans", () => {
    it("runs package scan and persists repo-scoped result", async () => {
      const root = await mkdtemp(join(tmpdir(), "aurex-scan-repo-"));
      const bumblebee = createMockBumblebee();
      const { app, lapis } = buildApp({ "repo:scan-repo:path": root }, { bumblebee });

      const res = await app.inject({ method: "POST", url: "/api/repos/scan-repo/scans", payload: { profile: "project" } });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.scan.missionId).toBe("repo:scan-repo");
      expect(body.scan.summary.criticalCount).toBe(1);
      expect(body.findings[0].missionId).toBe("repo:scan-repo");
      expect(lapis.setSetting).toHaveBeenCalledWith("bumblebee_scan:scan-1", expect.objectContaining({ id: "scan-1" }));
      expect(lapis.setSetting).toHaveBeenCalledWith("repo:scan-repo:bumblebee_scans", { scanIds: ["scan-1"] });
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
      // main.ts has complexity 25 → falls in P4 complexity tier (20-30 range)
      const complexitySuggestion = body.suggestions.find((s: any) => s.category === "complexity");
      expect(complexitySuggestion).toBeDefined();
      expect(complexitySuggestion.title).toContain("main.ts");
      expect(complexitySuggestion.tier).toBe("P4");
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
      const cycleSuggestion = body.suggestions.find((s: any) => s.category === "critical_path");
      expect(cycleSuggestion).toBeDefined();
      expect(cycleSuggestion.tier).toBe("P0");
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

    it("includes package scanner findings as security suggestions", async () => {
      const scan = {
        id: "scan-1",
        missionId: "repo:my-repo",
        profile: "project",
        status: "completed",
        startedAt: "",
        summary: { totalPackages: 1, totalFindings: 1, criticalCount: 1, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: ["npm"] },
        findings: [{
          id: "finding-1",
          scanId: "scan-1",
          missionId: "repo:my-repo",
          findingType: "package_exposure",
          severity: "critical",
          catalogId: "catalog-1",
          catalogName: "Compromised package",
          ecosystem: "npm",
          packageName: "lodash",
          normalizedName: "lodash",
          version: "4.17.20",
          sourceType: "prod",
          sourceFile: "package.json",
          confidence: "high",
          evidence: "catalog match",
        }],
      };
      const { app } = buildApp({
        "repo:my-repo:bumblebee_scans": { scanIds: ["scan-1"] },
        "bumblebee_scan:scan-1": scan,
      });

      const res = await app.inject({ method: "GET", url: "/api/repos/my-repo/suggestions" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const securitySuggestion = body.suggestions.find((s: any) => s.category === "security");
      expect(securitySuggestion).toMatchObject({ tier: "P0", confidence: "high" });
      expect(body.recommended.highestImpact).toBe(securitySuggestion.id);
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
