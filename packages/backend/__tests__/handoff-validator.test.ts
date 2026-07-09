import { describe, it, expect } from "vitest";
import { validateHandoff } from "../src/enforcement/handoff-validator";
import type { Handoff } from "@aurex/shared";

describe("validateHandoff", () => {
  const validHandoff: Handoff = {
    unitId: "unit-1",
    featureName: "Auth",
    description: "Implemented login",
    implemented: "JWT tokens",
    remaining: "Refresh tokens",
    rationale: "Chose JWT for statelessness per contract requirement for stateless auth",
    assumptions: "Token expiry is 1 hour",
    unresolvedUncertainties: "none",
    errorsEncountered: "none",
    commandsRun: [{ command: "npm test", exitCode: 0 }],
    gitCommitHash: "abc123",
  };

  it("accepts a valid handoff", () => {
    const result = validateHandoff(validHandoff);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Copy-paste regex patterns (L5-L9). Each pattern is /^<word> \w+$/.
  // Stryker produces 4 mutants per pattern: drop ^, drop $, \w+ → \W+, \w+ → \w.
  // To kill all of them, test rationales that:
  //  - LOOK like copy-paste but aren't (multi-word, embedded) → assert VALID
  //  - ARE copy-paste but with edge-case word counts → assert INVALID
  // ---------------------------------------------------------------------------

  describe("copy-paste detection", () => {
    const copyPasteCases: Array<{ rationale: string; shouldReject: boolean; label: string }> = [
      // Cases that MUST be rejected (single word after the verb — true copy-paste)
      { rationale: "Refactored X", shouldReject: true, label: "Refactored + single word" },
      { rationale: "Implemented Y", shouldReject: true, label: "Implemented + single word" },
      { rationale: "Fixed Z", shouldReject: true, label: "Fixed + single word" },
      { rationale: "Updated A", shouldReject: true, label: "Updated + single word" },
      { rationale: "Changed B", shouldReject: true, label: "Changed + single word" },
      // Cases that MUST be accepted (multi-word — real rationale)
      { rationale: "Refactored the auth module to support refresh tokens", shouldReject: false, label: "Refactored + multi-word (kills missing $)" },
      { rationale: "Implemented OAuth flow with PKCE for security", shouldReject: false, label: "Implemented + multi-word" },
      { rationale: "Fixed the null pointer in token validation", shouldReject: false, label: "Fixed + multi-word" },
      { rationale: "Updated the middleware to use helmet", shouldReject: false, label: "Updated + multi-word" },
      { rationale: "Changed the config to read from env", shouldReject: false, label: "Changed + multi-word" },
      // Cases that MUST be accepted (verb embedded mid-sentence — kills missing ^)
      { rationale: "I did some work and then Refactored X", shouldReject: false, label: "Refactored at end of string (kills missing ^)" },
      { rationale: "Then I finished and Implemented Y", shouldReject: false, label: "Implemented at end of string" },
      { rationale: "We wrapped up and Fixed Z", shouldReject: false, label: "Fixed at end of string" },
      { rationale: "Just finished and Updated A", shouldReject: false, label: "Updated at end of string" },
      { rationale: "Finally completed and Changed B", shouldReject: false, label: "Changed at end of string" },
      // Cases that MUST be accepted (verb + non-word char only — kills \W+ mutant)
      { rationale: "Refactored !", shouldReject: false, label: "Refactored + non-word (kills \\W+ mutant)" },
      { rationale: "Implemented .", shouldReject: false, label: "Implemented + non-word" },
      { rationale: "Fixed ?", shouldReject: false, label: "Fixed + non-word" },
      { rationale: "Updated ;", shouldReject: false, label: "Updated + non-word" },
      { rationale: "Changed :", shouldReject: false, label: "Changed + non-word" },
      // Cases that MUST be rejected (verb + 2+ word chars — kills \w$ no-plus mutant)
      { rationale: "Refactored XY", shouldReject: true, label: "Refactored + 2 word chars (kills \\w$ no-plus)" },
      { rationale: "Implemented AB", shouldReject: true, label: "Implemented + 2 word chars" },
      { rationale: "Fixed CD", shouldReject: true, label: "Fixed + 2 word chars" },
      { rationale: "Updated EF", shouldReject: true, label: "Updated + 2 word chars" },
      { rationale: "Changed GH", shouldReject: true, label: "Changed + 2 word chars" },
    ];

    for (const { rationale, shouldReject, label } of copyPasteCases) {
      it(`${shouldReject ? "rejects" : "accepts"} rationale: ${label}`, () => {
        const handoff = { ...validHandoff, rationale };
        const result = validateHandoff(handoff);

        if (shouldReject) {
          expect(result.valid).toBe(false);
          expect(result.errors).toContainEqual(
            expect.stringContaining("rationale is too brief"),
          );
        } else {
          // If this is a "rejected" expectation, but the rationale is multi-word
          // and gets matched by a broader regex mutant, the test will fail
          // and kill the mutant. The valid=true assertion catches the
          // "drop $" / "drop ^" / "\W+" mutants.
          expect(result.errors.find((e) => e.includes("rationale"))).toBeUndefined();
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Required field validation (L28)
  // ---------------------------------------------------------------------------

  it("rejects handoff with absent unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("unresolvedUncertainties"));
  });

  it("rejects handoff with empty gitCommitHash and surfaces the field name in the error", () => {
    // Kills mutants L28:9 (ConditionalExpression → false) and L28:38
    // (value.trim() → value). The mutant would skip pushing the
    // "Missing required field: gitCommitHash" error, so the assertion
    // on the EXACT error message kills both.
    const handoff = { ...validHandoff, gitCommitHash: "" };
    const result = validateHandoff(handoff);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: gitCommitHash");
  });

  it("rejects handoff with empty description and surfaces the field name in the error", () => {
    const handoff = { ...validHandoff, description: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: description");
  });

  it("rejects handoff with whitespace-only gitCommitHash", () => {
    // Whitespace-only should also fail. Kills L28:38 (value.trim() → value)
    // by ensuring the trim() is what catches whitespace, not just the value
    // check. Actually for "   " both original and mutant push the error,
    // so this also documents the trim behavior.
    const handoff = { ...validHandoff, gitCommitHash: "   " };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: gitCommitHash");
  });

  it("rejects handoff with empty featureName", () => {
    const handoff = { ...validHandoff, featureName: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: featureName");
  });

  it("rejects handoff with empty rationale", () => {
    const handoff = { ...validHandoff, rationale: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: rationale");
  });

  it("rejects handoff with empty assumptions", () => {
    const handoff = { ...validHandoff, assumptions: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: assumptions");
  });

  it("rejects handoff with empty errorsEncountered", () => {
    const handoff = { ...validHandoff, errorsEncountered: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: errorsEncountered");
  });

  it("rejects handoff with empty unitId", () => {
    const handoff = { ...validHandoff, unitId: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: unitId");
  });

  it("rejects handoff with empty implemented", () => {
    const handoff = { ...validHandoff, implemented: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: implemented");
  });

  it("rejects handoff with empty remaining", () => {
    const handoff = { ...validHandoff, remaining: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: remaining");
  });

  it("rejects handoff with multiple missing fields and lists all of them", () => {
    // Kills L28:9 (ConditionalExpression → false) by asserting EXACT
    // error count and field names. The mutant would skip ALL missing-field
    // errors, so the count assertion catches it.
    const handoff = {
      ...validHandoff,
      unitId: "",
      gitCommitHash: "",
      description: "",
    };
    const result = validateHandoff(handoff);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: unitId");
    expect(result.errors).toContain("Missing required field: gitCommitHash");
    expect(result.errors).toContain("Missing required field: description");
    expect(result.errors.filter((e) => e.startsWith("Missing required field"))).toHaveLength(3);
  });

  it("rejects handoff with whitespace-only rationale (not just empty)", () => {
    const handoff = { ...validHandoff, rationale: "    " };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: rationale");
  });

  it("rejects handoff where a required field is a number (not a string)", () => {
    // Kills L35:9 mutant: `typeof value !== "string"` → `false`.
    // With the mutant, a non-string value like 42 would pass the typeof
    // check, then .trim() would throw at runtime. The valid:false assertion
    // catches the case where the error is NOT pushed.
    const handoff = {
      ...validHandoff,
      gitCommitHash: 42 as unknown as string,
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: gitCommitHash");
  });

  it("rejects handoff where a required field is null", () => {
    const handoff = {
      ...validHandoff,
      description: null as unknown as string,
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: description");
  });

  it("rejects handoff where a required field is undefined", () => {
    const handoff = {
      ...validHandoff,
      unitId: undefined as unknown as string,
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: unitId");
  });

  it("rejects handoff where a required field is a boolean", () => {
    const handoff = {
      ...validHandoff,
      featureName: true as unknown as string,
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: featureName");
  });

  it("rejects handoff where a required field is an object", () => {
    const handoff = {
      ...validHandoff,
      rationale: { text: "x" } as unknown as string,
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: rationale");
  });

  // ---------------------------------------------------------------------------
  // commandsRun validation (L37)
  // ---------------------------------------------------------------------------

  it("rejects handoff with empty commandsRun array", () => {
    // Kills L37:46 (right side of || → false): empty array is valid Array
    // but length === 0. Mutant makes the right side false, so only non-arrays
    // trigger the error.
    const handoff = { ...validHandoff, commandsRun: [] };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("commandsRun must contain at least one command");
  });

  it("rejects handoff where commandsRun is a string instead of an array", () => {
    // Kills L37:7 LogicalOperator (|| → &&): mutant only fires when BOTH
    // not-an-array AND length === 0, which is impossible. A non-array value
    // would never trigger the mutant's condition.
    const handoff = { ...validHandoff, commandsRun: "npm test" as unknown as Handoff["commandsRun"] };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("commandsRun must contain at least one command");
  });

  it("rejects handoff where commandsRun is missing entirely", () => {
    // Kills L37:7 ConditionalExpression → false (whole condition disabled)
    // and L37:46 ConditionalExpression → false (right side disabled).
    const handoff = { ...validHandoff, commandsRun: undefined as unknown as Handoff["commandsRun"] };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("commandsRun must contain at least one command");
  });

  it("rejects handoff where commandsRun is a number", () => {
    const handoff = { ...validHandoff, commandsRun: 42 as unknown as Handoff["commandsRun"] };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("commandsRun must contain at least one command");
  });

  it("accepts handoff with multiple commands in commandsRun", () => {
    const handoff = {
      ...validHandoff,
      commandsRun: [
        { command: "npm test", exitCode: 0 },
        { command: "npm run build", exitCode: 0 },
      ],
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff with malformed commandsRun entry", () => {
    const handoff = {
      ...validHandoff,
      commandsRun: [{ command: "npm test" }] as unknown as Handoff["commandsRun"],
    };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exitCode"))).toBe(true);
  });

  it("accepts 'none' as valid unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "none" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff with missing required fields (combined)", () => {
    const handoff = { ...validHandoff, description: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Error message structure
  // ---------------------------------------------------------------------------

  it("returns an empty errors array when valid is true", () => {
    // Kills any mutant that might add spurious errors to a valid handoff.
    const result = validateHandoff(validHandoff);
    expect(result.errors).toEqual([]);
  });

  it("returns errors as a string array (not objects or nulls)", () => {
    const handoff = { ...validHandoff, gitCommitHash: "" };
    const result = validateHandoff(handoff);
    expect(Array.isArray(result.errors)).toBe(true);
    for (const err of result.errors) {
      expect(typeof err).toBe("string");
    }
  });
});
