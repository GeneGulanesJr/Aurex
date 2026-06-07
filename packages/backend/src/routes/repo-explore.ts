import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import type { BumblebeeFinding, BumblebeeScanResult, BumblebeeScanSummary } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeClient } from "../clients/bumblebee-client.js";
import { scanRepoForMutation } from "../scanner/mutation-scanner.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
  bumblebeeClient?: BumblebeeClient;
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

type SuggestionConfidence = "high" | "medium" | "low";
type SuggestionEffort = "small" | "medium" | "large";
type SuggestionRisk = "low" | "medium" | "high";

interface SuggestionEvidence {
  type: "lapis" | "package_scan" | "manifest" | "heuristic" | "readiness";
  message: string;
  file?: string;
}

interface RepoSuggestion {
  id: string;
  tier: SuggestionTier;
  category: SuggestionCategory;
  title: string;
  description: string;
  affectedFiles: number;
  detail: string;
  prefill: string;
  confidence?: SuggestionConfidence;
  estimatedEffort?: SuggestionEffort;
  estimatedRisk?: SuggestionRisk;
  evidence?: SuggestionEvidence[];
  labels?: string[];
}

interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
  recommended?: {
    highestImpact?: string;
    safestFirst?: string;
  };
}

interface RepoReadinessCommand {
  name: "install" | "test" | "typecheck" | "lint" | "build" | "dev" | "e2e";
  command: string;
  confidence: SuggestionConfidence;
  source: string;
  warning?: string;
}

interface RepoReadinessProfile {
  repoName: string;
  profile: string;
  packageManager: string | null;
  languages: string[];
  frameworks: string[];
  monorepo: boolean;
  lockfiles: string[];
  commands: RepoReadinessCommand[];
  blockers: string[];
  warnings: string[];
  confidence: SuggestionConfidence;
  generatedAt: string;
}

interface RepoPackageScanResponse {
  scan: BumblebeeScanResult;
  findings: BumblebeeFinding[];
  packageCount: number;
}

const TIER_META: Record<SuggestionTier, { label: string; rationale: string }> = {
  P0: { label: "Critical", rationale: "Blocks development or risks correctness" },
  P1: { label: "High",     rationale: "Significant maintainability or risk issue" },
  P2: { label: "Medium",   rationale: "Architecture friction that slows progress" },
  P3: { label: "Standard", rationale: "Quality-of-code improvements" },
  P4: { label: "Low",      rationale: "Performance or structural optimization" },
  P5: { label: "Polish",   rationale: "Nice-to-have style / consistency" },
};

function withMeta(suggestion: RepoSuggestion): RepoSuggestion {
  return {
    confidence: "medium",
    estimatedEffort: "medium",
    estimatedRisk: "medium",
    evidence: [],
    labels: [],
    ...suggestion,
  };
}

