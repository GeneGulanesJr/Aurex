import type { IsolatedIssue, ReviewReadinessProfile, SuggestionCategory } from "@aurex/shared";
import {
  buildAffectedCodeScaffold,
  type CodeGraphInput,
  type HotspotsInput,
} from "../orchestrator/affected-code.js";
import type { IssueDraft } from "./issue-isolator.js";

export const FIX_PROMPT_VERSION = "1.0-template";

export interface FixPromptContext {
  graph: CodeGraphInput;
  hotspots: HotspotsInput;
  readiness: ReviewReadinessProfile | null;
}

function verificationCommands(readiness: ReviewReadinessProfile | null): string[] {
  if (!readiness) return ["Run the project's test and typecheck commands."];
  const names: Array<ReviewReadinessProfile["commands"][number]["name"]> = ["test", "typecheck", "lint"];
  const cmds: string[] = [];
  for (const name of names) {
    const hit = readiness.commands.find((c) => c.name === name);
    if (hit) cmds.push(`\`${hit.command}\``);
  }
  if (cmds.length === 0 && readiness.commands.length > 0) {
    cmds.push(`\`${readiness.commands[0].command}\``);
  }
  return cmds.length > 0 ? cmds : ["Run the project's test suite."];
}

function proposedFix(draft: IssueDraft): string {
  const cat: SuggestionCategory = draft.category;
  switch (cat) {
    case "critical_path":
      return [
        "1. Identify the import edge that closes the cycle (see Context below).",
        "2. Extract shared types or an interface into a neutral module both sides can import.",
        "3. Change one side to depend on the abstraction instead of the concrete module.",
        "4. Re-run indexing — this specific cycle path should no longer appear.",
      ].join("\n");
    case "security":
      return [
        "1. Open the manifest/lockfile referencing the flagged package.",
        "2. Upgrade to a patched version or replace with a maintained alternative.",
        "3. Update the lockfile and verify no transitive dependency reintroduces the package.",
        "4. Run install + tests to confirm nothing breaks.",
      ].join("\n");
    case "dead_code":
      return [
        "1. Search the repo for imports/references to this file.",
        "2. If truly unused, remove the file and any barrel exports pointing to it.",
        "3. If used dynamically, add a comment explaining why it must stay.",
      ].join("\n");
    case "complexity":
      return [
        "1. List the highest-branching functions in the scoped file.",
        "2. Extract each into a named helper with a single responsibility.",
        "3. Preserve public API and behavior — no functional changes.",
        "4. Complexity for this file should drop below the threshold.",
      ].join("\n");
    case "coupling":
      return [
        "1. Within the scoped module, pick ONE subdirectory or concern to extract.",
        "2. Move it to a new module with explicit exports.",
        "3. Update imports in callers — do not refactor unrelated code.",
      ].join("\n");
    case "layer_violation":
      return [
        "1. Find one UI file that imports from a data/service internal.",
        "2. Introduce a facade/hook at the UI boundary or move shared types to a neutral layer.",
        "3. Remove the direct deep import.",
      ].join("\n");
    case "documentation":
      return [
        "1. Address the specific blocker described in the Problem section.",
        "2. Update README or package scripts so install/test/build work.",
      ].join("\n");
    case "structure":
      return [
        "1. Choose one cohesive subfolder inside the large module.",
        "2. Extract it with clear public exports.",
        "3. Leave the rest of the module unchanged in this change.",
      ].join("\n");
    default:
      return [
        "1. Make the smallest change that resolves the issue described above.",
        "2. Stay within the scoped files/modules only.",
        "3. Run verification commands after the change.",
      ].join("\n");
  }
}

function formatScaffoldContext(draft: IssueDraft, ctx: FixPromptContext): string {
  const scaffold = buildAffectedCodeScaffold({
    unitId: draft.id,
    declaredPaths: draft.scopePaths,
    declaredModules: draft.scopeModules,
    graph: ctx.graph,
    hotspots: ctx.hotspots,
    maxNodes: 8,
    maxEdges: 10,
    maxHotspots: 5,
    tokenBudget: 400,
  });

  const lines: string[] = [];
  if (draft.scopePaths.length > 0) {
    lines.push(`- **Affected files:** ${draft.scopePaths.map((p) => `\`${p}\``).join(", ")}`);
  }
  if (draft.scopeModules.length > 0) {
    lines.push(`- **Modules:** ${draft.scopeModules.map((m) => `\`${m}\``).join(", ")}`);
  }
  for (const ev of draft.evidence) {
    const filePart = ev.file ? ` (\`${ev.file}\`)` : "";
    lines.push(`- **Evidence:** ${ev.message}${filePart}`);
  }
  if (scaffold.edges.length > 0) {
    lines.push("- **Import edges:**");
    for (const e of scaffold.edges.slice(0, 6)) {
      lines.push(`  - \`${e.from}\` → \`${e.to}\` (${e.kind})`);
    }
  }
  if (scaffold.hotspots.length > 0) {
    lines.push("- **Hotspots in scope:**");
    for (const h of scaffold.hotspots) {
      lines.push(`  - \`${h.path}\` — complexity ${h.complexity}, ${h.symbols} symbols`);
    }
  }
  if (scaffold.nodes.length > 0) {
    lines.push("- **Neighbors (by importance):**");
    for (const n of scaffold.nodes.slice(0, 5)) {
      lines.push(`  - \`${n.id}\` (importance ${n.importance})`);
    }
  }
  return lines.join("\n");
}

export function buildFixPrompt(draft: IssueDraft, ctx: FixPromptContext): string {
  const verify = verificationCommands(ctx.readiness);
  const scopeIn = draft.scopePaths.length > 0
    ? draft.scopePaths.map((p) => `\`${p}\``).join(", ")
    : draft.scopeModules.length > 0
      ? `modules: ${draft.scopeModules.join(", ")}`
      : "files tied to this issue only (see evidence)";

  return [
    "## Issue",
    draft.title,
    "",
    "## Problem",
    draft.description,
    "",
    draft.detail ? `_Detail: ${draft.detail}_` : "",
    "",
    "## Context (from LaPis index)",
    formatScaffoldContext(draft, ctx),
    "",
    "## Proposed fix",
    proposedFix(draft),
    "",
    "## Scope",
    `- **In:** ${scopeIn}`,
    "- **Out:** no unrelated refactors, no new features, no drive-by changes",
    "",
    "## Verification",
    "Run after applying the fix:",
    ...verify.map((c) => `- ${c}`),
    draft.category === "critical_path"
      ? "- Re-scan: this cycle path should no longer appear in LaPis dependency cycles"
      : draft.category === "complexity"
        ? "- Complexity for the scoped file should drop below the threshold"
        : "",
  ].filter(Boolean).join("\n");
}

export function attachFixPrompts(
  drafts: IssueDraft[],
  ctx: FixPromptContext,
): IsolatedIssue[] {
  return drafts.map((draft) => ({
    ...draft,
    fixPrompt: buildFixPrompt(draft, ctx),
    fixPromptVersion: FIX_PROMPT_VERSION,
    status: "open" as const,
  }));
}

export function exportReviewMarkdown(repoName: string, issues: IsolatedIssue[]): string {
  const lines = [
    `# Code Review — ${repoName}`,
    "",
    `Generated ${new Date().toISOString()} · ${issues.length} isolated issue(s)`,
    "",
  ];
  for (const issue of issues) {
    lines.push("---", "", issue.fixPrompt, "");
  }
  return lines.join("\n");
}
