// packages/backend/src/agents/context-builder.ts

export interface WorkerContextInput {
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  unitDescription: string;
  unitDeclaredPaths: string[];
  unitDeclaredModules: string[];
  contractCriteria: string[];
  testCommands: string[];
}

export function buildWorkerContext(input: WorkerContextInput): string {
  const sections: string[] = [];

  // Mission context
  sections.push(`# Mission Context\n\n${input.missionDescription}`);

  // Milestone
  sections.push(
    `## Milestone: ${input.milestoneTitle}\n\n${input.milestoneDescription}`,
  );

  // Unit spec
  sections.push(
    `## Your Working Unit\n\n${input.unitDescription}`,
  );

  // Scope constraint
  const scopeParts: string[] = [];
  if (input.unitDeclaredPaths.length > 0) {
    scopeParts.push(`- Paths: ${input.unitDeclaredPaths.join(", ")}`);
  }
  if (input.unitDeclaredModules.length > 0) {
    scopeParts.push(`- Modules: ${input.unitDeclaredModules.join(", ")}`);
  }
  if (scopeParts.length > 0) {
    sections.push(
      `## SCOPE CONSTRAINT\n\nYou MUST only modify files within:\n${scopeParts.join("\n")}`,
    );
  }

  // Validation contract
  if (input.contractCriteria.length > 0) {
    sections.push(
      `## Validation Criteria\n\n${input.contractCriteria.map((c) => `- ${c}`).join("\n")}`,
    );
  }

  // Test commands
  if (input.testCommands.length > 0) {
    sections.push(
      `## Test Commands\n\n${input.testCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n")}`,
    );
  }

  // Handoff reminder
  sections.push(
    `## HANDOFF\n\nWhen complete, use the \`write_handoff\` tool to submit your work. Include all required fields: featureName, description, implemented, remaining, rationale, assumptions, unresolvedUncertainties, errorsEncountered, commandsRun, gitCommitHash.`,
  );

  return sections.join("\n\n");
}
