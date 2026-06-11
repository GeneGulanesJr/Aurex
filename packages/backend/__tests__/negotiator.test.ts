import { describe, it, expect, vi } from "vitest";
import { createNegotiator } from "../src/orchestrator/negotiator";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { ValidationVerdict } from "@aurex/shared";

// Helper: standard sessions mock for creator verification
const validSessions = [
  { sessionId: "s-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
  { sessionId: "s-2", agentType: "validator_user_testing", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
];

function mockLapisWithSessions(verdicts: ValidationVerdict[], sessions = validSessions) {
  return {
    getVerdicts: vi.fn().mockResolvedValue(verdicts),
    getSessionsForMilestone: vi.fn().mockResolvedValue(sessions),
  } as unknown as LaPisClient;
}

describe("negotiator", () => {
  // ---------------------------------------------------------------------------
  // Branch 1: No validator verdicts (or all filtered out)
  // ---------------------------------------------------------------------------

  it("escalates when no validator verdicts were recorded", async () => {
    const mockLapis = mockLapisWithSessions([]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validator verdicts");
  });

  it("escalates when getVerdicts throws (catch handler returns empty)", async () => {
    // Kill mutant L22: ArrowFunction → () => undefined.
    // If the catch returns undefined, `verdicts` becomes undefined and the
    // downstream .filter() throws. The test must NOT throw.
    const mockLapis = {
      getVerdicts: vi.fn().mockRejectedValue(new Error("lapis down")),
      getSessionsForMilestone: vi.fn().mockResolvedValue(validSessions),
    } as unknown as LaPisClient;
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validator verdicts");
  });

  it("escalates when getSessionsForMilestone throws (catch handler returns empty)", async () => {
    // Kill mutant L25: ArrowFunction → () => undefined.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
      getSessionsForMilestone: vi.fn().mockRejectedValue(new Error("db down")),
    } as unknown as LaPisClient;
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    // With catch returning [], session verification skips (no sessions)
    // → all verdicts with sessionId get discarded → no valid verdicts → escalate
    expect(result.decision).toBe("escalate");
  });

  it("returns exact reason 'No validator verdicts were recorded' when no verdicts exist", async () => {
    // Kill mutant L31: StringLiteral → "". Exact reason match.
    const mockLapis = mockLapisWithSessions([]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.reason).toBe("No validator verdicts were recorded");
  });

  it("does NOT escalate when at least one valid verdict exists", async () => {
    // Kill mutant L41: `validVerdicts.length === 0` → `true` (always escalates).
    // With a single valid verdict, original proceeds past the check, mutant
    // returns escalate. The negated assertion catches it.
    const mockLapis = mockLapisWithSessions([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s-1" },
    ] as ValidationVerdict[]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).not.toBe("escalate");
    expect(result.decision).toBe("pass");
  });

  // ---------------------------------------------------------------------------
  // Branch 2: Missing scrutiny verdict
  // ---------------------------------------------------------------------------

  it("escalates when user_testing verdict exists but scrutiny verdict is missing", async () => {
    // Kill mutants L54 conditional+logical: bypass the !scrutinyVerdict check.
    const mockLapis = mockLapisWithSessions([
      { verdict: "pass", validatorType: "validator_user_testing", sessionId: "s-2" },
    ] as ValidationVerdict[]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toBe("Missing scrutiny validator verdict");
  });

  // ---------------------------------------------------------------------------
  // Branch 3: All pass
  // ---------------------------------------------------------------------------

  it("returns pass when all verdicts pass", async () => {
    const mockLapis = mockLapisWithSessions([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s-1" },
      { verdict: "pass", validatorType: "validator_user_testing", sessionId: "s-2" },
    ] as ValidationVerdict[]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
    expect(result.reason).toBe("All validators passed");
  });

  it("returns exact reason 'All validators passed' on full pass", async () => {
    // Kill mutant L49: StringLiteral → "".
    const mockLapis = mockLapisWithSessions([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "s-1" },
    ] as ValidationVerdict[]);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.reason).toBe("All validators passed");
  });

  // ---------------------------------------------------------------------------
  // Branch 4: User testing failure (override authority)
  // ---------------------------------------------------------------------------

  it("always blocks on user testing failure", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "User flow broken", failedUnitIds: ["unit-1", "unit-2"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("user_testing");
    // Kill ObjectLiteral/StringLiteral mutations on the retry result.
    expect(result.failedUnitIds).toEqual(["unit-1", "unit-2"]);
  });

  it("user_testing failure retries while retryCount < maxRetries (boundary at maxRetries-1)", async () => {
    // Kill mutant L57: retryCount < maxRetries → retryCount <= maxRetries.
    // At retryCount == maxRetries-1, the original returns retry; the mutant
    // (off-by-one) skips the retry branch and goes to rescope/escalate.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "broken", failedUnitIds: ["u-1"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 1, 0, 2, 5);

    expect(result.decision).toBe("retry");
  });

  it("user_testing failure rescopes when retries exhausted but rescope available", async () => {
    // Kills NoCoverage mutants L64, L65, L66, L67 — these are entirely
    // uncovered branches before this test existed.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "broken", failedUnitIds: ["u-1"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
    expect(result.reason).toContain("rescope needed");
  });

  it("user_testing failure escalates when both retry and rescope exhausted", async () => {
    // Kill mutants at L70, L83, L97. Assert exact reason.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "broken", failedUnitIds: ["u-1"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 5, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toBe("user_testing failed, all limits exhausted");
  });

  // ---------------------------------------------------------------------------
  // Branch 5: Scrutiny failure with classification
  // ---------------------------------------------------------------------------

  it("returns retry with patchable reason when scrutiny fails with patchable classification", async () => {
    // Kill mutants L80: classification === "patchable" → !== "patchable".
    // The mutant makes patchable get treated as blocking, returning a
    // different reason string.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "Missing test for auth flow", failedUnitIds: ["unit-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("patchable");
    expect(result.reason).toContain("Missing test for auth flow");
    expect(result.failedUnitIds).toEqual(["unit-1"]);
  });

  it("distinguishes patchable retry from blocking retry via reason", async () => {
    // Kills mutants L80 (classification bypass) and L83 (patchable reason → "").
    // Same setup, different classification → different reason.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad code", failedUnitIds: ["unit-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toBe("scrutiny blocking — full retry");
    expect(result.failedUnitIds).toEqual(["unit-1"]);
  });

  it("treats missing classification as blocking (default)", async () => {
    // Kills mutants that remove the `|| "blocking"` default.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", findings: "Bad", failedUnitIds: ["unit-1"], timestamp: "" } as ValidationVerdict,
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    // No classification → defaults to "blocking" → "scrutiny blocking — full retry"
    expect(result.decision).toBe("retry");
    expect(result.reason).toBe("scrutiny blocking — full retry");
  });

  it("scrutiny patchable failure retry boundary at retryCount == maxRetries-1", async () => {
    // Kills mutant L57 in the patchable branch: `retryCount < maxRetries` → `<=`.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "x", failedUnitIds: ["u-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 1, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("patchable");
  });

  it("scrutiny patchable retries-exhausted falls through to blocking retry branch", async () => {
    // Kills mutants around L78-L83 patchable/bypass boundary.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "x", failedUnitIds: ["u-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    // retryCount = 2, maxRetries = 2 → patchable branch fails (NOT < 2)
    // → falls through to blocking-retry branch (also fails NOT < 2)
    // → falls through to rescope branch (rescopeCount=0 < maxRescopes=5)
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
  });

  it("scrutiny rescopes when retries exhausted but rescope available", async () => {
    // Kills mutants around L88, L89, L90, L91 — the rescope branch.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["u-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
    expect(result.reason).toBe("scrutiny failed, retries exhausted");
  });

  it("scrutiny escalates when both retry and rescope exhausted", async () => {
    // Kills mutants L97, L100, L103 — final escalation branch.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["u-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 5, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toBe("scrutiny failed, all limits exhausted");
  });

  it("scrutiny rescope boundary at rescopeCount == maxRescopes-1", async () => {
    // Kills mutants at L88 boundary: rescopeCount < maxRescopes → <=.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["u-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 4, 2, 5);

    // rescopeCount=4 < maxRescopes=5 → rescope
    expect(result.decision).toBe("rescope");
  });

  // ---------------------------------------------------------------------------
  // Branch 6: Session verification
  // ---------------------------------------------------------------------------

  it("discards verdicts from invalid creator sessions", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "bad-session", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    // Only s-1 is registered
    const sessions = [
      { sessionId: "s-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ];

    const mockLapis = mockLapisWithSessions(verdicts, sessions);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    // The bad-session verdict is discarded, but s-1 still passes
    expect(result.decision).toBe("pass");
  });

  it("escalates when all verdict sessions are invalid", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "unknown", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    // No matching sessions
    const sessions: any[] = [];

    const mockLapis = mockLapisWithSessions(verdicts, sessions);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("No validator verdicts");
  });

  it("keeps legacy verdicts that have no sessionId", async () => {
    // Kill mutant L29 area: `if (!v.sessionId) return true` → `return false`.
    // Verdicts without sessionId should pass through the filter unchanged.
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" } as ValidationVerdict,
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
  });

  it("accepts snake_case validator_type verdicts from LaPis payloads", async () => {
    const verdicts = [
      {
        id: "v-1",
        milestoneId: "ms-1",
        contractId: "c-1",
        validator_type: "validator_scrutiny",
        sessionId: "s-1",
        verdict: "pass",
        findings: "Looks good",
        failedUnitIds: [],
        timestamp: "",
      },
    ] as unknown as ValidationVerdict[];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
  });

  // ---------------------------------------------------------------------------
  // L75 mutants: the scrutinyFailure `find` predicate.
  // To kill these, the FIRST validVerdict must NOT be a scrutiny fail, and
  // the actual scrutiny fail must be later in the array. With the predicate
  // mutated to `true` (or broader `||`), the first verdict wins — which has
  // different `failedUnitIds` from the real scrutiny fail.
  // ---------------------------------------------------------------------------

  it("uses the actual scrutiny failure, not the first verdict, when ordering matters", async () => {
    const verdicts: ValidationVerdict[] = [
      // First: a pass verdict (would be selected by mutant predicate `true`)
      { id: "v-pass", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "all good", failedUnitIds: [], timestamp: "" },
      // Second: the real scrutiny failure with the IDs we expect
      { id: "v-fail", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad code", failedUnitIds: ["unit-7", "unit-9"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    // Original selects v-fail; mutants with predicate `true` or `||` select v-pass,
    // which has empty failedUnitIds. Asserting the exact failedUnitIds kills them.
    expect(result.decision).toBe("retry");
    expect(result.failedUnitIds).toEqual(["unit-7", "unit-9"]);
  });

  it("uses the actual scrutiny failure, not the first verdict, for patchable retries too", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-pass", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "ok", failedUnitIds: [], timestamp: "" },
      { id: "v-fail", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "typo in import", failedUnitIds: ["unit-3"], timestamp: "" },
    ];
    const mockLapis = mockLapisWithSessions(verdicts);
    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("patchable");
    expect(result.reason).toContain("typo in import");
    expect(result.failedUnitIds).toEqual(["unit-3"]);
  });

  // ---------------------------------------------------------------------------
  // L31 mutant: console.warn message gets emptied.
  // ---------------------------------------------------------------------------

  it("logs a warning with the exact message when discarding a verdict from an invalid session", async () => {
    // Kill mutant L31:24 — the warning message must be non-empty AND mention
    // the session ID we're discarding. An empty string would lose the audit
    // trail that enforcement was triggered.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const verdicts: ValidationVerdict[] = [
        { id: "v-bad", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "ghost-session", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
        { id: "v-good", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      ];
      const sessions = [
        { sessionId: "s-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
      ];
      const mockLapis = mockLapisWithSessions(verdicts, sessions);
      const negotiator = createNegotiator(mockLapis);
      await negotiator.negotiate("ms-1", 0, 0, 2, 5);

      // Must have been called at least once with a non-empty message containing
      // the session id we discarded.
      const calls = warnSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstMessage = String(calls[0]?.[0] ?? "");
      expect(firstMessage.length).toBeGreaterThan(0);
      expect(firstMessage).toContain("ghost-session");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
