// packages/backend/src/enforcement/handoff-validator.ts
import type { Handoff } from "@aurex/shared";

const COPY_PASTE_PATTERNS = [
  /^Refactored \w+$/,
  /^Implemented \w+$/,
  /^Fixed \w+$/,
  /^Updated \w+$/,
  /^Changed \w+$/,
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
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

  if (handoff.rationale && COPY_PASTE_PATTERNS.some((p) => p.test(handoff.rationale))) {
    errors.push("rationale is too brief — must explain the reasoning, not just describe the change");
  }

  if (!Array.isArray(handoff.commandsRun) || handoff.commandsRun.length === 0) {
    errors.push("commandsRun must contain at least one command");
  }

  return { valid: errors.length === 0, errors };
}