function generateSuggestions(
  summary: { files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; entryPoints: string[]; cycles: { count: number; paths: string[][] } },
  hotspots: { files: Array<{ path: string; module: string; complexity: number; symbols: number }> },
  scan?: BumblebeeScanResult | null,
  readiness?: RepoReadinessProfile | null,
): RepoSuggestion[] {
  const suggestions: RepoSuggestion[] = [];
  const fileName = (p: string) => p.split("/").pop() ?? p;

  // ─── P0/P1: Supply-chain findings ───────────────────────────
  const findings = scan?.findings ?? [];
  const severityTier: Record<BumblebeeFinding["severity"], SuggestionTier> = {
    critical: "P0",
    high: "P1",
    medium: "P2",
    low: "P4",
  };
  for (const finding of findings) {
    suggestions.push(withMeta({
      id: `package-${finding.severity}-${finding.packageName}-${finding.version}-${finding.catalogId ?? finding.findingType ?? finding.id}`,
      tier: severityTier[finding.severity],
      category: "security",
      title: `${finding.severity === "critical" ? "Remove or upgrade" : "Audit"} ${finding.packageName}@${finding.version}`,
      description: finding.catalogName || finding.evidence || `${finding.packageName} matched a supply-chain risk rule.`,
      affectedFiles: 1,
      detail: `${finding.severity.toUpperCase()} · ${finding.sourceType || "dependency"} · ${finding.sourceFile}`,
      prefill: `Resolve the ${finding.severity} supply-chain finding for ${finding.packageName}@${finding.version}. Inspect ${finding.sourceFile}, upgrade or replace the package, update the lockfile, and run the detected verification commands. Evidence: ${finding.evidence}`,
      confidence: finding.confidence,
      estimatedEffort: finding.severity === "critical" || finding.severity === "high" ? "medium" : "small",
      estimatedRisk: finding.severity === "critical" || finding.severity === "high" ? "high" : "medium",
      evidence: [{ type: "package_scan", message: finding.evidence, file: finding.sourceFile }],
      labels: ["highest-impact", "supply-chain"],
    }));
  }

  // ─── P0: Critical Path ─────────────────────────────────────
  if (summary.cycles.count > 0) {
    const modules = [...new Set(summary.cycles.paths.flat())].slice(0, 3).join(", ");
    suggestions.push(withMeta({
      id: "critical-cycles",
      tier: "P0",
      category: "critical_path",
      title: `Break ${summary.cycles.count} dependency cycle${summary.cycles.count > 1 ? "s" : ""}`,
      description: `Circular dependencies prevent independent testing and can cause build failures.`,
      affectedFiles: summary.cycles.paths.flat().length,
      detail: `${summary.cycles.count} cycle(s) · ${modules}`,
      prefill: `Break the ${summary.cycles.count} dependency cycle(s) in this codebase. Introduce interfaces or extract shared types to decouple circular imports.`,
      confidence: "high",
      estimatedEffort: summary.cycles.count > 2 ? "large" : "medium",
      estimatedRisk: "high",
      evidence: [{ type: "lapis", message: `LaPis detected ${summary.cycles.count} dependency cycle(s): ${modules}` }],
      labels: ["highest-impact"],
    }));
  }

  // ─── P1: High — Complexity hot paths ───────────────────────
  for (const file of hotspots.files) {
    if (file.complexity > 30) {
      suggestions.push(withMeta({
        id: `complexity-critical-${file.path}`,
        tier: "P1",
        category: "complexity",
        title: `Refactor ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Cyclomatic complexity of ${file.complexity} makes this file extremely difficult to test and reason about.`,
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Refactor ${file.path} to reduce complexity (currently ${file.complexity}). Break into smaller, focused functions with single responsibilities. Preserve behavior and run the detected test/typecheck commands.`,
        confidence: "high",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "lapis", message: `Complexity ${file.complexity} with ${file.symbols} symbols`, file: file.path }],
      }));
    }
  }

  // ─── P1: Dead code detection ───────────────────────────────
  // Files with symbols but no incoming imports (orphans)
  const hotpaths = hotspots.files.slice(0, 10);
  const orphanCandidates = hotpaths.filter(
    (f) => !summary.entryPoints.some((ep) => fileName(f.path) === ep),
  );
  if (orphanCandidates.length >= 3) {
    suggestions.push(withMeta({
      id: "dead-code-scan",
      tier: "P1",
      category: "dead_code",
      title: `Audit ${orphanCandidates.length} potentially unused files`,
      description: `${orphanCandidates.length} files have no inbound imports from entry points — they may contain dead code.`,
      affectedFiles: orphanCandidates.length,
      detail: `Top orphans: ${orphanCandidates.slice(0, 3).map((f) => fileName(f.path)).join(", ")}`,
      prefill: `Audit and remove potentially dead code from ${orphanCandidates.length} files that appear to have no inbound imports. Start with: ${orphanCandidates.slice(0, 5).map((f) => f.path).join(", ")}. Confirm usage before deleting anything.`,
      confidence: "low",
      estimatedEffort: "medium",
      estimatedRisk: "medium",
      evidence: orphanCandidates.slice(0, 5).map((f) => ({ type: "heuristic" as const, message: "Hotspot does not match a detected entry point", file: f.path })),
    }));
  }

  // ─── P2: Coupling — heavily-imported modules ───────────────
  if (summary.modules.length > 1) {
    const totalFiles = summary.modules.reduce((s, m) => s + m.fileCount, 0);
    const giantModules = summary.modules.filter((m) => m.fileCount > totalFiles * 0.3);
    for (const mod of giantModules) {
      suggestions.push(withMeta({
        id: `coupling-${mod.name}`,
        tier: "P2",
        category: "coupling",
        title: `Decouple ${mod.name} — ${Math.round((mod.fileCount / totalFiles) * 100)}% of all files`,
        description: `One module holds ${mod.fileCount} of ${totalFiles} files (${Math.round((mod.fileCount / totalFiles) * 100)}%). High concentration signals tight coupling.`,
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files · threshold: 30%`,
        prefill: `Decouple the ${mod.name} module by extracting independent responsibilities into separate packages. Currently contains ${mod.fileCount} files. Start with the lowest-risk seams and preserve public API behavior.`,
        confidence: "medium",
        estimatedEffort: "large",
        estimatedRisk: "high",
        evidence: [{ type: "lapis", message: `${mod.name} owns ${mod.fileCount}/${totalFiles} files` }],
      }));
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
      suggestions.push(withMeta({
        id: "layer-violations",
        tier: "P2",
        category: "layer_violation",
        title: "Verify clean layer separation (UI ↔ data)",
        description: `${uiModules.length} UI module(s) and ${dataModules.length} data module(s) detected. Verify no UI files directly import from data layer internals.`,
        affectedFiles: uiModules.reduce((s, m) => s + m.fileCount, 0) + dataModules.reduce((s, m) => s + m.fileCount, 0),
        detail: `UI: ${uiModules.map((m) => m.name).join(", ")} · Data: ${dataModules.map((m) => m.name).join(", ")}`,
        prefill: `Audit the codebase for layer violations — UI components should not directly import from data/service internals. Check imports between: ${uiModules.map((m) => m.name).join(", ")} and ${dataModules.map((m) => m.name).join(", ")}.`,
        confidence: "low",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "heuristic", message: "UI-like and data-like modules were both detected" }],
      }));
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
    suggestions.push(withMeta({
      id: "test-coverage",
      tier: "P3",
      category: "test_coverage",
      title: "Add test infrastructure — no test directory found",
      description: `${srcFileCount} source files but zero test files detected. No safety net for changes.`,
      affectedFiles: srcFileCount,
      detail: `${srcFileCount} source files · 0 test files`,
      prefill: `Set up test infrastructure for this project. Start with the most critical entry points and add unit tests. Project has ${srcFileCount} source files with no tests.`,
      confidence: "medium",
      estimatedEffort: "large",
      estimatedRisk: "low",
      evidence: [{ type: "lapis", message: `${srcFileCount} source files and no test modules detected` }],
      labels: ["safest-first"],
    }));
  } else if (srcFileCount > 0 && testFileCount > 0) {
    const ratio = testFileCount / srcFileCount;
    if (ratio < 0.2) {
      suggestions.push(withMeta({
        id: "test-coverage-low",
        tier: "P3",
        category: "test_coverage",
        title: `Improve test coverage — ${Math.round(ratio * 100)}% test-to-source ratio`,
        description: `Only ${testFileCount} test files for ${srcFileCount} source files. Aim for ≥ 20% ratio as a baseline.`,
        affectedFiles: srcFileCount - testFileCount,
        detail: `${testFileCount} tests / ${srcFileCount} sources · target: ≥ 20%`,
        prefill: `Improve test coverage in this codebase. Currently ${testFileCount} test files for ${srcFileCount} source files (${Math.round(ratio * 100)}% ratio). Focus on critical paths and edge cases first.`,
        confidence: "medium",
        estimatedEffort: "medium",
        estimatedRisk: "low",
        evidence: [{ type: "lapis", message: `${testFileCount}/${srcFileCount} test-to-source file ratio` }],
        labels: ["safest-first"],
      }));
    }
  }

  // ─── P3: Documentation ─────────────────────────────────────
  if (summary.symbols > 50 && summary.entryPoints.length > 0) {
    suggestions.push(withMeta({
      id: "documentation",
      tier: "P3",
      category: "documentation",
      title: `Document public API surface (${summary.entryPoints.length} entry points)`,
      description: `${summary.entryPoints.length} entry points serve as the public API. Add JSDoc/TSDoc to ensure discoverability.`,
      affectedFiles: summary.entryPoints.length,
      detail: `Entry points: ${summary.entryPoints.slice(0, 5).join(", ")}`,
      prefill: `Add JSDoc/TSDoc documentation to the ${summary.entryPoints.length} entry points of this codebase. Focus on: ${summary.entryPoints.slice(0, 5).join(", ")}.`,
      confidence: "medium",
      estimatedEffort: "small",
      estimatedRisk: "low",
      evidence: [{ type: "lapis", message: `${summary.entryPoints.length} entry points and ${summary.symbols} symbols detected` }],
    }));
  }

  // ─── P3: Readiness blockers ────────────────────────────────
  if (readiness?.blockers.length) {
    suggestions.push(withMeta({
      id: "readiness-blockers",
      tier: "P3",
      category: "documentation",
      title: `Resolve ${readiness.blockers.length} repo setup blocker${readiness.blockers.length > 1 ? "s" : ""}`,
      description: readiness.blockers[0],
      affectedFiles: 0,
      detail: readiness.blockers.join(" · "),
      prefill: `Resolve the repository setup blockers detected during readiness analysis: ${readiness.blockers.join("; ")}. Update setup documentation and add/repair scripts so agents can install, test, and build safely.`,
      confidence: readiness.confidence,
      estimatedEffort: "small",
      estimatedRisk: "low",
      evidence: readiness.blockers.map((message) => ({ type: "readiness" as const, message })),
      labels: ["safest-first"],
    }));
  }

  // ─── P4: Complexity — moderate ─────────────────────────────
  for (const file of hotspots.files) {
    if (file.complexity > 20 && file.complexity <= 30) {
      suggestions.push(withMeta({
        id: `complexity-moderate-${file.path}`,
        tier: "P4",
        category: "complexity",
        title: `Simplify ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Moderate complexity hotspot. Consider extracting helpers before it becomes harder to maintain.`,
        affectedFiles: 1,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        prefill: `Simplify ${file.path} by extracting helper functions and clarifying branching. Keep behavior unchanged and run relevant tests.`,
        confidence: "high",
        estimatedEffort: "small",
        estimatedRisk: "low",
        evidence: [{ type: "lapis", message: `Complexity ${file.complexity}`, file: file.path }],
      }));
    }
  }

  // ─── P4: Performance — dense dependency graph ──────────────
  if (summary.files > 0 && summary.edges / Math.max(summary.files, 1) > 5) {
    suggestions.push(withMeta({
      id: "performance-import-density",
      tier: "P4",
      category: "performance",
      title: `Audit import density — ${(summary.edges / summary.files).toFixed(1)} edges/file`,
      description: `High import density can slow builds and inflate bundles.`,
      affectedFiles: summary.files,
      detail: `${summary.edges} imports across ${summary.files} files`,
      prefill: `Audit import density in this codebase: ${summary.edges} imports across ${summary.files} files (avg ${(summary.edges / summary.files).toFixed(1)} per file). Look for unnecessary barrel files and circular re-exports that increase bundle size.`,
      confidence: "medium",
      estimatedEffort: "medium",
      estimatedRisk: "low",
      evidence: [{ type: "lapis", message: `${summary.edges} edges across ${summary.files} files` }],
    }));
  }

  // ─── P4: Structure — oversized modules ─────────────────────
  for (const mod of summary.modules) {
    if (mod.fileCount > 20) {
      suggestions.push(withMeta({
        id: `structure-${mod.name}`,
        tier: "P4",
        category: "structure",
        title: `Split ${mod.name} (${mod.fileCount} files) into focused packages`,
        description: `Module contains ${mod.fileCount} files — likely mixes multiple responsibilities.`,
        affectedFiles: mod.fileCount,
        detail: `${mod.fileCount} files in ${mod.name}`,
        prefill: `Split the ${mod.name} module (${mod.fileCount} files) into smaller, focused packages with clear single responsibilities.`,
        confidence: "medium",
        estimatedEffort: "large",
        estimatedRisk: "medium",
        evidence: [{ type: "lapis", message: `${mod.name} contains ${mod.fileCount} files` }],
      }));
    }
  }

  // ─── P5: Naming consistency ────────────────────────────────
  if (summary.modules.length > 2) {
    const kebabCase = summary.modules.filter((m) => /^[a-z]+(-[a-z]+)+$/.test(m.name));
    const camelCase = summary.modules.filter((m) => /^[a-z]+[A-Z]/.test(m.name));
    const pascalCase = summary.modules.filter((m) => /^[A-Z]/.test(m.name));
    const conventions = [kebabCase, camelCase, pascalCase].filter((c) => c.length > 0);
    if (conventions.length >= 2) {
      suggestions.push(withMeta({
        id: "naming-convention",
        tier: "P5",
        category: "naming",
        title: `Standardize naming — ${conventions.length} conventions detected`,
        description: `Modules use ${conventions.length} different naming styles. Standardizing improves readability.`,
        affectedFiles: summary.modules.reduce((s, m) => s + m.fileCount, 0),
        detail: `Styles: ${[kebabCase.length && "kebab-case", camelCase.length && "camelCase", pascalCase.length && "PascalCase"].filter(Boolean).join(", ")}`,
        prefill: `Standardize module naming conventions across the codebase. Currently mixes ${conventions.length} styles. Pick one convention and rename directories/files to match.`,
        confidence: "medium",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "heuristic", message: `${conventions.length} naming conventions detected` }],
      }));
    }
  }

  // ─── P5: Style — no README or CONTRIBUTING ─────────────────
  if (summary.files > 15 && summary.modules.length > 2) {
    suggestions.push(withMeta({
      id: "style-contributing",
      tier: "P5",
      category: "style",
      title: "Add contributing guidelines and code style guide",
      description: `A project with ${summary.files} files and ${summary.modules.length} modules should have contributor documentation.`,
      affectedFiles: 0,
      detail: `${summary.files} files · ${summary.modules.length} modules`,
      prefill: `Create CONTRIBUTING.md with code style guidelines, PR process, and development setup instructions for this ${summary.files}-file project.`,
      confidence: "low",
      estimatedEffort: "small",
      estimatedRisk: "low",
      evidence: [{ type: "heuristic", message: `${summary.files} files and ${summary.modules.length} modules detected` }],
    }));
  }

  // Sort by tier (P0 first), then risk/confidence labels
  const tierOrder: Record<SuggestionTier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  suggestions.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  return suggestions;
}

