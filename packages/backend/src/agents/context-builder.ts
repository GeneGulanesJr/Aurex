// packages/backend/src/agents/context-builder.ts
import type { HandoffRecord, ResearchFinding } from "@aurex/shared";

export interface WorkerContextInput {
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  unitDescription: string;
  unitDeclaredPaths: string[];
  unitDeclaredModules: string[];
  contractCriteria: string[];
  testCommands: string[];
  researchFindings?: ResearchFinding[];
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
  researchFindings?: ResearchFinding[];
  /** Concatenated git diff for all working unit branches against baseBranch. */
  diffSummary?: string;
}

export interface ResearchContextInput {
  missionDescription: string;
  milestoneTitle: string;
  milestoneDescription: string;
  unitDescriptions: string[];
  declaredPaths: string[];
  declaredModules: string[];
}

export function buildResearchContext(input: ResearchContextInput): string {
  const sections: string[] = [];

  sections.push(`# Mission Context\n\n${input.missionDescription}`);
  sections.push(`## Milestone: ${input.milestoneTitle}\n\n${input.milestoneDescription}`);

  if (input.unitDescriptions.length > 0) {
    sections.push(
      `## Working Units\n\nResearch domain knowledge relevant to these tasks:\n${input.unitDescriptions.map((d) => `- ${d}`).join("\n")}`,
    );
  }

  const scopeParts: string[] = [];
  if (input.declaredPaths.length > 0) {
    scopeParts.push(`- Paths: ${input.declaredPaths.join(", ")}`);
  }
  if (input.declaredModules.length > 0) {
    scopeParts.push(`- Modules: ${input.declaredModules.join(", ")}`);
  }
  if (scopeParts.length > 0) {
    sections.push(`## Scope\n\n${scopeParts.join("\n")}`);
  }

  sections.push(
    `## FINDINGS\n\nUse the \`write_finding\` tool to submit findings. Each finding must have a domain (JSON array of module tags), a clear title, substantive content, and a relevance level (high/medium/low). Use \`search_memory\` to look up existing project context.`,
  );

  return sections.join("\n\n");
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

  if (input.researchFindings && input.researchFindings.length > 0) {
    sections.push(buildResearchFindingsSection(input.researchFindings));
  }

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

  if (input.validatorType === "validator_scrutiny") {
    sections.push(buildScrutinyReviewInstructions());
  }

  if (input.diffSummary && input.diffSummary.trim().length > 0) {
    sections.push(
      `## Changed Code (Diff)\n\nThe following is the git diff of all worker changes against the base branch. Review these changes against the contract criteria.\n\n\`\`\`diff\n${input.diffSummary}\n\`\`\``,
    );
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
    [
      "## VERDICT",
      "",
      "When complete, use the `write_verdict` tool. Submit `verdict`, `findings`, and `failedUnitIds`. The milestone, contract, validator type, timestamp, and session are filled automatically.",
      "",
      input.validatorType === "validator_scrutiny"
        ? "For scrutiny review, put the full structured Markdown review in `findings` and use `failedUnitIds` only for units with confirmed failures."
        : "For user testing, describe the broken user-visible behavior in `findings` and list affected units in `failedUnitIds`.",
    ].join("\n"),
  );

  if (input.researchFindings && input.researchFindings.length > 0) {
    sections.push(buildResearchFindingsSection(input.researchFindings));
  }

  return sections.join("\n\n");
}

function buildScrutinyReviewInstructions(): string {
  return [
    "## Single Scoped Feature Review",
    "",
    "Review only the provided milestone context, validation criteria, handoffs, changed worker code, and test output. Do not invent requirements. If context is missing, name it in `Missing context` instead of turning it into an issue.",
    "",
    "Do not introduce new requirements. If something is outside the mission or acceptance criteria, mark it as an optional suggestion, not a blocker.",
    "",
    "False positives are costly. Do not report speculative issues as bugs. Only put confirmed, code-grounded failures under `Issues`.",
    "",
    "Inputs available to this validator:",
    "- Original mission and current milestone",
    "- Validation criteria and acceptance behavior",
    "- Worker branches, declared scope, handoffs, and relevant test commands",
    "- Known constraints included in the mission, contract, or handoffs",
    "",
    "Check for:",
    "- Correctness against the feature goal and validation criteria",
    "- Edge cases and error handling",
    "- Security, authorization, and data validation issues",
    "- State consistency and API contract mismatches",
    "- Performance and backwards compatibility concerns",
    "- Test coverage gaps and maintainability problems",
    "",
    "Decision model:",
    "- `pass`: Criteria are satisfied and there are no merge-blocking issues",
    "- `needs changes`: Confirmed issues require worker fixes; submit `verdict: fail`",
    "- `escalate`: Human judgment is required for scope changes, ambiguous product decisions, cost/time tradeoffs, repeated failures, or risky merges; submit `verdict: fail` and explain the decision needed",
    "",
    "Use this exact `findings` structure:",
    "",
    "```markdown",
    "## Verdict",
    "One of: Looks good / Looks good with nits / Needs changes / Escalate / Blocked / unsafe to merge",
    "",
    "## Issues",
    "",
    "### [Severity: Blocker / Important / Nit] Short title",
    "Evidence:",
    "Quote the exact relevant code snippet or line reference.",
    "",
    "Why it matters:",
    "Explain the concrete failure mode.",
    "",
    "Suggested fix:",
    "Give a practical fix.",
    "",
    "Confidence:",
    "High / Medium / Low",
    "",
    "## Possible risks",
    "List risks that depend on uncertain external behavior. Keep speculative items here, not in Issues.",
    "",
    "## Optional suggestions",
    "List ideas outside the mission or acceptance criteria. These must not block merge.",
    "",
    "## Missing context",
    "List anything needed to verify uncertain points.",
    "",
    "## Tests to add or update",
    "List specific tests that would increase confidence.",
    "```",
  ].join("\n");
}

function buildResearchFindingsSection(findings: ResearchFinding[]): string {
  const items = findings
    .filter((f) => f.status !== "rejected" && f.status !== "expired")
    .map((f) => `### ${f.title} [${f.relevance}]\nDomain: ${f.domain.join(", ")}\n${f.content}`)
    .join("\n\n");
  return `## Research Findings\n\nThe following findings were gathered by the research agent. Use them to inform your work.\n\n${items}`;
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
