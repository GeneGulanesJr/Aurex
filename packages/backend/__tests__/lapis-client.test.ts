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

  it("getVerdicts fetches verdicts for a milestone", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getVerdicts("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/milestones/ms-1/verdicts"),
      expect.any(Object),
    );
  });

  it("getHandoffsForMilestone fetches handoff records for a milestone", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getHandoffsForMilestone("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/milestones/ms-1/handoffs",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockReturnValue(mockResponse({ error: "not found" }, 404));
    await expect(client.getMission("nonexistent")).rejects.toThrow();
  });

  it("runCompression logs skip message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await client.runCompression("m-1", "post_milestone");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[compression] Skipped"));
    logSpy.mockRestore();
  });
});