function recommendSuggestions(suggestions: RepoSuggestion[]): RepoSuggestionsResponse["recommended"] {
  const highestImpact = suggestions.find((s) => s.labels?.includes("highest-impact")) ?? suggestions[0];
  const safestFirst = suggestions.find((s) => s.labels?.includes("safest-first"))
    ?? suggestions.find((s) => s.estimatedRisk === "low" && (s.estimatedEffort === "small" || s.estimatedEffort === "medium"))
    ?? suggestions.find((s) => s.tier === "P3" || s.tier === "P4");
  return {
    highestImpact: highestImpact?.id,
    safestFirst: safestFirst?.id,
  };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

const MAX_READINESS_FILES = 2000;

async function listFiles(root: string, maxDepth = 3, maxFiles = MAX_READINESS_FILES): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (entry.name.startsWith(".git") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  }
  await walk(root, 0);
  return out;
}

function detectPackageManager(files: string[]): string | null {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("Cargo.lock")) return "cargo";
  if (files.includes("poetry.lock")) return "poetry";
  if (files.includes("uv.lock")) return "uv";
  if (files.includes("go.sum")) return "go";
  return null;
}

function commandPrefix(manager: string | null): string {
  if (manager === "pnpm") return "pnpm";
  if (manager === "yarn") return "yarn";
  if (manager === "bun") return "bun";
  return "npm run";
}

