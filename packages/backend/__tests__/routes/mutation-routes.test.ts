import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerMutationRoutes } from "../../src/routes/mutation-routes.js";
import { readFileSync } from "node:fs";
import { createEventBus } from "../../src/ws/events.js";
import type { LaPisClient } from "../../src/clients/lapis-client.js";

function createMockLapis(getRepoPathImpl: (repoName: string) => Promise<string | null>): LaPisClient {
  return {
    getRepoPath: vi.fn().mockImplementation(getRepoPathImpl),
  } as unknown as LaPisClient;
}

const FIXTURES = join(import.meta.dirname, "..", "..", "src", "scanner", "__tests__", "fixtures");

describe("mutationRoutes", () => {
  let repoDir: string;
  let app: ReturnType<typeof Fastify>;
  let mockLapis: LaPisClient;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "aurex-mutation-routes-"));
    mockLapis = createMockLapis(async () => repoDir);
    app = Fastify();
    const eventBus = createEventBus();
    registerMutationRoutes(app, { lapis: mockLapis, eventBus });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(repoDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("GET /api/repos/:repoName/mutation", () => {
    it("returns configured=false for repos without Stryker", async () => {
      const res = await app.inject({ method: "GET", url: "/api/repos/test/mutation" });
      expect(res.statusCode).toBe(200);
      expect(res.json().strykerConfigured).toBe(false);
    });

    it("returns score from existing report", async () => {
      writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
      mkdirSync(join(repoDir, "reports"));
      writeFileSync(join(repoDir, "reports", "stryker-report.json"),
        readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8"));
      const res = await app.inject({ method: "GET", url: "/api/repos/test/mutation" });
      expect(res.json().score).toBeCloseTo(66.67, 1);
    });

    it("returns 404 when the repo is not known to LaPis", async () => {
      mockLapis = createMockLapis(async () => null);
      // Re-register with the new mock
      await app.close();
      app = Fastify();
      const eventBus = createEventBus();
      registerMutationRoutes(app, { lapis: mockLapis, eventBus });
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/api/repos/unknown/mutation" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/repos/:repoName/mutation/run", () => {
    it("returns 400 when Stryker is not configured", async () => {
      const res = await app.inject({ method: "POST", url: "/api/repos/test/mutation/run" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/not configured/i);
    });

    it("returns 404 when the repo is not known to LaPis", async () => {
      mockLapis = createMockLapis(async () => null);
      await app.close();
      app = Fastify();
      const eventBus = createEventBus();
      registerMutationRoutes(app, { lapis: mockLapis, eventBus });
      await app.ready();
      const res = await app.inject({ method: "POST", url: "/api/repos/unknown/mutation/run" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 202 with runId when Stryker is configured", async () => {
      writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
      mkdirSync(join(repoDir, "reports"));
      writeFileSync(join(repoDir, "reports", "stryker-report.json"),
        readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8"));
      const res = await app.inject({ method: "POST", url: "/api/repos/test/mutation/run" });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.status).toBe("starting");
    });
  });
});
