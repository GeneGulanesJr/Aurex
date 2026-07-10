import { describe, it, expect, beforeEach } from "vitest";
import { saveReview, getLatestReview, getReview, updateIssueStatus } from "../../src/review/review-store.js";
import type { LaPisClient } from "../../src/clients/lapis-client.js";
import type { ReviewReport } from "@aurex/shared";

function mockLapis(): LaPisClient {
  const settings = new Map<string, unknown>();
  return {
    ping: async () => {},
    getSetting: async (key: string) => settings.get(key) as never,
    setSetting: async (key: string, value: unknown) => { settings.set(key, value); },
    indexRepo: async () => ({}),
    getCodeSummary: async () => ({ files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } }),
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

function sampleReport(id: string): ReviewReport {
  return {
    id,
    repoName: "my-repo",
    createdAt: new Date().toISOString(),
    analysisVersion: "3.0",
    status: "completed",
    summary: { files: 1, symbols: 1, modules: 1, cycleCount: 0, issueCounts: { P1: 1 } },
    issues: [{
      id: "issue-a",
      tier: "P1",
      category: "complexity",
      title: "Test",
      description: "d",
      detail: "d",
      scopePaths: [],
      scopeModules: [],
      confidence: "high",
      estimatedEffort: "small",
      estimatedRisk: "low",
      evidence: [],
      labels: [],
      fixPrompt: "prompt",
      fixPromptVersion: "1.0-template",
      status: "open",
    }],
    architecture: { modules: [], cycles: [], entryPoints: [] },
    readiness: null,
  };
}

describe("review-store", () => {
  let lapis: LaPisClient;

  beforeEach(() => {
    lapis = mockLapis();
  });

  it("saveReview persists report and indexes latest", async () => {
    const report = sampleReport("r1");
    await saveReview(lapis, report);
    expect(await getReview(lapis, "r1")).toEqual(report);
    expect(await getLatestReview(lapis, "my-repo")).toEqual(report);
  });

  it("saveReview appends review ids without duplicates", async () => {
    await saveReview(lapis, sampleReport("r1"));
    await saveReview(lapis, sampleReport("r2"));
    await saveReview(lapis, sampleReport("r2"));
    const index = await lapis.getSetting<{ reviewIds: string[] }>("repo:my-repo:reviews");
    expect(index?.reviewIds).toEqual(["r1", "r2"]);
    expect(await getLatestReview(lapis, "my-repo")).toMatchObject({ id: "r2" });
  });

  it("updateIssueStatus mutates issue and persists", async () => {
    await saveReview(lapis, sampleReport("r1"));
    const updated = await updateIssueStatus(lapis, "r1", "issue-a", "dismissed");
    expect(updated?.issues[0].status).toBe("dismissed");
    const loaded = await getReview(lapis, "r1");
    expect(loaded?.issues[0].status).toBe("dismissed");
  });

  it("updateIssueStatus returns null for missing review or issue", async () => {
    expect(await updateIssueStatus(lapis, "missing", "issue-a", "open")).toBeNull();
    await saveReview(lapis, sampleReport("r1"));
    expect(await updateIssueStatus(lapis, "r1", "missing", "open")).toBeNull();
  });
});
