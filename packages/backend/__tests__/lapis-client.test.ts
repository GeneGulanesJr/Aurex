import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLaPisClient } from "../src/clients/lapis-client";
import type { LaPisClient } from "../src/clients/lapis-client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("LaPisClient (HTTP)", () => {
  let client: LaPisClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createLaPisClient({ lapisEndpoint: "http://localhost:9100" });
  });

  it("ping calls GET /health", async () => {
    mockFetch.mockReturnValue(mockResponse({ status: "ok" }));
    await client.ping();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("createMission POSTs to /missions", async () => {
    const mission = { id: "m-1", description: "Build auth", status: "planning", configJson: {}, createdAt: "2026-01-01" };
    mockFetch.mockReturnValue(mockResponse(mission));
    const result = await client.createMission("Build auth", {
      modelHints: { orchestrator: "r", worker: "c", validator_scrutiny: "r", validator_user_testing: "c", research: "f" },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/missions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.id).toBe("m-1");
  });

  it("writeVerdict takes sessionId separately from verdict body", async () => {
    const verdict = { id: "v-1", verdict: "pass" as const, sessionId: "sess-1" };
    mockFetch.mockReturnValue(mockResponse(verdict));
    await client.writeVerdict("sess-1", {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      verdict: "pass",
      findings: "All good",
      failedUnitIds: [],
      timestamp: "2026-01-01",
    });
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.sessionId).toBe("sess-1");
  });

  it("classifyVerdict PATCHes verdict with classification", async () => {
    mockFetch.mockReturnValue(mockResponse({ id: "v-1", classification: "blocking" }));
    await client.classifyVerdict("v-1", "blocking");
    const call = mockFetch.mock.calls[0];
    expect((call[1] as RequestInit).method).toBe("PATCH");
    expect(call[0]).toContain("/verdicts/v-1");
  });

  it("registerAgentSession sends milestoneId and unitId", async () => {
    mockFetch.mockReturnValue(mockResponse({ ok: true }));
    await client.registerAgentSession("worker", "sess-1", "m-1", "ms-1", "unit-1");
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.milestoneId).toBe("ms-1");
    expect(body.unitId).toBe("unit-1");
  });

  it("getRetryCounter calls GET /milestones/:id/retry", async () => {
    mockFetch.mockReturnValue(mockResponse({ milestoneId: "ms-1", retries: 2, rescopes: 1 }));
    const counter = await client.getRetryCounter("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/milestones/ms-1/retry",
      expect.objectContaining({ method: "GET" }),
    );
    expect(counter).toEqual({ milestoneId: "ms-1", retries: 2, rescopes: 1 });
  });

  it("updateWorkingUnit PATCHes runtime fields with snake_case body", async () => {
    mockFetch.mockReturnValue(mockResponse({ ok: true }));
    await client.updateWorkingUnit("u-1", {
      taskBranch: "task/u-1",
      worktreePath: "/tmp/wt",
      sessionId: "sess-1",
    });
    const call = mockFetch.mock.calls[0];
    expect((call[1] as RequestInit).method).toBe("PATCH");
    expect(call[0]).toContain("/units/u-1");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      task_branch: "task/u-1",
      worktree_path: "/tmp/wt",
      session_id: "sess-1",
    });
  });

  it("normalizes snake_case working unit payloads from LaPis", async () => {
    mockFetch.mockReturnValue(mockResponse([{
      id: "u-1",
      milestone_id: "ms-1",
      description: "Do work",
      declared_paths: ["src/server/mod.rs"],
      declared_modules: ["server"],
      status: "planned",
      task_branch: "task/u-1",
      worktree_path: "/tmp/wt",
      session_id: "sess-1",
    }]));

    const units = await client.getWorkingUnitsForMilestone("ms-1");

    expect(units[0]).toMatchObject({
      id: "u-1",
      milestoneId: "ms-1",
      declaredPaths: ["src/server/mod.rs"],
      declaredModules: ["server"],
      taskBranch: "task/u-1",
      worktreePath: "/tmp/wt",
      sessionId: "sess-1",
    });
  });

  it("defaults missing working unit scope arrays to empty arrays", async () => {
    mockFetch.mockReturnValue(mockResponse([{ id: "u-1", milestone_id: "ms-1", description: "Do work" }]));

    const units = await client.getWorkingUnitsForMilestone("ms-1");

    expect(units[0]).toMatchObject({
      id: "u-1",
      milestoneId: "ms-1",
      declaredPaths: [],
      declaredModules: [],
      status: "planned",
    });
  });

  it("uses working unit title as description when description is absent", async () => {
    mockFetch.mockReturnValue(mockResponse([{ id: "u-1", milestone_id: "ms-1", title: "Analyze classify" }]));

    const units = await client.getWorkingUnitsForMilestone("ms-1");

    expect(units[0]).toMatchObject({
      id: "u-1",
      description: "Analyze classify",
    });
  });

  it("getVerdicts fetches verdicts for a milestone", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getVerdicts("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/milestones/ms-1/verdicts"),
      expect.any(Object),
    );
  });

  it("normalizes snake_case verdict payloads from LaPis", async () => {
    mockFetch.mockReturnValue(mockResponse([{
      id: "v-1",
      milestone_id: "ms-1",
      contract_id: "c-1",
      validator_type: "validator_scrutiny",
      session_id: "sess-1",
      verdict: "pass",
      findings: "Looks good",
      failed_unit_ids: [],
      timestamp: "2026-01-01",
    }]));

    const verdicts = await client.getVerdicts("ms-1");

    expect(verdicts[0]).toMatchObject({
      id: "v-1",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-1",
      verdict: "pass",
      failedUnitIds: [],
    });
  });

  it("normalizes snake_case session payloads from LaPis", async () => {
    mockFetch.mockReturnValue(mockResponse([{
      session_id: "sess-1",
      agent_type: "validator_scrutiny",
      mission_id: "m-1",
      milestone_id: "ms-1",
      unit_id: null,
      spawned_at: "2026-01-01",
      terminated_at: null,
    }]));

    const sessions = await client.getSessionsForMilestone("ms-1");

    expect(sessions[0]).toMatchObject({
      sessionId: "sess-1",
      agentType: "validator_scrutiny",
      missionId: "m-1",
      milestoneId: "ms-1",
      unitId: null,
      terminatedAt: null,
    });
  });

  it("getHandoffsForMilestone fetches handoff records for a milestone", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getHandoffsForMilestone("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/milestones/ms-1/handoffs",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("getHandoffForUnit fetches a handoff record for a working unit", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getHandoffForUnit("u-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/units/u-1/handoff",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("normalizes snake_case handoff records from LaPis", async () => {
    mockFetch.mockReturnValue(mockResponse([{
      id: "handoff-1",
      mission_id: "m-1",
      milestone_id: "ms-1",
      unit_id: "u-1",
      status: "accepted",
      feature_name: "Analyze server",
      description: "Analyzed server module",
      implemented: "Recorded complexity hotspots",
      remaining: "none",
      rationale: "The analysis records concrete hotspots so follow-up workers can refactor the right functions.",
      assumptions: "The source file path from the mission is correct.",
      unresolved_uncertainties: "none",
      errors_encountered: "none",
      commands_run: [{ command: "cargo check", exit_code: 0 }],
      git_commit_hash: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
    }]));

    const handoffs = await client.getHandoffsForMilestone("ms-1");

    expect(handoffs[0]).toMatchObject({
      id: "handoff-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      unitId: "u-1",
      status: "accepted",
      featureName: "Analyze server",
      unresolvedUncertainties: "none",
      errorsEncountered: "none",
      commandsRun: [{ command: "cargo check", exitCode: 0 }],
      gitCommitHash: "abc123",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:01Z",
    });
  });

  it("creates a mission todo ledger", async () => {
    mockFetch.mockReturnValue(mockResponse({ missionId: "m-1", todos: [] }));
    await client.createMissionLedger({
      missionId: "m-1",
      missionTitle: "Mission",
      sourceMission: "Build feature",
      plannerSummary: "Plan feature",
      acceptanceCriteria: ["works"],
    });
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("http://localhost:9100/todo-ledgers");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((call[1] as RequestInit).body as string).missionId).toBe("m-1");
  });

  it("creates todos in bulk and fetches focused todo context", async () => {
    mockFetch.mockReturnValueOnce(mockResponse([{ id: "td-1" }]));
    await client.createTodos("m-1", [{ title: "Task", lapisContextQuery: "task context" }]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/missions/m-1/todos/bulk",
      expect.objectContaining({ method: "POST" }),
    );

    mockFetch.mockReturnValueOnce(mockResponse({ todoId: "td-1", query: "task context", context: [] }));
    await client.getContextForTodo("td-1", { limit: 5 });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "http://localhost:9100/todos/td-1/context?limit=5",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockReturnValue(mockResponse({ error: "not found" }, 404));
    await expect(client.getMission("nonexistent")).rejects.toThrow();
  });

  it("runCompression calls the compress endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}),
    });
    await client.runCompression("m-1", "post_milestone");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/missions/m-1/compress"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
