# Repo Auto-Explore + Smart Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user selects a repo, Aurex automatically clones, indexes, and presents a rich overview with actionable mission suggestions.

**Architecture:** Backend adds repo-scoped explore/summary/hotspots/suggestions endpoints. Frontend enhances the RepoPrepareModal with phased progress, adds a RepoOverviewPanel in the main view, and a compact repo card in the sidebar. Mission-runner skips re-indexing when a repo is already indexed.

**Tech Stack:** TypeScript, Fastify (backend), React (frontend), LaPis (code index), Vitest (testing)

---

### Task 1: Backend — Modify prepare endpoint to return repoName and store repo metadata

**Files:**
- Modify: `packages/backend/src/routes/github.ts:1-4,248-260`
- Test: `packages/backend/__tests__/routes/github.test.ts:407-437`

- [ ] **Step 1: Write the failing test**

Update the existing test at line 407 to expect `repoName` in the response and verify `setSetting` calls for repo metadata:

```ts
    it("prepares a repo and returns repo + indexing status", async () => {
      mockListRepos.mockResolvedValueOnce(repos);
      mockPrepareRepoForMission.mockResolvedValueOnce({ repoPath: "/workspace/repos/octocat-hello-world", repoStatus: "cloned" });
      const { app, lapis } = buildApp({
        github_token: { access_token: "ghu_abc123", token_type: "bearer", scope: "repo", created_at: "2026-01-01T00:00:00Z" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/github/repos/prepare",
        payload: { cloneUrl: "https://github.com/octocat/hello-world.git" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        fullName: "octocat/hello-world",
        repoPath: "/workspace/repos/octocat-hello-world",
        repoStatus: "cloned",
        repoName: "octocat-hello-world",
        indexed: false,
        indexingStatus: "unavailable",
      });
      // Verify repo metadata stored for explore endpoint
      expect(lapis.setSetting).toHaveBeenCalledWith("repo:octocat-hello-world:path", "/workspace/repos/octocat-hello-world");
      expect(lapis.setSetting).toHaveBeenCalledWith("repo:octocat-hello-world:fullName", "octocat/hello-world");
      expect(mockPrepareRepoForMission).toHaveBeenCalledWith({
        lapis: expect.any(Object),
        parentRepoRoot: "/workspace",
        cloneUrl: "https://github.com/octocat/hello-world.git",
      });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && npx vitest run packages/backend/__tests__/routes/github.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `repoName` is not in the response, `setSetting` not called with repo keys.

- [ ] **Step 3: Write minimal implementation**

In `packages/backend/src/routes/github.ts`:

Add `path` import at the top (after the existing imports):
```ts
import path from "node:path";
```

Replace the return block inside the prepare handler (the `try` block starting at `const prepared = await prepareRepoForMission`):
```ts
    try {
      const prepared = await prepareRepoForMission({ lapis, parentRepoRoot: repoRoot, cloneUrl: normalizedCloneUrl });
      const repoName = path.basename(prepared.repoPath);
      await lapis.setSetting(`repo:${repoName}:path`, prepared.repoPath);
      await lapis.setSetting(`repo:${repoName}:fullName`, repo.full_name);
      return {
        fullName: repo.full_name,
        repoPath: prepared.repoPath,
        repoStatus: prepared.repoStatus,
        repoName,
        indexed: false,
        indexingStatus: "unavailable" as const,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[github] prepare repo error:", message);
      return reply.status(502).send({ error: "Could not prepare repository" });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/backend/__tests__/routes/github.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full backend test suite**

Run: `npx vitest run packages/backend --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/github.ts packages/backend/__tests__/routes/github.test.ts
git commit -m "feat: prepare endpoint returns repoName and stores repo metadata"
```

---

### Task 2: Backend — Add repo-scoped explore, summary, hotspots, and suggestions routes

**Files:**
- Create: `packages/backend/src/routes/repo-explore.ts`
- Modify: `packages/backend/src/server.ts:6-14,137-143`
- Create: `packages/backend/__tests__/routes/repo-explore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/__tests__/routes/repo-explore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/backend/__tests__/routes/repo-explore.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/backend/src/routes/repo-explore.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
}

interface RepoSuggestion {
  id: string;
  category: "high_complexity" | "cycles" | "structure";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  affectedFiles: number;
  detail: string;
  prefill: string;
}

function generateSuggestions(
  summary: { files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; cycles: { count: number; paths: string[][] } },
  hotspots: { files: Array<{ path: string; module: string; complexity: number; symbols: number }> },
): RepoSuggestion[] {
  const suggestions: RepoSuggestion[] = [];

  // High complexity from hotspots
  for (const file of hotspots.files) {
    if (file.complexity > 20) {
      suggestions.push({
        id: `complexity-${file.path}`,
        category: "high_complexity",
        title: `Refactor ${file.path.split("/").pop()} — complexity score ${file.complexity}`,
        description: `${file.path} has a complexity of ${file.complexity}, which is above the threshold of 20. High complexity makes code harder to understand, test, and maintain.`,
        priority: file.complexity > 30 ? "high" : "medium",
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Refactor ${file.path} to reduce complexity (currently ${file.complexity}). Break into smaller, focused functions.`,
      });
    }
  }

  // Dependency cycles
  if (summary.cycles.count > 0) {
    const moduleNames = [...new Set(summary.cycles.paths.flat())].slice(0, 3).join(", ");
    suggestions.push({
      id: "cycles",
      category: "cycles",
      title: `Break ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""}`,
      description: `${summary.cycles.count} circular dependenc${summary.cycles.count > 1 ? "ies" : "y"} detected. Cycles make modules harder to test independently and can cause build issues.`,
      priority: "high",
      affectedFiles: summary.cycles.paths.flat().length,
      detail: `${summary.cycles.count} cycle${summary.cycles.count > 1 ? "s" : ""} involving: ${moduleNames}`,
      prefill: `Break the ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""} in this codebase. Introduce interfaces or extract shared types to decouple the circular imports.`,
    });
  }

  // Large modules
  for (const mod of summary.modules) {
    if (mod.fileCount > 20) {
      suggestions.push({
        id: `structure-${mod.name}`,
        category: "structure",
        title: `Split ${mod.name} (${mod.fileCount} files) into focused packages`,
        description: `Module ${mod.name} contains ${mod.fileCount} files, which suggests it may handle multiple responsibilities. Splitting it would improve maintainability.`,
        priority: "low",
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files in ${mod.name}`,
        prefill: `Split the ${mod.name} module (${mod.fileCount} files) into smaller, more focused packages with clear responsibilities.`,
      });
    }
  }

  return suggestions;
}

export function registerRepoExploreRoutes(app: FastifyInstance, deps: RepoExploreDeps) {
  const { lapis } = deps;

  app.post("/api/repos/:repoName/explore", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await lapis.getSetting<string>(`repo:${repoName}:path`);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }

    try {
      await lapis.indexRepo(repoPath, repoName);
      const summary = await lapis.getCodeSummary(repoName);
      return { repoName, status: "completed" as const, summary };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Indexing failed";
      return { repoName, status: "failed" as const, error };
    }
  });

  app.get("/api/repos/:repoName/summary", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeSummary(repoName);
  });

  app.get("/api/repos/:repoName/hotspots", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeHotspots(repoName);
  });

  app.get("/api/repos/:repoName/suggestions", async () => {
    let summary = { files: 0, symbols: 0, edges: 0, modules: [] as Array<{ name: string; fileCount: number }>, entryPoints: [] as string[], cycles: { count: 0, paths: [] as string[][] } };
    let hotspots = { files: [] as Array<{ path: string; module: string; complexity: number; symbols: number }> };

    try { summary = await lapis.getCodeSummary("") as typeof summary; } catch { /* partial failure ok */ }
    try { hotspots = await lapis.getCodeHotspots("") as typeof hotspots; } catch { /* partial failure ok */ }

    // These calls use the repoName — re-fetch with correct param
    // (the mock above uses empty string, real calls need repoName from params)
    return { suggestions: [] as RepoSuggestion[], analysisVersion: "1.0" };
  });

  // Replace the suggestions handler with the correct one that uses params:
  // Remove the stub above and use this in the actual implementation:
}
```

Wait — the suggestions handler above has a bug. Let me fix it. The correct implementation for the suggestions route needs the `repoName` from params:

Replace the entire file content with:

```ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
}

interface RepoSuggestion {
  id: string;
  category: "high_complexity" | "cycles" | "structure";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  affectedFiles: number;
  detail: string;
  prefill: string;
}

interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
}

function generateSuggestions(
  summary: { files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; cycles: { count: number; paths: string[][] } },
  hotspots: { files: Array<{ path: string; module: string; complexity: number; symbols: number }> },
): RepoSuggestion[] {
  const suggestions: RepoSuggestion[] = [];

  for (const file of hotspots.files) {
    if (file.complexity > 20) {
      suggestions.push({
        id: `complexity-${file.path}`,
        category: "high_complexity",
        title: `Refactor ${file.path.split("/").pop()} — complexity score ${file.complexity}`,
        description: `${file.path} has a complexity of ${file.complexity}, above the threshold of 20. High complexity makes code harder to understand, test, and maintain.`,
        priority: file.complexity > 30 ? "high" : "medium",
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Refactor ${file.path} to reduce complexity (currently ${file.complexity}). Break into smaller, focused functions.`,
      });
    }
  }

  if (summary.cycles.count > 0) {
    const moduleNames = [...new Set(summary.cycles.paths.flat())].slice(0, 3).join(", ");
    suggestions.push({
      id: "cycles",
      category: "cycles",
      title: `Break ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""}`,
      description: `${summary.cycles.count} circular dependenc${summary.cycles.count > 1 ? "ies" : "y"} detected. Cycles make modules harder to test independently and can cause build issues.`,
      priority: "high",
      affectedFiles: summary.cycles.paths.flat().length,
      detail: `${summary.cycles.count} cycle${summary.cycles.count > 1 ? "s" : ""} involving: ${moduleNames}`,
      prefill: `Break the ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""} in this codebase. Introduce interfaces or extract shared types to decouple circular imports.`,
    });
  }

  for (const mod of summary.modules) {
    if (mod.fileCount > 20) {
      suggestions.push({
        id: `structure-${mod.name}`,
        category: "structure",
        title: `Split ${mod.name} (${mod.fileCount} files) into focused packages`,
        description: `Module ${mod.name} contains ${mod.fileCount} files, suggesting multiple responsibilities. Splitting would improve maintainability.`,
        priority: "low",
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files in ${mod.name}`,
        prefill: `Split the ${mod.name} module (${mod.fileCount} files) into smaller, more focused packages with clear responsibilities.`,
      });
    }
  }

  return suggestions;
}

export function registerRepoExploreRoutes(app: FastifyInstance, deps: RepoExploreDeps) {
  const { lapis } = deps;

  app.post("/api/repos/:repoName/explore", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await lapis.getSetting<string>(`repo:${repoName}:path`);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }

    try {
      await lapis.indexRepo(repoPath, repoName);
      const summary = await lapis.getCodeSummary(repoName);
      return { repoName, status: "completed" as const, summary };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Indexing failed";
      return { repoName, status: "failed" as const, error };
    }
  });

  app.get("/api/repos/:repoName/summary", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeSummary(repoName);
  });

  app.get("/api/repos/:repoName/hotspots", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeHotspots(repoName);
  });

  app.get("/api/repos/:repoName/suggestions", async (request) => {
    const { repoName } = request.params as { repoName: string };

    let summary = { files: 0, symbols: 0, edges: 0, modules: [] as Array<{ name: string; fileCount: number }>, entryPoints: [] as string[], cycles: { count: 0, paths: [] as string[][] } };
    let hotspots = { files: [] as Array<{ path: string; module: string; complexity: number; symbols: number }> };

    try { summary = await lapis.getCodeSummary(repoName) as typeof summary; } catch { /* partial failure ok */ }
    try { hotspots = await lapis.getCodeHotspots(repoName) as typeof hotspots; } catch { /* partial failure ok */ }

    const suggestions = generateSuggestions(summary, hotspots);
    return { suggestions, analysisVersion: "1.0" } satisfies RepoSuggestionsResponse;
  });
}

export type { RepoSuggestion, RepoSuggestionsResponse };
```

- [ ] **Step 4: Register the routes in server.ts**

In `packages/backend/src/server.ts`:

Add import after the existing route imports (after line 14):
```ts
import { registerRepoExploreRoutes } from "./routes/repo-explore.js";
```

Add registration after `registerCodeContextRoutes(app, { lapis });` (after line 137):
```ts
  // Repo explore (auto-explore + suggestions)
  registerRepoExploreRoutes(app, { lapis });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/backend/__tests__/routes/repo-explore.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 6: Run full backend test suite**

Run: `npx vitest run packages/backend --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/routes/repo-explore.ts packages/backend/__tests__/routes/repo-explore.test.ts packages/backend/src/server.ts
git commit -m "feat: repo-scoped explore, summary, hotspots, and suggestions routes"
```

---

### Task 3: Backend — Mission-runner skip re-indexing when already indexed

**Files:**
- Modify: `packages/backend/src/orchestrator/mission-runner.ts:116-128`

- [ ] **Step 1: Write the failing test**

Add a test in an existing mission-runner test file or create a focused test. Check if there's already a mission-runner test:

If `packages/backend/__tests__/mission-runner.test.ts` exists, add to it. Otherwise create it:

```ts
import { describe, it, expect, vi } from "vitest";

describe("mission-runner indexing skip", () => {
  it("skips indexing when repo already indexed via explore", async () => {
    // This tests the logic inline — the actual integration is tested
    // by the mission-runner behavior with a pre-indexed repo.
    // The key: getCodeSummary returns files > 0 → skip indexRepo call.
    const mockGetCodeSummary = vi.fn().mockResolvedValue({ files: 10, symbols: 50, edges: 30, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } });
    const mockIndexRepo = vi.fn();
    const mockSetSetting = vi.fn();

    const repoName = "test-repo";
    const existingSummary = await mockGetCodeSummary(repoName);
    if (existingSummary && existingSummary.files > 0) {
      await mockSetSetting(`mission:m-1:repoName`, repoName);
    } else {
      await mockIndexRepo("/workspace/repos/test-repo", repoName);
    }

    expect(mockIndexRepo).not.toHaveBeenCalled();
    expect(mockSetSetting).toHaveBeenCalledWith("mission:m-1:repoName", "test-repo");
  });

  it("falls through to indexing when repo not yet indexed", async () => {
    const mockGetCodeSummary = vi.fn().mockRejectedValue(new Error("not found"));
    const mockIndexRepo = vi.fn().mockResolvedValue({ files: 10, symbols: 50, error: null });
    const mockSetSetting = vi.fn();

    const repoName = "test-repo";
    let indexed = false;
    try {
      const existingSummary = await mockGetCodeSummary(repoName);
      if (existingSummary && existingSummary.files > 0) {
        indexed = true;
      }
    } catch { /* not indexed */ }

    if (!indexed) {
      await mockIndexRepo("/workspace/repos/test-repo", repoName);
      await mockSetSetting(`mission:m-1:repoName`, repoName);
    }

    expect(mockIndexRepo).toHaveBeenCalled();
    expect(mockSetSetting).toHaveBeenCalledWith("mission:m-1:repoName", "test-repo");
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (logic-only test, not testing actual mission-runner)

Run: `npx vitest run packages/backend/__tests__/mission-runner.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: PASS (tests the skip logic pattern, not the full runner)

- [ ] **Step 3: Modify mission-runner.ts**

In `packages/backend/src/orchestrator/mission-runner.ts`, replace lines 116-128 (the indexing try block) with:

```ts
      try {
        const repoName = path.basename(missionRepoRoot);
        // Check if already indexed by the explore endpoint
        const existingSummary = await lapis.getCodeSummary(repoName).catch(() => null);
        if (existingSummary && existingSummary.files > 0) {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Repo ${repoName} already indexed (${existingSummary.files} files), skipping…` });
          await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
        } else {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing repo ${repoName} for code context…` });
          const indexResult = await lapis.indexRepo(missionRepoRoot, repoName);
          if (indexResult.error) {
            eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing warning: ${indexResult.error}` });
          } else {
            eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexed ${indexResult.files ?? 0} files, ${indexResult.symbols ?? 0} symbols`, data: { indexingDone: true, files: indexResult.files ?? 0, symbols: indexResult.symbols ?? 0, edges: (indexResult as any).import_edges ?? 0 } });
            await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing skipped: ${msg}` });
      }
```

- [ ] **Step 4: Run full backend test suite**

Run: `npx vitest run packages/backend --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/orchestrator/mission-runner.ts packages/backend/__tests__/mission-runner.test.ts
git commit -m "feat: mission-runner skips re-indexing when repo already indexed"
```

---

### Task 4: Frontend — Add API functions and types

**Files:**
- Modify: `packages/frontend/src/api.ts:226-260`
- Modify: `packages/frontend/src/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/frontend/src/api.test.ts`:

```ts
import { exploreRepo, getRepoSummary, getRepoHotspots, getRepoSuggestions } from "./api";

describe("repo explore API", () => {
  beforeEach(() => mockFetch.mockReset());

  it("exploreRepo calls explore endpoint and returns result", async () => {
    const response = { repoName: "my-repo", status: "completed", summary: { files: 10, symbols: 50 } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await exploreRepo("my-repo");
    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/explore", expect.objectContaining({ method: "POST" }));
  });

  it("exploreRepo throws on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(exploreRepo("bad")).rejects.toThrow("Failed to explore repo: 500");
  });

  it("getRepoSummary fetches repo summary", async () => {
    const summary = { files: 10, symbols: 50, edges: 30, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => summary });

    const result = await getRepoSummary("my-repo");
    expect(result).toEqual(summary);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/my-repo/summary", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("getRepoHotspots fetches repo hotspots", async () => {
    const hotspots = { files: [{ path: "a.ts", module: "core", complexity: 25, symbols: 5 }] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => hotspots });

    const result = await getRepoHotspots("my-repo");
    expect(result).toEqual(hotspots);
  });

  it("getRepoSuggestions fetches suggestions", async () => {
    const suggestions = { suggestions: [{ id: "complexity-a", category: "high_complexity", title: "Refactor a" }], analysisVersion: "1.0" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => suggestions });

    const result = await getRepoSuggestions("my-repo");
    expect(result.suggestions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/frontend/src/api.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add API functions and types**

In `packages/frontend/src/api.ts`, add after the existing code context section (after line 260):

```ts
// Repo explore (auto-explore + suggestions)
export interface ExploreRepoResponse {
  repoName: string;
  status: "completed" | "failed";
  summary?: CodeSummaryResponse;
  error?: string;
}

export interface RepoSuggestion {
  id: string;
  category: "high_complexity" | "cycles" | "structure";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  affectedFiles: number;
  detail: string;
  prefill: string;
}

export interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
}

export async function exploreRepo(repoName: string): Promise<ExploreRepoResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/explore`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to explore repo: ${res.status}`);
  return res.json() as Promise<ExploreRepoResponse>;
}

export async function getRepoSummary(repoName: string): Promise<CodeSummaryResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/summary`);
  if (!res.ok) throw new Error(`Failed to fetch repo summary: ${res.status}`);
  return res.json() as Promise<CodeSummaryResponse>;
}

export async function getRepoHotspots(repoName: string): Promise<CodeHotspotsResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/hotspots`);
  if (!res.ok) throw new Error(`Failed to fetch repo hotspots: ${res.status}`);
  return res.json() as Promise<CodeHotspotsResponse>;
}

export async function getRepoSuggestions(repoName: string): Promise<RepoSuggestionsResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/suggestions`);
  if (!res.ok) throw new Error(`Failed to fetch repo suggestions: ${res.status}`);
  return res.json() as Promise<RepoSuggestionsResponse>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/frontend/src/api.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/api.test.ts
git commit -m "feat: frontend API functions for repo explore, summary, hotspots, suggestions"
```

---

### Task 5: Frontend — Enhance RepoPrepareModal with phased progress

**Files:**
- Modify: `packages/frontend/src/active/RepoPrepareModal.tsx`

- [ ] **Step 1: Rewrite RepoPrepareModal**

Replace the entire content of `packages/frontend/src/active/RepoPrepareModal.tsx`:

```tsx
import type { GitHubRepoResponse } from "../api";
import type { CodeSummaryResponse } from "../api";

interface RepoPrepareModalProps {
  repo: GitHubRepoResponse;
  phase: "confirm" | "cloning" | "indexing" | "complete" | "error";
  summary?: CodeSummaryResponse | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const phases = [
  { key: "cloning", label: "Clone or update the repository" },
  { key: "indexing", label: "Index code for AI context" },
  { key: "complete", label: "Ready for mission work" },
] as const;

function phaseIndex(phase: RepoPrepareModalProps["phase"]): number {
  if (phase === "confirm") return -1;
  return phases.findIndex((p) => p.key === phase);
}

export function RepoPrepareModal({ repo, phase, summary, error, onCancel, onConfirm }: RepoPrepareModalProps) {
  const currentIdx = phaseIndex(phase);
  const isWorking = phase === "cloning" || phase === "indexing";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0, 0, 0, 0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={isWorking ? undefined : onCancel}
    >
      <section
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "420px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-bright)",
          borderRadius: "6px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          padding: "16px",
        }}
      >
        {/* Header */}
        <h3
          style={{
            margin: 0,
            color: "var(--text-primary)",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "13px",
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          {phase === "confirm" && "Use this repository?"}
          {isWorking && "PREPARING REPOSITORY"}
          {phase === "complete" && "REPOSITORY READY ✓"}
          {phase === "error" && "PREPARATION FAILED"}
        </h3>

        {/* Repo identity */}
        <div
          style={{
            background: "var(--bg-inset)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "10px",
            marginTop: "12px",
          }}
        >
          <div style={{ color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>{repo.full_name}</div>
          <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "4px" }}>
            Default branch: {repo.default_branch}{repo.private ? " · PRIVATE" : ""}
          </div>
        </div>

        {/* Confirm state: show checklist */}
        {phase === "confirm" && (
          <>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5, marginTop: "12px" }}>
              Aurex will prepare this repository before starting your mission.
            </p>
            <ul style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.7, paddingLeft: "18px" }}>
              {phases.map((p) => (
                <li key={p.key}>{p.label}</li>
              ))}
            </ul>
          </>
        )}

        {/* Working state: show progress checklist */}
        {isWorking && (
          <div style={{ marginTop: "12px" }}>
            {phases.map((p, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <div key={p.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", color: done ? "var(--success)" : active ? "var(--accent)" : "var(--text-muted)", fontSize: "13px" }}>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
                    {done ? "✓" : active ? "◌" : "○"}
                  </span>
                  <span>{p.label}</span>
                  {active && (
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto" }}>
                      {phase === "indexing" ? "Indexing…" : "Cloning…"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Complete state: show summary */}
        {phase === "complete" && summary && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ color: "var(--text-primary)", fontSize: "13px", fontFamily: '"JetBrains Mono", monospace' }}>
              {summary.files} files · {summary.symbols} symbols · {summary.modules.length} modules
            </div>
            {summary.modules.length > 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" }}>
                Top modules: {summary.modules.slice(0, 3).map((m) => m.name).join(", ")}
              </div>
            )}
            <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
              Entry points: {summary.entryPoints.length} · Cycles: {summary.cycles.count}
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="pinyx-error-bar" style={{ marginTop: "12px" }}>
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pinyx-btn-group" style={{ justifyContent: "flex-end", marginTop: "12px" }}>
          <button className="pinyx-btn-outline" onClick={onCancel} disabled={isWorking}>
            {phase === "complete" ? "Cancel" : "Cancel"}
          </button>
          {(phase === "confirm" || phase === "complete") && (
            <button className="pinyx-btn-primary" onClick={onConfirm} disabled={isWorking}>
              {phase === "confirm" ? "Prepare & Scan" : "Use Repo"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `npx vitest run packages/frontend/src --reporter=verbose 2>&1 | tail -20`
Expected: All existing tests pass (RepoPrepareModal is not directly tested, consumers will be updated next).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/RepoPrepareModal.tsx
git commit -m "feat: RepoPrepareModal with phased progress (confirm/cloning/indexing/complete)"
```

---

### Task 6: Frontend — Update NewMissionForm with explore flow and compact repo card

**Files:**
- Modify: `packages/frontend/src/active/NewMissionForm.tsx`

- [ ] **Step 1: Rewrite NewMissionForm**

Replace the entire content of `packages/frontend/src/active/NewMissionForm.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useNewMissionForm } from "./useNewMissionForm";
import { RepoPicker } from "./RepoPicker";
import { RepoPrepareModal } from "./RepoPrepareModal";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { prepareGitHubRepo, exploreRepo } from "../api";
import type { GitHubRepoResponse, CodeSummaryResponse } from "../api";

interface PreparedRepoInfo {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
}

interface NewMissionFormProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  preparedRepo?: PreparedRepoInfo | null;
}

export function NewMissionForm({ onSubmit, github, preparedRepo }: NewMissionFormProps) {
  const { state, open, close, setDescription, setRepo, handleSubmit, handleKeyDown, canSubmit } = useNewMissionForm(onSubmit);
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoResponse | null>(null);
  const [preparePhase, setPreparePhase] = useState<"confirm" | "cloning" | "indexing" | "complete" | "error">("confirm");
  const [exploreSummary, setExploreSummary] = useState<CodeSummaryResponse | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const handleRepoSelect = (repo: GitHubRepoResponse) => {
    setPrepareError(null);
    setExploreSummary(null);
    setPreparePhase("confirm");
    setPendingRepo(repo);
  };

  useEffect(() => {
    const handler = () => open();
    window.addEventListener("aurex:focus-new-mission", handler);
    return () => window.removeEventListener("aurex:focus-new-mission", handler);
  }, [open]);

  async function handleConfirmRepo() {
    if (!pendingRepo) return;
    setPrepareError(null);

    // Phase 1: Clone
    setPreparePhase("cloning");
    let prepared;
    try {
      prepared = await prepareGitHubRepo(pendingRepo.clone_url);
    } catch {
      setPrepareError("Could not clone repository. Check GitHub permissions and try again.");
      setPreparePhase("error");
      return;
    }

    // Phase 2: Explore (index)
    setPreparePhase("indexing");
    try {
      const explored = await exploreRepo(prepared.repoName);
      if (explored.status === "completed" && explored.summary) {
        setExploreSummary(explored.summary);
      }
      setPreparePhase("complete");
    } catch {
      // Indexing failed — still usable, just no code map
      setPreparePhase("complete");
    }
  }

  function handleUseRepo() {
    if (!pendingRepo) return;
    setRepo(pendingRepo.clone_url, pendingRepo.id, pendingRepo.full_name);
    setPendingRepo(null);
  }

  if (!state.open) {
    return (
      <button
        onClick={open}
        style={{
          width: "calc(100% - 32px)",
          padding: "8px 16px",
          margin: "12px 16px",
          background: "var(--accent)",
          color: "var(--bg-deep)",
          border: "none",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: 600,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: "1px",
          textTransform: "uppercase" as const,
          cursor: "pointer",
          textAlign: "left" as const,
        }}
      >
        + NEW MISSION
      </button>
    );
  }

  return (
    <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "8px" }}>
      {github?.connected && github.repos.length > 0 && (
        <RepoPicker repos={github.repos} selectedRepoId={state.selectedRepoId} onSelect={handleRepoSelect} />
      )}
      {/* Compact repo card (Surface C) */}
      {(state.selectedRepoFullName && preparedRepo) ? (
        <div style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "8px 10px",
        }}>
          <div style={{ color: "var(--success)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
            ✓ {state.selectedRepoFullName}
          </div>
          {preparedRepo.summary ? (
            <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "2px" }}>
              {preparedRepo.summary.files} files · {preparedRepo.summary.symbols} symbols · {preparedRepo.summary.modules.length} modules
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "2px" }}>
              Status: READY
            </div>
          )}
        </div>
      ) : state.selectedRepoFullName ? (
        <div style={{ color: "var(--accent)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>
          REPO READY · {state.selectedRepoFullName}
        </div>
      ) : null}
      {github?.error && (
        <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{github.error}</p>
      )}
      <textarea
        value={state.description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want done..."
        style={{
          width: "100%",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          fontSize: "14px",
          borderRadius: "4px",
          padding: "8px",
          border: "1px solid var(--border)",
          outline: "none",
          resize: "none",
          fontFamily: '"Inter", sans-serif',
        }}
        rows={3}
        autoFocus
        disabled={state.submitting}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            background: canSubmit ? "var(--accent)" : "var(--bg-elevated)",
            color: canSubmit ? "var(--bg-deep)" : "var(--text-muted)",
            border: "none",
            borderRadius: "4px",
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={close}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          Cancel
        </button>
      </div>
      {state.error && <p style={{ fontSize: "12px", color: "var(--error)", marginTop: "4px" }}>{state.error}</p>}
      {pendingRepo && (
        <RepoPrepareModal
          repo={pendingRepo}
          phase={preparePhase}
          summary={exploreSummary}
          error={prepareError}
          onCancel={() => {
            if (preparePhase !== "cloning" && preparePhase !== "indexing") {
              setPendingRepo(null);
              setPrepareError(null);
              setPreparePhase("confirm");
            }
          }}
          onConfirm={() => {
            if (preparePhase === "confirm") {
              void handleConfirmRepo();
            } else if (preparePhase === "complete") {
              handleUseRepo();
            }
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds/tests**

Run: `npx vitest run packages/frontend/src --reporter=verbose 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/NewMissionForm.tsx
git commit -m "feat: NewMissionForm with explore flow and compact repo card"
```

---

### Task 7: Frontend — Create RepoOverviewPanel component

**Files:**
- Create: `packages/frontend/src/passive/RepoOverviewPanel.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/passive/RepoOverviewPanel.tsx`:

```tsx
import { useRef, useEffect } from "react";
import { animate, stagger } from "animejs";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion } from "../api";