function addPackageScriptCommands(commands: RepoReadinessCommand[], manager: string | null, scripts: Record<string, unknown>, source: string) {
  const prefix = commandPrefix(manager);
  const scriptMap: Array<[RepoReadinessCommand["name"], string[]]> = [
    ["test", ["test", "test:unit"]],
    ["typecheck", ["typecheck", "tsc"]],
    ["lint", ["lint"]],
    ["build", ["build"]],
    ["dev", ["dev", "start"]],
    ["e2e", ["test:e2e", "e2e"]],
  ];
  for (const [name, candidates] of scriptMap) {
    const script = candidates.find((s) => typeof scripts[s] === "string");
    if (!script) continue;
    commands.push({
      name,
      command: manager === "npm" || manager === null ? `npm run ${script}` : `${prefix} ${script}`,
      confidence: "high",
      source,
      warning: name === "e2e" ? "May require browsers, services, or Docker" : undefined,
    });
  }
}

async function buildReadinessProfile(repoName: string, repoPath: string): Promise<RepoReadinessProfile> {
  const files = await listFiles(repoPath, 4);
  const fileSet = new Set(files);
  const rootPkg = await readJson(join(repoPath, "package.json"));
  const scripts = (rootPkg?.scripts && typeof rootPkg.scripts === "object" ? rootPkg.scripts : {}) as Record<string, unknown>;
  const deps = {
    ...((rootPkg?.dependencies && typeof rootPkg.dependencies === "object") ? rootPkg.dependencies as Record<string, unknown> : {}),
    ...((rootPkg?.devDependencies && typeof rootPkg.devDependencies === "object") ? rootPkg.devDependencies as Record<string, unknown> : {}),
  };
  const packageManager = detectPackageManager(files);
  const lockfiles = files.filter((f) => /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb|bun\.lock|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum)$/.test(f));
  const commands: RepoReadinessCommand[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (rootPkg) {
    const install = packageManager === "pnpm" ? "pnpm install" : packageManager === "yarn" ? "yarn install" : packageManager === "bun" ? "bun install" : "npm install";
    commands.push({ name: "install", command: install, confidence: packageManager ? "high" : "medium", source: "package.json" });
    addPackageScriptCommands(commands, packageManager, scripts, "package.json");
    if (!lockfiles.some((f) => /pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb|bun\.lock/.test(f))) {
      warnings.push("JavaScript package manifest found without a lockfile; dependency installs may be non-deterministic.");
    }
  }

  if (fileSet.has("Cargo.toml")) {
    commands.push({ name: "test", command: "cargo test", confidence: "high", source: "Cargo.toml" });
    commands.push({ name: "build", command: "cargo build", confidence: "high", source: "Cargo.toml" });
  }
  if (fileSet.has("go.mod")) {
    commands.push({ name: "test", command: "go test ./...", confidence: "high", source: "go.mod" });
    commands.push({ name: "build", command: "go build ./...", confidence: "medium", source: "go.mod" });
  }
  if (fileSet.has("pyproject.toml") || fileSet.has("pytest.ini")) {
    commands.push({ name: "test", command: "pytest", confidence: "medium", source: fileSet.has("pytest.ini") ? "pytest.ini" : "pyproject.toml" });
  }

  const languages = [
    files.some((f) => /\.(ts|tsx)$/.test(f)) && "TypeScript",
    files.some((f) => /\.(js|jsx|mjs|cjs)$/.test(f)) && "JavaScript",
    files.some((f) => /\.py$/.test(f)) && "Python",
    files.some((f) => /\.rs$/.test(f)) && "Rust",
    files.some((f) => /\.go$/.test(f)) && "Go",
  ].filter(Boolean) as string[];

  const frameworks = [
    ("react" in deps) && "React",
    ("next" in deps) && "Next.js",
    ("vite" in deps || fileSet.has("vite.config.ts") || fileSet.has("vite.config.js")) && "Vite",
    ("fastify" in deps) && "Fastify",
    ("express" in deps) && "Express",
    ("vitest" in deps || fileSet.has("vitest.config.ts")) && "Vitest",
  ].filter(Boolean) as string[];

  const monorepo = fileSet.has("pnpm-workspace.yaml") || fileSet.has("turbo.json") || fileSet.has("nx.json") || files.some((f) => /^packages\/[^/]+\/package\.json$/.test(f));
  const hasEnvExample = files.some((f) => /(^|\/)\.env(\.example|\.sample|\.template)$/.test(f));
  const hasEnvReference = files.some((f) => /(^|\/)\.env$/.test(f));
  if (hasEnvReference && !hasEnvExample) {
    warnings.push("Environment file detected without a matching .env.example/.env.sample template.");
  }
  if (!commands.some((c) => c.name === "test")) {
    blockers.push("No obvious test command was detected.");
  }
  if (rootPkg && !commands.some((c) => c.name === "build" || c.name === "typecheck")) {
    warnings.push("No obvious build or typecheck command was detected.");
  }
  if (files.some((f) => /^docker-compose/.test(f))) {
    warnings.push("Docker Compose files detected; some verification commands may require local services.");
  }

  const profile = [
    languages.includes("TypeScript") ? "TypeScript" : languages[0],
    monorepo ? "monorepo" : "project",
    frameworks[0],
  ].filter(Boolean).join(" ") || "Unknown project";

  return {
    repoName,
    profile,
    packageManager,
    languages,
    frameworks,
    monorepo,
    lockfiles,
    commands: dedupeCommands(commands),
    blockers,
    warnings,
    confidence: rootPkg || languages.length > 0 ? "medium" : "low",
    generatedAt: new Date().toISOString(),
  };
}

