// packages/backend/src/agents/context-builder.ts
import type { HandoffRecord } from "@aurex/shared";

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

export interface ValidatorUnitContext {
  id: string;
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
  taskBranch: string;
  worktreePath: string;
  handoff?: HandoffRecord;
}

export interface ValidatorContextInput {
  validatorType: "validator_scrutiny" | "validator_user_testing";
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  contractId: string;
  contractCriteria: string[];
  testCommands: string[];
  acceptanceBehavior: string;
  baseBranch: string;
  units: ValidatorUnitContext[];
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

export function buildValidatorContext(input: ValidatorContextInput): string {
  const sections: string[] = [];

  sections.push(`# Mission Context\n\n${input.missionDescription}`);
  sections.push(
    `## Milestone: ${input.milestoneTitle}\n\n${input.milestoneDescription}`,
  );

  sections.push(
    [
      "## Validator Assignment",
      "",
      `- Validator type: ${input.validatorType}`,
      `- Contract ID: ${input.contractId}`,
      `- Base branch: ${input.baseBranch}`,
    ].join("\n"),
  );

  if (input.contractCriteria.length > 0) {
    sections.push(
      `## Validation Criteria\n\n${input.contractCriteria.map((c) => `- ${c}`).join("\n")}`,
    );
  }

  if (input.testCommands.length > 0) {
    sections.push(
      `## Test Commands\n\n${input.testCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n")}`,
    );
  }

  if (input.acceptanceBehavior.trim().length > 0) {
    sections.push(`## Acceptance Behavior\n\n${input.acceptanceBehavior}`);
  }

  if (input.units.length > 0) {
    sections.push(
      [
        "## Worker Outputs",
        "",
        ...input.units.map((unit) => {
          const scope = [
            unit.declaredPaths.length > 0 ? `paths=${unit.declaredPaths.join(", ")}` : "paths=(none declared)",
            unit.declaredModules.length > 0 ? `modules=${unit.declaredModules.join(", ")}` : "modules=(none declared)",
          ].join("; ");
          return [
            `### ${unit.id}`,
            unit.description,
            `- Task branch: ${unit.taskBranch}`,
            `- Worktree path: ${unit.worktreePath}`,
            `- Declared scope: ${scope}`,
            unit.handoff ? formatHandoff(unit.handoff) : "- Handoff: not returned by LaPis",
          ].join("\n");
        }),
      ].join("\n\n"),
    );
  }

  sections.push(
    `## VERDICT\n\nWhen complete, use the \`write_verdict\` tool. Submit \`verdict\`, \`findings\`, and \`failedUnitIds\`. The milestone, contract, validator type, timestamp, and session are filled automatically.`,
  );

  return sections.join("\n\n");
}

function formatHandoff(handoff: HandoffRecord): string {
  const commands = handoff.commandsRun.length > 0
    ? handoff.commandsRun.map((c) => `${c.command} (exit ${c.exitCode})`).join("; ")
    : "none";

  return [
    "- Handoff:",
    `  - Record ID: ${handoff.id}`,
    `  - Status: ${handoff.status}`,
    `  - Feature: ${handoff.featureName}`,
    `  - Description: ${handoff.description}`,
    `  - Implemented: ${handoff.implemented}`,
    `  - Remaining: ${handoff.remaining}`,
    `  - Rationale: ${handoff.rationale}`,
    `  - Assumptions: ${handoff.assumptions}`,
    `  - Unresolved uncertainties: ${handoff.unresolvedUncertainties}`,
    `  - Errors encountered: ${handoff.errorsEncountered}`,
    `  - Commands run: ${commands}`,
    `  - Git commit: ${handoff.gitCommitHash}`,
    `  - Created at: ${handoff.createdAt}`,
  ].join("\n");
}
