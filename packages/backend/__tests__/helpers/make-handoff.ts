import type { Handoff } from "@aurex/shared";

/**
 * Creates a valid Handoff fixture for use in milestone-loop tests.
 * Every field satisfies the `validateHandoff` enforcement rules so
 * tests don't need to hand-craft handoffs for each scenario.
 */
export function makeHandoff(
  unitId: string,
  overrides?: Partial<Handoff>,
): Handoff {
  return {
    unitId,
    featureName: `Feature ${unitId}`,
    description: `Completed ${unitId}`,
    implemented: `Implemented ${unitId}`,
    remaining: "none",
    rationale:
      "The test fixture supplies a valid worker handoff so the scenario can reach validation.",
    assumptions: "Test dependencies are mocked",
    unresolvedUncertainties: "none",
    errorsEncountered: "none",
    commandsRun: [{ command: "npm test", exitCode: 0 }],
    gitCommitHash: "abc123",
    ...overrides,
  };
}