function dedupeCommands(commands: RepoReadinessCommand[]): RepoReadinessCommand[] {
  const seen = new Set<string>();
  const out: RepoReadinessCommand[] = [];
  for (const cmd of commands) {
    const key = `${cmd.name}:${cmd.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  return out;
}

function makeScanSummary(packages: Array<{ ecosystem: string }>, findings: BumblebeeFinding[]): BumblebeeScanSummary {
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) severityCounts[finding.severity as keyof typeof severityCounts]++;
  return {
    totalPackages: packages.length,
    totalFindings: findings.length,
    criticalCount: severityCounts.critical,
    highCount: severityCounts.high,
    mediumCount: severityCounts.medium,
    lowCount: severityCounts.low,
    ecosystems: [...new Set(packages.map((p) => p.ecosystem))],
  };
}

async function resolveRepoPath(lapis: LaPisClient, repoName: string): Promise<string | null> {
  return lapis.getSetting<string>(`repo:${repoName}:path`);
}

// NOTE: This read-then-write is NOT atomic. Concurrent scans for the same repo
// could lose a scanId. Acceptable for single-user local dashboard use; add a
// mutex or atomic append if multi-user concurrency is needed.
async function appendToScanIndex(lapis: LaPisClient, repoName: string, scanId: string): Promise<void> {
  const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
  await lapis.setSetting(`repo:${repoName}:bumblebee_scans`, { scanIds: [...(index?.scanIds ?? []), scanId] });
}

async function getLatestRepoScan(lapis: LaPisClient, repoName: string): Promise<BumblebeeScanResult | null> {
  const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
  const latestId = index?.scanIds?.at(-1);
  return latestId ? lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${latestId}`) : null;
}

