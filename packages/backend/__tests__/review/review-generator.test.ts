import { describe, it, expect, vi } from "vitest";
import { runReview } from "../../src/review/review-generator.js";
import type { LaPisClient } from "../../src/clients/lapis-client.js";
import type { BumblebeeScanResult } from "@aurex/shared";

function mockLapis(settings: Record<string, unknown>): LaPisClient {
  const store = new Map(Object.entries(settings));
  return {
    ping: async () => {},
    getSetting: async (key: string) => store.get(key) as never,
    setSetting: async (key: string, value: unknown) => { store.set(key, value); },
    indexRepo: async () => ({}),
    getCodeSummary: async () => ({
      files: 2,
      symbols: 10,
      edges: 5,
      modules: [{ name: "src", fileCount: 2 }],
      entryPoints: ["index.ts"],
      cycles: { count: 0, paths: [] },
    }),
    getCodeHotspots: async () => ({ files: [] }),
    getCodeGraph: async () => ({ nodes: [], edges: [] }),
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

describe("runReview", () => {
  it("retries Bumblebee when the cached scan failed recently", async () => {
    const failedScan: BumblebeeScanResult = {
      id: "failed-scan",
      missionId: "repo:my-repo",
      profile: "project",
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const lapis = mockLapis({
      "repo:my-repo:path": process.cwd(),
      "repo:my-repo:bumblebee_scans": { scanIds: ["failed-scan"] },
      "bumblebee_scan:failed-scan": failedScan,
    });
    const scan = vi.fn().mockResolvedValue({
      packages: [{ scanId: "new-scan", ecosystem: "npm" }],
      findings: [{
        id: "pkg/find/1",
        scanId: "new-scan",
        missionId: "repo:my-repo",
        findingType: "cve",
        severity: "high",
        catalogId: "c1",
        catalogName: "CVE",
        ecosystem: "npm",
        packageName: "bad-pkg",
        normalizedName: "bad-pkg",
        version: "1.0.0",
        sourceType: "dependency",
        sourceFile: "package.json",
        confidence: "high",
        evidence: "test",
      }],
    });
    const { report } = await runReview({
      lapis,
      bumblebeeClient: { scan },
      buildReadinessProfile: async (repoName) => ({
        repoName,
        profile: "node",
        packageManager: "pnpm",
        languages: ["TypeScript"],
        frameworks: [],
        monorepo: false,
        lockfiles: [],
        commands: [],
        blockers: [],
        warnings: [],
        confidence: "high",
        generatedAt: new Date().toISOString(),
      }),
    }, "my-repo");

    expect(scan).toHaveBeenCalledOnce();
    expect(report.issues.some((i) => i.category === "security")).toBe(true);
  });
});
