// packages/backend/src/agents/worker-tools.ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { Handoff } from "@aurex/shared";

export function createWorkerTools(
  lapis: LaPisClient,
  unitId: string,
  opts?: { onHandoffAccepted?: () => void },
) {
  const writeHandoff = defineTool({
    name: "write_handoff",
    label: "Write Handoff",
    description:
      "Submit your completed work as a structured handoff. This is required when you finish your working unit. Fill in all fields thoroughly — the handoff is validated and incomplete submissions are rejected.",
    parameters: Type.Object({
      featureName: Type.String({ description: "Name of the feature you implemented" }),
      description: Type.String({ description: "Brief description of what was built" }),
      implemented: Type.String({ description: "What you actually implemented" }),
      remaining: Type.String({ description: "What is left to do (can be 'none')" }),
      rationale: Type.String({ description: "Detailed explanation of your design decisions. Why, not what." }),
      assumptions: Type.String({ description: "Assumptions you made during implementation" }),
      unresolvedUncertainties: Type.String({ description: "Things you are unsure about. 'none' is valid." }),
      errorsEncountered: Type.String({ description: "Any errors encountered during implementation" }),
      commandsRun: Type.String({ description: "JSON array of {command, exitCode} objects for tests you ran" }),
      gitCommitHash: Type.String({ description: "The commit hash of your final commit" }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      let commandsRun: { command: string; exitCode: number }[];
      try {
        commandsRun = JSON.parse(params.commandsRun as string);
      } catch {
        commandsRun = [];
      }

      const handoff: Handoff = {
        unitId,
        featureName: params.featureName as string,
        description: params.description as string,
        implemented: params.implemented as string,
        remaining: params.remaining as string,
        rationale: params.rationale as string,
        assumptions: params.assumptions as string,
        unresolvedUncertainties: params.unresolvedUncertainties as string,
        errorsEncountered: params.errorsEncountered as string,
        commandsRun,
        gitCommitHash: params.gitCommitHash as string,
      };

      const result = await lapis.writeHandoff(unitId, handoff);

      if (result.accepted) {
        opts?.onHandoffAccepted?.();
        return {
          content: [{ type: "text" as const, text: "Handoff accepted. Your work has been recorded." }],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Handoff rejected:\n${result.errors.join("\n")}\n\nPlease fix these issues and resubmit.`,
          },
        ],
        details: {},
      };
    },
  });

  const searchMemory = defineTool({
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search shared project memory for context about patterns, past decisions, and codebase knowledge. Use this to find relevant context before implementing.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — be specific for best results" }),
      limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const results = await lapis.searchMemory(
        params.query as string,
        params.limit ? { limit: params.limit as number } : undefined,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: {},
        };
      }

      const text = results
        .map((r) => `## ${r.title}\n${r.content}`)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  });

  return [writeHandoff, searchMemory];
}