export function registerRepoExploreRoutes(app: FastifyInstance, deps: RepoExploreDeps) {
  const { lapis, bumblebeeClient } = deps;

  app.post("/api/repos/:repoName/explore", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }

    try {
      await lapis.indexRepo(repoPath, repoName);
      const summary = await lapis.getCodeSummary(repoName);
      const mutation = await scanRepoForMutation(repoPath);
      return { repoName, status: "completed" as const, summary, mutation };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Indexing failed";
      const mutation = await scanRepoForMutation(repoPath);
      return { repoName, status: "failed" as const, error, mutation };
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

  app.get("/api/repos/:repoName/readiness", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath || !await exists(repoPath)) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }
    const profile = await buildReadinessProfile(repoName, repoPath);
    await lapis.setSetting(`repo:${repoName}:readiness`, profile);
    return profile;
  });

  app.post("/api/repos/:repoName/scans", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const body = (request.body ?? {}) as { profile?: "baseline" | "project" | "deep"; ecosystems?: string[] };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath || !await exists(repoPath)) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }
    if (!bumblebeeClient) {
      return reply.status(503).send({ error: "Package scanner is not configured." });
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await bumblebeeClient.scan({
        root: repoPath,
        profile: body.profile ?? "project",
        ecosystems: body.ecosystems,
      });
      const scanId = result.packages[0]?.scanId ?? result.findings[0]?.scanId ?? randomUUID();
      const findings = result.findings.map((finding) => ({ ...finding, scanId, missionId: `repo:${repoName}` }));
      const scan: BumblebeeScanResult = {
        id: scanId,
        missionId: `repo:${repoName}`,
        profile: body.profile ?? "project",
        status: "completed",
        startedAt,
        completedAt: new Date().toISOString(),
        summary: makeScanSummary(result.packages, findings),
        findings,
      };
      await lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
      await appendToScanIndex(lapis, repoName, scan.id);
      return reply.code(201).send({ scan, findings, packageCount: result.packages.length } satisfies RepoPackageScanResponse);
    } catch (err) {
      const scan: BumblebeeScanResult = {
        id: randomUUID(),
        missionId: `repo:${repoName}`,
        profile: body.profile ?? "project",
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
      };
      await lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
      await appendToScanIndex(lapis, repoName, scan.id);
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Package scan failed", scan });
    }
  });

  app.get("/api/repos/:repoName/scans", async (request) => {
    const { repoName } = request.params as { repoName: string };
    const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
    const scans: BumblebeeScanResult[] = [];
    for (const id of index?.scanIds ?? []) {
      const scan = await lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${id}`);
      if (scan) scans.push(scan);
    }
    return { scans };
  });

  app.get("/api/repos/:repoName/scans/:scanId", async (request, reply) => {
    const { repoName, scanId } = request.params as { repoName: string; scanId: string };
    const scan = await lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${scanId}`);
    if (!scan || scan.missionId !== `repo:${repoName}`) {
      return reply.status(404).send({ error: "Scan not found" });
    }
    return { scan, findings: scan.findings ?? [], packageCount: scan.summary?.totalPackages ?? 0 };
  });

  app.get("/api/repos/:repoName/suggestions", async (request) => {
    const { repoName } = request.params as { repoName: string };

    let summary = { files: 0, symbols: 0, edges: 0, modules: [] as Array<{ name: string; fileCount: number }>, entryPoints: [] as string[], cycles: { count: 0, paths: [] as string[][] } };
    let hotspots = { files: [] as Array<{ path: string; module: string; complexity: number; symbols: number }> };
    let scan: BumblebeeScanResult | null = null;
    let readiness: RepoReadinessProfile | null = null;

    try { summary = await lapis.getCodeSummary(repoName) as typeof summary; } catch { /* partial failure ok */ }
    try { hotspots = await lapis.getCodeHotspots(repoName) as typeof hotspots; } catch { /* partial failure ok */ }
    try { scan = await getLatestRepoScan(lapis, repoName); } catch { /* partial failure ok */ }
    try { readiness = await lapis.getSetting<RepoReadinessProfile>(`repo:${repoName}:readiness`); } catch { /* partial failure ok */ }

    const suggestions = generateSuggestions(summary, hotspots, scan, readiness);
    return { suggestions, analysisVersion: "2.0", recommended: recommendSuggestions(suggestions) } satisfies RepoSuggestionsResponse;
  });
}

export type {
  RepoSuggestion,
  RepoSuggestionsResponse,
  RepoReadinessProfile,
  RepoReadinessCommand,
  RepoPackageScanResponse,
  SuggestionTier,
  SuggestionCategory,
  SuggestionConfidence,
  SuggestionEffort,
  SuggestionRisk,
  TIER_META,
};
