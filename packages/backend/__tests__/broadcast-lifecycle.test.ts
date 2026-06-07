import { describe, it, expect } from "vitest";
import { validateBroadcastTransition, canAuthorTransition } from "../src/enforcement/broadcast-lifecycle";

describe("broadcast lifecycle", () => {
  // ── validateBroadcastTransition ─────────────────────────────────────

  describe("validateBroadcastTransition", () => {
    it("allows active → superseded", () => {
      expect(validateBroadcastTransition("active", "superseded").valid).toBe(true);
    });

    it("allows active → archived", () => {
      expect(validateBroadcastTransition("active", "archived").valid).toBe(true);
    });

    it("allows active → expired", () => {
      expect(validateBroadcastTransition("active", "expired").valid).toBe(true);
    });

    it("rejects superseded → active", () => {
      expect(validateBroadcastTransition("superseded", "active").valid).toBe(false);
    });

    it("rejects expired → active", () => {
      expect(validateBroadcastTransition("expired", "active").valid).toBe(false);
    });

    it("rejects archived → active", () => {
      expect(validateBroadcastTransition("archived", "active").valid).toBe(false);
    });

    it("returns valid result with no reason for allowed transitions", () => {
      const result = validateBroadcastTransition("active", "superseded");
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    // ── Kills ArrayDeclaration mutants on empty arrays (L6-8) ──
    // Mutant adds "Stryker was here" to each empty array, making
    // invalid transitions appear valid. These tests assert that
    // the arrays are truly empty for terminal states.

    it("superseded has no valid outgoing transitions (kills array mutant L6)", () => {
      // If mutant adds "Stryker was here" to superseded:[], then
      // includes("Stryker was here") would be false (string literal
      // comparison), but includes("active") would be false too.
      // The key is that NO next state is valid for superseded.
      expect(validateBroadcastTransition("superseded", "superseded").valid).toBe(false);
      expect(validateBroadcastTransition("superseded", "archived").valid).toBe(false);
      expect(validateBroadcastTransition("superseded", "expired").valid).toBe(false);
    });

    it("archived has no valid outgoing transitions (kills array mutant L7)", () => {
      expect(validateBroadcastTransition("archived", "superseded").valid).toBe(false);
      expect(validateBroadcastTransition("archived", "archived").valid).toBe(false);
      expect(validateBroadcastTransition("archived", "expired").valid).toBe(false);
    });

    it("expired has no valid outgoing transitions (kills array mutant L8)", () => {
      expect(validateBroadcastTransition("expired", "superseded").valid).toBe(false);
      expect(validateBroadcastTransition("expired", "archived").valid).toBe(false);
      expect(validateBroadcastTransition("expired", "active").valid).toBe(false);
    });

    it("rejects same-state transitions (kills ArrayDeclaration mutants)", () => {
      // Mutant adds "Stryker was here" to arrays; this tests that
      // includes("active") returns false for the active array too,
      // ensuring the array ONLY contains the expected values.
      expect(validateBroadcastTransition("active", "active").valid).toBe(false);
    });

    // ── Kills L21:7 ConditionalExpression → false ──
    // Mutant makes `if (!allowed)` always false, skipping the
    // "Unknown lifecycle state" early return. We test with a cast
    // to exercise that code path.
    it("returns valid=false for unknown state (kills L21 conditional)", () => {
      // TypeScript won't let us pass an invalid state, so we cast.
      // If the !allowed check is disabled, the function would proceed
      // to allowed.includes() on undefined, which throws.
      // Use a value that's NOT a valid key in VALID_TRANSITIONS.
      const result = validateBroadcastTransition(
        "unknown_state" as any,
        "active",
      );
      expect(result.valid).toBe(false);
    });

    it("returns reason for unknown state (kills L21 NoCoverage block)", () => {
      const result = validateBroadcastTransition(
        "unknown_state" as any,
        "active",
      );
      expect(result.reason).toContain("Unknown lifecycle state");
      expect(result.reason).toContain("unknown_state");
    });

    // ── Kills L29:81 StringLiteral → "" ──
    it("includes the transition details in rejection reason", () => {
      const result = validateBroadcastTransition("superseded", "active");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("superseded");
      expect(result.reason).toContain("active");
      // Also check the empty-array case: superseded has no allowed
      // transitions, so the reason should mention that.
      expect(result.reason).toMatch(/Allowed:\s*\[/);
    });

    it("lists allowed transitions in the reason string", () => {
      const result = validateBroadcastTransition("active", "active");
      expect(result.reason).toContain("superseded");
      expect(result.reason).toContain("archived");
      expect(result.reason).toContain("expired");
    });
  });

  // ── canAuthorTransition ─────────────────────────────────────────────

  describe("canAuthorTransition", () => {
    it("allows author to self-supersede", () => {
      expect(canAuthorTransition("worker-1", "worker-1", "active", "superseded")).toBe(true);
    });

    it("allows Orchestrator to archive any broadcast", () => {
      expect(canAuthorTransition("orchestrator-1", "worker-1", "active", "archived")).toBe(true);
    });

    it("rejects worker archiving another agent broadcast", () => {
      expect(canAuthorTransition("worker-1", "worker-2", "active", "archived")).toBe(false);
    });

    it("allows human guidance broadcasts (special case)", () => {
      expect(canAuthorTransition("human", "human", "active", "superseded")).toBe(true);
    });

    it("allows human to archive any broadcast (kills L43 identity/human check)", () => {
      // Kills L43:45 `actorId === "human"` → false and L43:57 StringLiteral → ""
      // Mutant disables the human check, so only orchestrator prefix check works.
      // Since "human" doesn't startWith("orchestrator"), the mutant returns false.
      expect(canAuthorTransition("human", "worker-1", "active", "archived")).toBe(true);
    });

    it("human can supersede another worker's broadcast", () => {
      expect(canAuthorTransition("human", "worker-1", "active", "superseded")).toBe(true);
    });

    // ── Kills L40:7 ConditionalExpression → false ──
    // Mutant disables `if (!transition.valid)` check, letting invalid
    // transitions through to the author check.
    it("rejects author check when transition is invalid (kills L40 conditional)", () => {
      // superseded → active is invalid. If the !transition.valid check
      // is disabled, the function would proceed to the actorId check
      // and return true (same actor). We need the early return.
      expect(canAuthorTransition("worker-1", "worker-1", "superseded", "active")).toBe(false);
    });

    // ── Kills L43:45 ConditionalExpression → false + L43:57 StringLiteral ──
    // L43: `if (actorId === authorId) return true` — mutant makes it `if (false)`
    // so the function falls through to the orchestrator/human check.
    it("returns true when actor is the author (kills L43 identity check)", () => {
      // A worker archiving own broadcast: actorId === authorId.
      // If mutant disables this check, it falls through to the
      // orchestrator/human check, which returns false for "worker-1".
      expect(canAuthorTransition("worker-1", "worker-1", "active", "archived")).toBe(true);
    });

    it("allows orchestrator (startsWith check) even when not the author", () => {
      expect(canAuthorTransition("orchestrator-42", "worker-1", "active", "archived")).toBe(true);
    });

    it("rejects unknown actor who is neither author nor orchestrator/human", () => {
      expect(canAuthorTransition("auditor-1", "worker-1", "active", "archived")).toBe(false);
    });

    // ── Kills L40:33 BooleanLiteral NoCoverage ──
    it("rejects invalid transition even for orchestrator", () => {
      // Even orchestrator can't make an invalid transition.
      // This exercises the early return path in L40.
      expect(canAuthorTransition("orchestrator-1", "orchestrator-1", "archived", "active")).toBe(false);
    });

    it("rejects invalid transition even for human", () => {
      expect(canAuthorTransition("human", "human", "expired", "active")).toBe(false);
    });
  });
});
