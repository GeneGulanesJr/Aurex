/**
 * Pure helpers for the MutationPanel. Extracted so they can be unit-tested
 * without a DOM (the project doesn't have @testing-library/react installed).
 */

export type ScoreBand = "high" | "medium" | "low" | "none";

/**
 * Mutation score band thresholds. These align with the Stryker threshold
 * defaults we ship in our own config (stryker.config.mjs: thresholds.high=80,
 * low=60, break=50). Change here to change everywhere.
 */
export const SCORE_BANDS = {
  HIGH: 80,   // >= 80 → green/success
  MEDIUM: 60, // >= 60 → amber/warning
  // < 60  → red/error
} as const;

/**
 * Map a mutation score to one of the DESIGN.md theme bands.
 *   high   >= SCORE_BANDS.HIGH  → green/success
 *   medium >= SCORE_BANDS.MEDIUM → amber/warning
 *   low    < SCORE_BANDS.MEDIUM  → red/error
 *   none   (no score)             → muted
 */
export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "none";
  if (score >= SCORE_BANDS.HIGH) return "high";
  if (score >= SCORE_BANDS.MEDIUM) return "medium";
  return "low";
}

/**
 * CSS color token name for a given score band. Reads from the DESIGN.md
 * theme tokens (defined as CSS custom properties in styles.css).
 */
export function bandColorVar(band: ScoreBand): string {
  return band === "high" ? "var(--success)" :
         band === "medium" ? "var(--warning)" :
         band === "low" ? "var(--error)" : "var(--text-muted)";
}
