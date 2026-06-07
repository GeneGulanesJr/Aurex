import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
}

interface RepoSuggestion {
  id: string;
  category: "high_complexity" | "cycles" | "structure";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  affectedFiles: number;
  detail: string;
  prefill: string;
}

interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
}

function generateSuggestions(
  summary: { files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; cycles: { count: number; paths: string[][] } },
  hotspots: { files: Array<{ path: string; module: string; complexity: number; symbols: number }> },
): RepoSuggestion[] {
  const suggestions: RepoSuggestion[] = [];

  for (const file of hotspots.files) {
    if (file.complexity > 20) {
      suggestions.push({
        id: `complexity-${file.path}`,
        category: "high_complexity",
        title: `Refactor ${file.path.split("/").pop()} — complexity score ${file.complexity}`,
        description: `${file.path} has a complexity of ${file.complexity}, above the threshold of 20. High complexity makes code harder to understand, test, and maintain.`,
        priority: file.complexity > 30 ? "high" : "medium",
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Refactor ${file.path} to reduce complexity (currently ${file.complexity}). Break into smaller, focused functions.`,
      });
    }
  }

  if (summary.cycles.count > 0) {
    const moduleNames = [...new Set(summary.cycles.paths.flat())].slice(0, 3).join(", ");
    suggestions.push({
      id: "cycles",
      category: "cycles",
      title: `Break ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""}`,
      description: `${summary.cycles.count} circular dependenc${summary.cycles.count > 1 ? "ies" : "y"} detected. Cycles make modules harder to test independently and can cause build issues.`,
      priority: "high",
      affectedFiles: summary.cycles.paths.flat().length,
      detail: `${summary.cycles.count} cycle${summary.cycles.count > 1 ? "s" : ""} involving: ${moduleNames}`,
      prefill: `Break the ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""} in this codebase. Introduce interfaces or extract shared types to decouple circular imports.`,
    });
  }

  for (const mod of summary.modules) {
    if (mod.fileCount > 20) {
      suggestions.push({
        id: `structure-${mod.name}`,
        category: "structure",
        title: `Split ${mod.name} (${mod.fileCount} files) into focused packages`,
        description: `Module ${mod.name} contains ${mod.fileCount} files, suggesting multiple responsibilities. Splitting would improve maintainability.`,
        priority: "low",
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files in ${mod.name}`,
        prefill: `Split the ${mod.name} module (${mod.fileCount} files) into smaller, more focused packages with clear responsibilities.`,
      });
    }
  }

  return suggestions;
}

export function registerRepoExploreRoutes(app: FastifyInstance, deps: RepoExploreDeps) {
  const { lapis } = deps;

  app.post("/api/repos/:repoName/explore", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await lapis.getSetting<string>(`repo:${repoName}:path`);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }

    try {
      await lapis.indexRepo(repoPath, repoName);
      const summary = await lapis.getCodeSummary(repoName);
      return { repoName, status: "completed" as const, summary };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Indexing failed";
      return { repoName, status: "failed" as const, error };
    }
  });

  app.get("/api/repos/:repoName/summary", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeSummary(repoName);
  });

  app.get("/api/repos/:repoName/hotspots", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeHotspots(repoName);
  });

  app.get("/api/repos/:repoName/suggestions", async (request) => {
    const { repoName } = request.params as { repoName: string };

    let summary = { files: 0, symbols: 0, edges: 0, modules: [] as Array<{ name: string; fileCount: number }>, entryPoints: [] as string[], cycles: { count: 0, paths: [] as string[][] } };
    let hotspots = { files: [] as Array<{ path: string; module: string; complexity: number; symbols: number }> };

    try { summary = await lapis.getCodeSummary(repoName) as typeof summary; } catch { /* partial failure ok */ }
    try { hotspots = await lapis.getCodeHotspots(repoName) as typeof hotspots; } catch { /* partial failure ok */ }

    const suggestions = generateSuggestions(summary, hotspots);
    return { suggestions, analysisVersion: "1.0" } satisfies RepoSuggestionsResponse;
  });
}

export type { RepoSuggestion, RepoSuggestionsResponse };
