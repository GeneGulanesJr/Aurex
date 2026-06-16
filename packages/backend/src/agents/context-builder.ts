// packages/backend/src/agents/context-builder.ts
import type { AffectedCodeScaffold, HandoffRecord, ResearchFinding } from "@aurex/shared";

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
  /**
   * Compact map of the code this unit will touch (graph nodes, key import
   * edges, complexity-ranked hotspots). A navigation map — full file bodies
   * stay tool-fetched. Omit/undefined to skip the section (backward-compatible).
   * See Aurex issue #114.
   */
  affectedCode?: AffectedCodeScaffold;
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

export interface ValidatorWorktreeInfo {
  /** Absolute path to the worktree the validator was spawned from. */
  path: string;
  /** Worker branches that merged cleanly into the validation branch. */
  mergedBranches: string[];
  /** Worker branches that had merge conflicts and were NOT applied. */
  conflictedBranches: string[];
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
  /** Optional validator tool-call cap. 0 or undefined means no per-session cap. */
  validatorToolCallCap?: number;
  /**
   * Information about the merged validation worktree the validator is
   * spawned from. When present, the validator's read/bash tools operate
   * from this worktree (which contains all worker code changes merged in).
   * Conflicted branches have NOT been applied — the validator is told so
   * explicitly and is expected to fail those units.
   */
  validatorWorktree?: ValidatorWorktreeInfo;
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

  // Affected-code map (issue #114). Navigation only — fetch full bodies via
  // read/grep tools. Rendered conditionally so absence is backward-compatible.
  if (input.affectedCode) {
    sections.push(buildAffectedCodeSection(input.affectedCode));
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

  if (input.validatorWorktree) {
    const vw = input.validatorWorktree;
    const conflictedUnitIds = vw.conflictedBranches
      .map((branch) => input.units.find((u) => u.taskBranch === branch)?.id)
      .filter((id): id is string => Boolean(id));
    sections.push(
      [
        "## Merged Validation Worktree",
        "",
        `Path: \`${vw.path}\``,
        "",
        "Your `read` and `bash` tool calls operate from THIS directory. The code on disk is the post-worker state — files added or modified by workers ARE present here. Do NOT search the base branch for code that the diff shows as added; it exists here.",
        "",
        `- Merged cleanly: ${vw.mergedBranches.length === 0 ? "(none)" : vw.mergedBranches.join(", ")}`,
        `- Merge conflicts (NOT applied — treat as failed): ${vw.conflictedBranches.length === 0 ? "(none)" : vw.conflictedBranches.join(", ")}`,
        conflictedUnitIds.length > 0
          ? `\nUnits with unmergeable code: ${conflictedUnitIds.join(", ")}. These MUST be listed in \`failedUnitIds\` with the reason "merge conflict — worker code could not be integrated".`
          : "",
      ].filter(Boolean).join("\n"),
    );
  }

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

  const cap = input.validatorToolCallCap ?? 0;
  sections.push(
    [
      "## Tool Use",
      "",
      cap > 0
        ? `This session has a configured cap of ${cap} tool calls. Be decisive.`
        : "There is no per-session tool-call cap, but timeout and mission cost limits still apply. Use tools efficiently.",
      "- After reviewing the diff and running test commands, you should have enough context to write a verdict.",
      "- Do NOT read every file in the diff exhaustively. The diff is already in your context.",
      "- Focus on the 2-3 files most likely to contain real issues.",
      "- Docs and README files are valid context, but blocking findings must be grounded in changed code, contract criteria, handoff evidence, scope boundaries, or test output unless docs are declared scope.",
      "- Call `write_verdict` as soon as you can ground your decision in evidence.",
      "- An unforced failure (no verdict written) wastes an entire worker+validator cycle.",
    ].join("\n"),
  );

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

function buildAffectedCodeSection(scaffold: AffectedCodeScaffold): string {
  const parts: string[] = [];
  parts.push(
    "The following is a NAVIGATION MAP of the code this unit will touch — graph nodes (importance-ranked), key import edges, and complexity-ranked hotspots within your declared scope. It is a map, NOT full source. Fetch full file bodies on demand with your read/grep tools when you need to edit or inspect them. Use the hotspots list to prioritize where to look first.",
  );

  if (scaffold.nodes.length > 0) {
    const nodeLines = scaffold.nodes
      .map((n) => `- ${n.id} (module: ${n.module || "?"}, symbols: ${n.symbols}, importance: ${n.importance})`)
      .join("\n");
    parts.push(`### Graph nodes (${scaffold.nodes.length})\n${nodeLines}`);
  }

  if (scaffold.edges.length > 0) {
    const edgeLines = scaffold.edges
      .map((e) => `- ${e.from} → ${e.to} (${e.kind})`)
      .join("\n");
    parts.push(`### Import edges (${scaffold.edges.length})\n${edgeLines}`);
  }

  if (scaffold.hotspots.length > 0) {
    const hotspotLines = scaffold.hotspots
      .map((h) => `- ${h.path} (complexity: ${h.complexity}, symbols: ${h.symbols})`)
      .join("\n");
    parts.push(`### Hotspots — review these first (${scaffold.hotspots.length})\n${hotspotLines}`);
  }

  if (scaffold.nodes.length === 0 && scaffold.edges.length === 0 && scaffold.hotspots.length === 0) {
    parts.push("(No affected code matched this unit's declared scope. Rely on your read/grep tools.)");
  }

  if (scaffold.truncated) {
    parts.push("_Map trimmed to token budget; additional nodes/edges/hotspots may exist — use your tools to explore beyond this list._");
  }

  return `## Affected Code (Map)\n\n${parts.join("\n\n")}`;
}

function buildResearchFindingsSection(findings: ResearchFinding[]): string {
  const items = findings
    .filter((f) => f.status !== "rejected" && f.status !== "expired")
    .map((f) => {
      const domain = Array.isArray(f.domain) ? f.domain : [String(f.domain ?? "general")];
      return `### ${f.title} [${f.relevance}]\nDomain: ${domain.join(", ")}\n${f.content}`;
    })
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
