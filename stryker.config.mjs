// @ts-check
/**
 * Stryker mutation testing config for Aurex.
 *
 * Baseline scope: P0 (high-risk) — negotiator + enforcement layer.
 * Expand scope as mutation score improves.
 *
 * Usage:
 *   pnpm test:mutation          # run all configured mutants
 *   pnpm test:mutation:diff     # only mutate changed files (pre-refactor)
 *
 * Reference: https://stryker-mutator.io/docs/stryker-js/configuration
 */
export default {
  packageManager: "pnpm",
  // Explicit plugin list — Stryker 9 needs this when packages are installed
  // via pnpm workspaces (auto-discovery via keywords doesn't always trigger).
  plugins: [
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ],
  reporters: ["html", "clear-text", "progress", "json"],
  testRunner: "vitest",
  // perTest = only run tests that cover the mutated line (huge speedup).
  // Falls back to "all" automatically if the runner can't compute coverage.
  coverageAnalysis: "perTest",
  // Incremental runs share results with previous runs (skip already-killed mutants).
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  thresholds: { high: 80, low: 60, break: 50 },
  timeoutMS: 60_000,
  // Only mutate P0 files. P1/P2 added later.
  mutate: [
    "packages/backend/src/orchestrator/negotiator.ts",
    "packages/backend/src/enforcement/branch-guard.ts",
    "packages/backend/src/enforcement/contract-immutability.ts",
    "packages/backend/src/enforcement/creator-verifier.ts",
    "packages/backend/src/enforcement/handoff-validator.ts",
    "packages/backend/src/enforcement/broadcast-lifecycle.ts",
    "packages/backend/src/enforcement/research-lifecycle.ts",
    "packages/backend/src/enforcement/enforcement-gate.ts",
    "packages/backend/src/enforcement/quota-gate.ts",
  ],
  // Don't try to mutate generated files or types-only files.
  // Also exclude pnpm virtual store and worktrees from sandbox copy
  // (large directories of symlinks that break Stryker's copy).
  // DO NOT exclude __tests__ dirs — vitest needs them in the sandbox.
  ignorePatterns: [
    "**/*.d.ts",
    ".aurex-workspace/**",
    ".worktrees/**",
    "reports/**",
    "dist/**",
    "**/coverage/**",
  ],
  vitest: {
    configFile: "vitest.config.ts",
    // Disable vitest's "related test" detection — it requires every source
    // file to be importable from test files, which breaks for pnpm workspace
    // boundary imports. We'll pay the cost of running all tests per mutant
    // in exchange for actually running tests.
    related: false,
  },
  tsconfigFile: "tsconfig.base.json",
  // Surface surviving mutants prominently in clear-text output.
  clearTextReporter: {
    reportMutantsWithoutCoverage: true,
    skipFull: false,
  },
  // JSON report for CI diffing.
  jsonReporter: { fileName: "reports/stryker-report.json" },
  htmlReporter: { fileName: "reports/stryker-report.html" },
};
