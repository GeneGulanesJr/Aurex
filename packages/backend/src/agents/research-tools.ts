// packages/backend/src/agents/research-tools.ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface ResearchToolContext {
  missionId: string;
  authorId?: string;
  getAuthorId?: () => string;
}

export function createResearchTools(lapis: LaPisClient, ctx: ResearchToolContext) {
  const writeFinding = defineTool({
    name: "write_finding",
    label: "Write Finding",
    description:
      "Submit a research finding. Findings are tagged by domain for standing checks by Workers later.",
    parameters: Type.Object({
      domain: Type.String({
        description: 'JSON array of module tags (e.g. \'["auth", "middleware"]\')',
      }),
      title: Type.String({ description: "Clear, actionable title" }),
      content: Type.String({
        description: "Substantive finding content — not 'I looked at X' but 'X uses Y which means Z'",
      }),
      relevance: Type.Union(
        [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
        { description: "How critical this finding is" },
      ),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      let domain: string[];
      try {
        domain = JSON.parse(params.domain as string);
        if (!Array.isArray(domain)) domain = [];
      } catch {
        domain = [];
      }

      const authorId = ctx.getAuthorId?.() ?? ctx.authorId ?? "";
      if (!authorId) {
        return {
          content: [{ type: "text" as const, text: "Finding rejected: research session is not registered yet." }],
          details: {} as Record<string, never>,
        };
      }

      await lapis.writeFinding(authorId, {
        missionId: ctx.missionId,
        authorId,
        domain,
        title: params.title as string,
        content: params.content as string,
        relevance: params.relevance as "high" | "medium" | "low",
        status: "unverified",
        verifiedTaskId: null,
        ttl: null,
        expiresAt: null,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: "Finding accepted and recorded. It will be verified by Workers when they encounter the matching domain.",
          },
        ],
        details: {} as Record<string, never>,
      };
    },
  });

  const searchMemory = defineTool({
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search shared project memory for context about patterns, past decisions, and codebase knowledge.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Max results" })),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const results = await lapis.searchMemory(
        params.query as string,
        params.limit ? { limit: params.limit as number } : undefined,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: {} as Record<string, never>,
        };
      }

      const text = results
        .map((r: any) => `## ${r.title}\n${r.content}`)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {} as Record<string, never>,
      };
    },
  });

  return [writeFinding, searchMemory];
}
