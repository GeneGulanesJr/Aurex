import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLaPisClient } from "../../src/clients/lapis-client";

// Regression coverage for array-field normalization. SQLite stores arrays as
// JSON-encoded strings and LaPis's HTTP layer returns the column value
// verbatim, so a stored array arrives as a string like '["a","b"]'. Before the
// fix, normalizeVerdict/normalizeStringArray checked Array.isArray(...) on the
// raw string (false) and silently returned [], which dropped validator
// failedUnitIds and caused "Validator returned fail with no failedUnitIds"
// escalations even when the validator correctly identified failing units.

function mockFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function createClientWithMockFetch() {
  const fetchMock = vi.fn();
  const client = createLaPisClient({ lapisEndpoint: "http://lapis:9100", missionId: "m-1" });
  // Stub global fetch used by the client's internal request helper.
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return { client, fetchMock };
}

describe("LaPisClient array-field normalization (JSON-string columns)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses failed_unit_ids returned as a JSON-encoded string into an array", async () => {
    const { client, fetchMock } = createClientWithMockFetch();
    // LaPis returns the SQLite column value verbatim: a JSON string, NOT an array.
    fetchMock.mockResolvedValue(
      mockFetchResponse([
        {
          id: "vv-1",
          milestone_id: "ms-1",
          contract_id: "vc-1",
          validator_type: "validator_scrutiny",
          session_id: "sess-1",
          verdict: "fail",
          classification: null,
          findings: "needs changes",
          // This is the bug: a string, not an array.
          failed_unit_ids: '["wu-1","wu-2"]',
          timestamp: "2026-06-15T15:54:27.000Z",
        },
      ]),
    );

    const verdicts = await client.getVerdicts("ms-1");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].failedUnitIds).toEqual(["wu-1", "wu-2"]);
  });

  it("still handles a real array (camelCase) for failedUnitIds", async () => {
    const { client, fetchMock } = createClientWithMockFetch();
    fetchMock.mockResolvedValue(
      mockFetchResponse([
        {
          id: "vv-2",
          milestoneId: "ms-1",
          contractId: "vc-1",
          validatorType: "validator_scrutiny",
          sessionId: "sess-2",
          verdict: "fail",
          findings: "x",
          failedUnitIds: ["wu-3"],
          timestamp: "2026-06-15T15:54:27.000Z",
        },
      ]),
    );

    const verdicts = await client.getVerdicts("ms-1");
    expect(verdicts[0].failedUnitIds).toEqual(["wu-3"]);
  });

  it("returns [] for malformed failed_unit_ids without throwing", async () => {
    const { client, fetchMock } = createClientWithMockFetch();
    fetchMock.mockResolvedValue(
      mockFetchResponse([
        {
          id: "vv-3",
          milestone_id: "ms-1",
          verdict: "fail",
          findings: "x",
          failed_unit_ids: "not-json",
          timestamp: "2026-06-15T15:54:27.000Z",
        },
      ]),
    );

    const verdicts = await client.getVerdicts("ms-1");
    expect(verdicts[0].failedUnitIds).toEqual([]);
  });

  it("parses declaredPaths returned as a JSON-encoded string (normalizeStringArray)", async () => {
    const { client, fetchMock } = createClientWithMockFetch();
    fetchMock.mockResolvedValue(
      mockFetchResponse([
        {
          id: "wu-1",
          milestone_id: "ms-1",
          description: "unit",
          declared_paths: '["src/a.ts","src/b.ts"]',
          declared_modules: '["auth"]',
          status: "planned",
          task_branch: "task/wu-1",
          worktree_path: "/wt",
          session_id: "",
        },
      ]),
    );

    const units = await client.getWorkingUnitsForMilestone("ms-1");
    expect(units[0].declaredPaths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(units[0].declaredModules).toEqual(["auth"]);
  });
});
