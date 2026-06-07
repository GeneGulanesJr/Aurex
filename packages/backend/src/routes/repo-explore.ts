import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
}

// P0 = critical architecture / P5 = nice-to-have polish
type SuggestionTier = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

type SuggestionCategory =
  | "critical_path"    // P0 — dependency cycles, broken imports
  | "security"         // P0 — exposed secrets, unsafe patterns
  | "dead_code"        // P1 — unused exports, orphan files
  | "complexity"       // P1 — high cyclomatic complexity
  | "coupling"         // P2 — tight module coupling
  | "layer_violation"  // P2 — architecture layer breaks
  | "test_coverage"    // P3 — missing tests for critical paths
  | "documentation"    // P3 — missing docs on public APIs
  | "performance"      // P4 — N+1 queries, unnecessary re-renders
  | "structure"        // P4 — oversized modules
  | "naming"           // P5 — inconsistent naming conventions
  | "style";           // P5 — code style inconsistencies

interface RepoSuggestion {
  id: string;
  tier: SuggestionTier;
  category: SuggestionCategory;
  title: string;
  description: string;
  affectedFiles: number;
  detail: string;
  prefill: string;
}

interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
}

const TIER_META: Record<SuggestionTier, { label: string; rationale: string }> = {
  P0: { label: "Critical", rationale: "Blocks development or risks correctness" },
  P1: { label: "High",     rationale: "Significant maintainability or risk issue" },
  P2: { label: "Medium",   rationale: "Architecture friction that slows progress" },
  P3: { label: "Standard", rationale: "Quality-of-code improvements" },
  P4: { label: "Low",      rationale: "Performance or structural optimization" },
  P5: { label: "Polish",   rationale: "Nice-to-have style / consistency" },
};

