// packages/backend/src/enforcement/handoff-validator.ts
import type { Handoff } from "@aurex/shared";
import { validateCommandsRunEntries } from "./commands-run.js";

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Each pattern matches "<Verb> <single-word>" — the hallmark of a
// copy-paste rationale that just restates the change without explaining
// the reasoning. The anchors (^...$) and the exact word-count (\w+)
// are critical: without them, legitimate multi-word rationales would
// be rejected.
function buildCopyPastePatterns(): RegExp[] {
  return [
    /^Refactored \w+$/,
    /^Implemented \w+$/,
    /^Fixed \w+$/,
    /^Updated \w+$/,
    /^Changed \w+$/,
  ];
}

export function validateHandoff(handoff: Handoff): ValidationResult {
  const errors: string[] = [];

  const requiredStrings: (keyof Handoff)[] = [
    "unitId", "featureName", "description", "implemented",
    "remaining", "rationale", "assumptions", "unresolvedUncertainties",
    "errorsEncountered", "gitCommitHash",
  ];

  for (const field of requiredStrings) {
    const value = handoff[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (handoff.rationale && buildCopyPastePatterns().some((p) => p.test(handoff.rationale))) {
    errors.push("rationale is too brief — must explain the reasoning, not just describe the change");
  }

  const commandsRunResult = validateCommandsRunEntries(handoff.commandsRun);
  if (!commandsRunResult.ok) {
    errors.push(commandsRunResult.error);
  }

  return { valid: errors.length === 0, errors };
}