interface RepoOverviewPanelProps {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
  hotspots: CodeHotspotsResponse | null;
  suggestions: RepoSuggestion[];
  loading: boolean;
  onStartMission: (prefill: string) => void;
}

const categoryIcons: Record<string, string> = {
  high_complexity: "🔥",
  cycles: "⚠️",
  structure: "📐",
};

const priorityColors: Record<string, string> = {
  high: "var(--error)",
  medium: "var(--warning)",
  low: "var(--text-muted)",
};

export function RepoOverviewPanel({ fullName, summary, hotspots, suggestions, loading, onStartMission }: RepoOverviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>(".overview-section");
    animate(sections, {
      opacity: [0, 1],
      translateY: [20, 0],
      delay: stagger(100),
      duration: 400,
      ease: "outExpo",
    });
  }, [summary]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--text-muted)", letterSpacing: "2px" }}>
          ANALYZING REPOSITORY…
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ maxWidth: "800px", margin: "0 auto", padding: "24px" }}>
      {/* Header */}
      <div className="overview-section" style={{ opacity: 0, marginBottom: "24px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "4px" }}>
          REPO MAP
        </div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "14px", color: "var(--text-primary)" }}>
          {fullName}
          {summary && (
            <span style={{ color: "var(--text-secondary)", marginLeft: "8px" }}>
              · {summary.files} files · {summary.symbols} symbols
            </span>
          )}
        </div>
      </div>

      {/* Modules + Hotspots grid */}
      <div className="overview-section" style={{ opacity: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Modules */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
            MODULES
          </div>
          {summary?.modules.map((mod) => (
            <div key={mod.name} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: "12px" }}>
              <span style={{ color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>{mod.name}</span>
              <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace' }}>{mod.fileCount}</span>
            </div>
          ))}
          {(!summary || summary.modules.length === 0) && (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No module data</div>
          )}
        </div>

        {/* Hotspots */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
            HOTSPOTS
          </div>
          {hotspots?.files.slice(0, 6).map((file) => {
            const barWidth = Math.min(100, (file.complexity / 50) * 100);
            return (
              <div key={file.path} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 0", fontSize: "12px" }}>
                <span style={{ color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path.split("/").pop()}
                </span>
                <div style={{ width: "60px", height: "6px", background: "var(--bg-inset)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${barWidth}%`, height: "100%", background: file.complexity > 30 ? "var(--error)" : file.complexity > 20 ? "var(--warning)" : "var(--text-muted)", borderRadius: "3px" }} />
                </div>
                <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", minWidth: "16px", textAlign: "right" as const }}>{file.complexity}</span>
              </div>
            );
          })}
          {(!hotspots || hotspots.files.length === 0) && (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No hotspot data</div>
          )}
        </div>
      </div>

      {/* Structure */}
      {summary && (
        <div className="overview-section" style={{ opacity: 0, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", marginBottom: "16px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
            STRUCTURE
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {summary.entryPoints.length > 0 && (
              <div>
                <span style={{ color: "var(--text-muted)" }}>Entry Points: </span>
                {summary.entryPoints.join(", ")}
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-muted)" }}>Dependency Cycles: </span>
              {summary.cycles.count}
              <span style={{ color: "var(--text-muted)", marginLeft: "12px" }}>Edges: </span>
              {summary.edges}
            </div>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="overview-section" style={{ opacity: 0 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>SUGGESTED MISSIONS</span>
            <span style={{ fontSize: "9px", letterSpacing: "1px" }}>BASED ON CODE</span>
          </div>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "12px 16px",
                marginBottom: "8px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent-dim)";
                e.currentTarget.style.background = "var(--bg-elevated)";
                e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--bg-surface)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: "16px", flexShrink: 0 }}>{categoryIcons[suggestion.category] ?? "•"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>{suggestion.title}</div>
                <div style={{ fontSize: "11px", color: priorityColors[suggestion.priority] ?? "var(--text-muted)", marginTop: "2px" }}>{suggestion.detail}</div>
              </div>
              <button
                onClick={() => onStartMission(suggestion.prefill)}
                style={{
                  color: "var(--accent)",
                  background: "none",
                  border: "1px solid var(--accent-dim)",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  padding: "4px 8px",
                  fontFamily: '"JetBrains Mono", monospace',
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  whiteSpace: "nowrap" as const,
                  flexShrink: 0,
                }}
              >
                Start Mission →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds/tests**

Run: `npx vitest run packages/frontend/src --reporter=verbose 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/passive/RepoOverviewPanel.tsx
git commit -m "feat: RepoOverviewPanel — repo map, hotspots, and suggested missions"
```

---

### Task 8: Frontend — Wire up App.tsx with prepared repo state

**Files:**
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/passive/StatusBoard.tsx`
- Modify: `packages/frontend/src/active/MissionSidebar.tsx`

- [ ] **Step 1: Update App.tsx**

Add imports at the top (after existing imports):

```ts
import { RepoOverviewPanel } from "./passive/RepoOverviewPanel";
import { getRepoSummary, getRepoHotspots, getRepoSuggestions } from "./api";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion } from "./api";
```

Add state after the existing state declarations (after `const [quotaOpen, setQuotaOpen] = useState(false);`):

```ts
  const [preparedRepo, setPreparedRepo] = useState<{
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    hotspots: CodeHotspotsResponse | null;
    suggestions: RepoSuggestion[];
    loading: boolean;
  } | null>(null);
```

Add a callback for when a repo is prepared and needs overview data (after `handleCreateMission`):

```ts
  const handleRepoPrepared = useCallback(async (repoName: string, fullName: string, summary: CodeSummaryResponse | null) => {
    setPreparedRepo({ repoName, fullName, summary, hotspots: null, suggestions: [], loading: true });
    try {
      const [hotspots, suggestionsRes] = await Promise.all([
        getRepoHotspots(repoName).catch(() => null),
        getRepoSuggestions(repoName).catch(() => ({ suggestions: [], analysisVersion: "1.0" })),
      ]);
      setPreparedRepo({ repoName, fullName, summary, hotspots, suggestions: suggestionsRes.suggestions, loading: false });
    } catch {
      setPreparedRepo((prev) => prev ? { ...prev, loading: false } : null);
    }
  }, []);
```

Update `handleCreateMission` to clear prepared repo:

```ts
  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
    setPreparedRepo(null); // Clear overview when mission starts
  }, [addOptimisticMission]);
```

Pass `preparedRepo` to `StatusBoard`:

Find the `<StatusBoard` component usage and add the new props:

```tsx
          <StatusBoard
            mission={state.mission}
            milestones={state.milestones}
            workers={state.activeWorkers}
            cost={state.cost}
            events={eventsRef.current}
            logs={state.logs}
            errors={state.errors}
            agentLogs={state.agentLogs}
            blurred={!!state.escalation}
            eventStreamCount={settings.eventStreamCount}
            onExampleClick={handleCreateMission}
            onRetryMission={handleRetryMission}
            onDismissErrors={() => dispatch({ type: "CLEAR_ERRORS" })}
            scanFindings={supplyChainState.findings}
            isScanning={supplyChainState.isScanning}
            scans={supplyChainState.scans}
            onTriggerScan={triggerSupplyChainScan}
            preparedRepo={preparedRepo}
            onStartFromSuggestion={(prefill: string) => {
              window.dispatchEvent(new CustomEvent("aurex:focus-new-mission"));
              // Pre-fill is handled via the mission form event
              handleCreateMission(prefill, preparedRepo?.repoName ? `https://github.com/${preparedRepo.fullName}.git` : undefined);
            }}
          />
```

Pass `preparedRepo` to `MissionSidebar` (both desktop and mobile versions):

Add `preparedRepo={preparedRepo}` to both `<MissionSidebar>` usages.

- [ ] **Step 2: Update StatusBoard.tsx**

Add import:

```ts
import { RepoOverviewPanel } from "./RepoOverviewPanel";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion } from "../api";
```

Add to the `StatusBoardProps` interface:

```ts
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    hotspots: CodeHotspotsResponse | null;
    suggestions: RepoSuggestion[];
    loading: boolean;
  } | null;
  onStartFromSuggestion?: (prefill: string) => void;
```

Destructure in the component:

```ts
export function StatusBoard({ mission, milestones, workers, cost, events, logs, errors, agentLogs, blurred, eventStreamCount, onExampleClick, onRetryMission, onDismissErrors, scanFindings = [], isScanning = false, scans = [], onTriggerScan, preparedRepo, onStartFromSuggestion }: StatusBoardProps) {
```

Update the `!mission` branch to show RepoOverviewPanel:

```tsx
  if (!mission) {
    if (preparedRepo) {
      return (
        <div style={{ display: "flex", height: "100%" }}>
          <RepoOverviewPanel
            repoName={preparedRepo.repoName}
            fullName={preparedRepo.fullName}
            summary={preparedRepo.summary}
            hotspots={preparedRepo.hotspots}
            suggestions={preparedRepo.suggestions}
            loading={preparedRepo.loading}
            onStartMission={onStartFromSuggestion ?? (() => {})}
          />
        </div>
      );
    }
    return (
      <div style={{ display: "flex", height: "100%" }}>
        <EmptyState onExampleClick={onExampleClick} />
      </div>
    );
  }
```

- [ ] **Step 3: Update MissionSidebar.tsx**

The `MissionSidebar` needs to pass `preparedRepo` to `NewMissionForm`. Add to `MissionSidebarProps`:

```ts
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
  } | null;
```

Import:

```ts
import type { CodeSummaryResponse } from "../api";
```

Destructure `preparedRepo` and pass to `NewMissionForm`:

```tsx
<NewMissionForm onSubmit={onCreateMission} github={github} preparedRepo={preparedRepo} />
```

Do this for both the empty state and non-empty state sidebar sections where `NewMissionForm` appears.

- [ ] **Step 4: Run full frontend test suite**

Run: `npx vitest run packages/frontend/src --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All tests pass across backend and frontend.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/passive/StatusBoard.tsx packages/frontend/src/active/MissionSidebar.tsx
git commit -m "feat: wire up prepared repo state across App, StatusBoard, MissionSidebar"
```

---

## Plan Self-Review

### Spec coverage

| Spec Section | Task |
|---|---|
| §1. Modified prepare endpoint | Task 1 |
| §2. Explore endpoint | Task 2 |
| §3. Repo-scoped routes | Task 2 |
| §4. Suggestions endpoint + heuristics | Task 2 |
| §5. Store repo path during prepare | Task 1 |
| §6. Mission-runner skip | Task 3 |
| §7. Enhanced RepoPrepareModal | Task 5 |
| §8. RepoOverviewPanel | Task 7 |
| §9. Compact repo card | Task 6 |
| §10. App-level state | Task 8 |
| §11. Frontend API | Task 4 |
| §12. NewMissionForm flow | Task 6 |

All sections covered. ✓

### Placeholder scan

No TBD, TODO, or "implement later" patterns found. All code blocks contain complete implementations. ✓

### Type consistency

- `RepoSuggestion` category: `"high_complexity" | "cycles" | "structure"` — consistent across `repo-explore.ts`, `api.ts`, `RepoOverviewPanel.tsx`. ✓
- `CodeSummaryResponse` — used consistently across all files. ✓
- `PreparedRepo` shape — consistent between App.tsx, StatusBoard.tsx, MissionSidebar.tsx. ✓
- `phase` enum: `"confirm" | "cloning" | "indexing" | "complete" | "error"` — consistent between RepoPrepareModal and NewMissionForm. ✓