function generateSuggestions(
  summary: { files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; entryPoints: string[]; cycles: { count: number; paths: string[][] } },
  hotspots: { files: Array<{ path: string; module: string; complexity: number; symbols: number }> },
): RepoSuggestion[] {
  const suggestions: RepoSuggestion[] = [];
  const fileName = (p: string) => p.split("/").pop() ?? p;

  // ─── P0: Critical Path ─────────────────────────────────────
  if (summary.cycles.count > 0) {
    const modules = [...new Set(summary.cycles.paths.flat())].slice(0, 3).join(", ");
    suggestions.push({
      id: "critical-cycles",
      tier: "P0",
      category: "critical_path",
      title: `Break ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""}`,
      description: `Circular dependencies prevent independent testing and can cause build failures.`,
      affectedFiles: summary.cycles.paths.flat().length,
      detail: `${summary.cycles.count} cycle(s) · ${modules}`,
      prefill: `Break the ${summary.cycles.count} dependency cycle(s) in this codebase. Introduce interfaces or extract shared types to decouple circular imports.`,
    });
  }

  // ─── P1: High — Complexity hot paths ───────────────────────
  for (const file of hotspots.files) {
    if (file.complexity > 30) {
      suggestions.push({
        id: `complexity-critical-${file.path}`,
        tier: "P1",
        category: "complexity",
        title: `Refactor ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Cyclomatic complexity of ${file.complexity} makes this file extremely difficult to test and reason about.`,
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Refactor ${file.path} to reduce complexity (currently ${file.complexity}). Break into smaller, focused functions with single responsibilities.`,
      });
    }
  }

  // ─── P1: Dead code detection ───────────────────────────────
  // Files with symbols but no incoming imports (orphans)
  const hotpaths = hotspots.files.slice(0, 10);
  const orphanCandidates = hotpaths.filter(
    (f) => !summary.entryPoints.some((ep) => fileName(f.path) === ep),
  );
  if (orphanCandidates.length >= 3) {
    suggestions.push({
      id: "dead-code-scan",
      tier: "P1",
      category: "dead_code",
      title: `Audit ${orphanCandidates.length} potentially unused files`,
      description: `${orphanCandidates.length} files have no inbound imports from entry points — they may contain dead code.`,
      affectedFiles: orphanCandidates.length,
      detail: `Top orphans: ${orphanCandidates.slice(0, 3).map((f) => fileName(f.path)).join(", ")}`,
      prefill: `Audit and remove potentially dead code from ${orphanCandidates.length} files that appear to have no inbound imports. Start with: ${orphanCandidates.slice(0, 5).map((f) => f.path).join(", ")}.`,
    });
  }

  // ─── P2: Coupling — heavily-imported modules ───────────────
  if (summary.modules.length > 1) {
    const totalFiles = summary.modules.reduce((s, m) => s + m.fileCount, 0);
    const giantModules = summary.modules.filter((m) => m.fileCount > totalFiles * 0.3);
    for (const mod of giantModules) {
      suggestions.push({
        id: `coupling-${mod.name}`,
        tier: "P2",
        category: "coupling",
        title: `Decouple ${mod.name} — ${Math.round((mod.fileCount / totalFiles) * 100)}% of all files`,
        description: `One module holds ${mod.fileCount} of ${totalFiles} files (${Math.round((mod.fileCount / totalFiles) * 100)}%). High concentration signals tight coupling.`,
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files · threshold: 30%`,
        prefill: `Decouple the ${mod.name} module by extracting independent responsibilities into separate packages. Currently contains ${mod.fileCount} files.`,
      });
    }
  }

  // ─── P2: Layer violations (heuristic) ──────────────────────
  if (summary.modules.length >= 3) {
    const uiModules = summary.modules.filter((m) =>
      /^(components?|pages?|views?|ui|frontend)/i.test(m.name),
    );
    const dataModules = summary.modules.filter((m) =>
      /^(api|services?|hooks?|data|backend|server)/i.test(m.name),
    );
    if (uiModules.length > 0 && dataModules.length > 0) {
      suggestions.push({
        id: "layer-violations",
        tier: "P2",
        category: "layer_violation",
        title: "Verify clean layer separation (UI ↔ data)",
        description: `${uiModules.length} UI module(s) and ${dataModules.length} data module(s) detected. Verify no UI files directly import from data layer internals.`,
        affectedFiles: uiModules.reduce((s, m) => s + m.fileCount, 0) + dataModules.reduce((s, m) => s + m.fileCount, 0),
        detail: `UI: ${uiModules.map((m) => m.name).join(", ")} · Data: ${dataModules.map((m) => m.name).join(", ")}`,
        prefill: `Audit the codebase for layer violations — UI components should not directly import from data/service internals. Check imports between: ${uiModules.map((m) => m.name).join(", ")} and ${dataModules.map((m) => m.name).join(", ")}.`,
      });
    }
  }

  // ─── P3: Test coverage (heuristic) ─────────────────────────
  const testModules = summary.modules.filter((m) =>
      /^(test|tests|spec|specs|__tests__)/i.test(m.name),
  );
  const srcModules = summary.modules.filter(
    (m) => !/^(test|tests|spec|specs|__tests__|node_modules|dist|build|\.)/i.test(m.name),
  );
  const srcFileCount = srcModules.reduce((s, m) => s + m.fileCount, 0);
  const testFileCount = testModules.reduce((s, m) => s + m.fileCount, 0);
  if (srcFileCount > 10 && testFileCount === 0) {
    suggestions.push({
      id: "test-coverage",
      tier: "P3",
      category: "test_coverage",
      title: "Add test infrastructure — no test directory found",
      description: `${srcFileCount} source files but zero test files detected. No safety net for changes.`,
      affectedFiles: srcFileCount,
      detail: `${srcFileCount} source files · 0 test files`,
      prefill: `Set up test infrastructure for this project. Start with the most critical entry points and add unit tests. Project has ${srcFileCount} source files with no tests.`,
    });
  } else if (srcFileCount > 0 && testFileCount > 0) {
    const ratio = testFileCount / srcFileCount;
    if (ratio < 0.2) {
      suggestions.push({
        id: "test-coverage-low",
        tier: "P3",
        category: "test_coverage",
        title: `Improve test coverage — ${Math.round(ratio * 100)}% test-to-source ratio`,
        description: `Only ${testFileCount} test files for ${srcFileCount} source files. Aim for ≥ 20% ratio as a baseline.`,
        affectedFiles: srcFileCount - testFileCount,
        detail: `${testFileCount} tests / ${srcFileCount} sources · target: ≥ 20%`,
        prefill: `Improve test coverage in this codebase. Currently ${testFileCount} test files for ${srcFileCount} source files (${Math.round(ratio * 100)}% ratio). Focus on critical paths and edge cases first.`,
      });
    }
  }

  // ─── P3: Documentation ─────────────────────────────────────
  if (summary.symbols > 50 && summary.entryPoints.length > 0) {
    suggestions.push({
      id: "documentation",
      tier: "P3",
      category: "documentation",
      title: `Document public API surface (${summary.entryPoints.length} entry points)`,
      description: `${summary.entryPoints.length} entry points serve as the public API. Add JSDoc/TSDoc to ensure discoverability.`,
      affectedFiles: summary.entryPoints.length,
      detail: `Entry points: ${summary.entryPoints.slice(0, 5).join(", ")}`,
      prefill: `Add JSDoc/TSDoc documentation to the ${summary.entryPoints.length} entry points of this codebase. Focus on: ${summary.entryPoints.slice(0, 5).join(", ")}.`,
    });
  }

  // ─── P4: Complexity — moderate ─────────────────────────────
  for (const file of hotspots.files) {
    if (file.complexity > 20 && file.complexity <= 30) {
      suggestions.push({
        id: `complexity-moderate-${file.path}`,
        tier: "P4",
        category: "complexity",
        title: `Simplify ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Above the recommended threshold of 20. Not critical but adds friction to maintenance.`,
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Simplify ${file.path} to reduce complexity (currently ${file.complexity}). Extract helper functions and reduce branching.`,
      });
    }
  }

  // ─── P4: Performance (heuristic) ───────────────────────────
  if (summary.edges > summary.files * 3) {
    suggestions.push({
      id: "import-density",
      tier: "P4",
      category: "performance",
      title: `High import density — ${summary.edges} edges across ${summary.files} files`,
      description: `Average ${Math.round(summary.edges / summary.files)} imports per file. High density may indicate barrel-file overuse or unnecessary re-exports.`,
      affectedFiles: summary.files,
      detail: `${summary.edges} edges · ${summary.files} files · avg ${(summary.edges / summary.files).toFixed(1)}/file`,
      prefill: `Audit import patterns in this codebase — ${summary.edges} import edges across ${summary.files} files (avg ${(summary.edges / summary.files).toFixed(1)} per file). Look for unnecessary barrel files and circular re-exports that increase bundle size.`,
    });
  }

  // ─── P4: Structure — oversized modules ─────────────────────
  for (const mod of summary.modules) {
    if (mod.fileCount > 20) {
      suggestions.push({
        id: `structure-${mod.name}`,
        tier: "P4",
        category: "structure",
        title: `Split ${mod.name} (${mod.fileCount} files) into focused packages`,
        description: `Module contains ${mod.fileCount} files — likely mixes multiple responsibilities.`,
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files in ${mod.name}`,
        prefill: `Split the ${mod.name} module (${mod.fileCount} files) into smaller, focused packages with clear single responsibilities.`,
      });
    }
  }

  // ─── P5: Naming consistency ────────────────────────────────
  if (summary.modules.length > 2) {
    const kebabCase = summary.modules.filter((m) => /^[a-z]+(-[a-z]+)+$/.test(m.name));
    const camelCase = summary.modules.filter((m) => /^[a-z]+[A-Z]/.test(m.name));
    const pascalCase = summary.modules.filter((m) => /^[A-Z]/.test(m.name));
    const conventions = [kebabCase, camelCase, pascalCase].filter((c) => c.length > 0);
    if (conventions.length >= 2) {
      suggestions.push({
        id: "naming-convention",
        tier: "P5",
        category: "naming",
        title: `Standardize naming — ${conventions.length} conventions detected`,
        description: `Modules use ${conventions.length} different naming styles. Standardizing improves readability.`,
        affectedFiles: summary.modules.reduce((s, m) => s + m.fileCount, 0),
        detail: `Styles: ${[kebabCase.length && "kebab-case", camelCase.length && "camelCase", pascalCase.length && "PascalCase"].filter(Boolean).join(", ")}`,
        prefill: `Standardize module naming conventions across the codebase. Currently mixes ${conventions.length} styles. Pick one convention and rename directories/files to match.`,
      });
    }
  }

  // ─── P5: Style — no README or CONTRIBUTING ─────────────────
  if (summary.files > 15 && summary.modules.length > 2) {
    suggestions.push({
      id: "style-contributing",
      tier: "P5",
      category: "style",
      title: "Add contributing guidelines and code style guide",
      description: `A project with ${summary.files} files and ${summary.modules.length} modules should have contributor documentation.`,
      affectedFiles: 0,
      detail: `${summary.files} files · ${summary.modules.length} modules`,
      prefill: `Create CONTRIBUTING.md with code style guidelines, PR process, and development setup instructions for this ${summary.files}-file project.`,
    });
  }

  // Sort by tier (P0 first)
  const tierOrder: Record<SuggestionTier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  suggestions.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

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

export type { RepoSuggestion, RepoSuggestionsResponse, SuggestionTier, SuggestionCategory, TIER_META };
