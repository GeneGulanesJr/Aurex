import type {
  BumblebeeFinding,
  BumblebeeScanResult,
  IsolatedIssue,
  ReviewReadinessProfile,
  SuggestionCategory,
  SuggestionConfidence,
  SuggestionEffort,
  SuggestionRisk,
  SuggestionTier,
  SuggestionEvidence,
} from "@aurex/shared";
import type { CodeGraphInput } from "../orchestrator/affected-code.js";

export interface CodeSummaryInput {
  files: number;
  symbols: number;
  edges: number;
  modules: Array<{ name: string; fileCount: number }>;
  entryPoints: string[];
  cycles: { count: number; paths: string[][] };
}

export interface HotspotsInput {
  files: Array<{ path: string; module: string; complexity: number; symbols: number }>;
}

export interface IssueDraft {
  id: string;
  tier: SuggestionTier;
  category: SuggestionCategory;
  title: string;
  description: string;
  detail: string;
  scopePaths: string[];
  scopeModules: string[];
  confidence: SuggestionConfidence;
  estimatedEffort: SuggestionEffort;
  estimatedRisk: SuggestionRisk;
  evidence: SuggestionEvidence[];
  labels: string[];
}

const MAX_SCOPE_PATHS = 3;
const TIER_ORDER: Record<SuggestionTier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

function fileName(p: string): string {
  return p.split("/").pop() ?? p;
}

function resolveEntryPointPath(
  ep: string,
  graph: CodeGraphInput,
  hotspots: HotspotsInput,
): string {
  const normEp = ep.replace(/\/+$/, "");
  for (const n of graph.nodes) {
    if (n.id === normEp || n.id.endsWith(`/${normEp}`)) return n.id;
    if (fileName(n.id) === fileName(normEp)) return n.id;
  }
  for (const f of hotspots.files) {
    if (f.path === normEp || f.path.endsWith(`/${normEp}`)) return f.path;
    if (fileName(f.path) === fileName(normEp)) return f.path;
  }
  return ep;
}

function scopePathsForFinding(finding: BumblebeeFinding): string[] {
  const file = finding.sourceFile?.trim();
  if (file) return [file];
  const eco = finding.ecosystem?.toLowerCase() ?? "";
  const fallback: Record<string, string> = {
    npm: "package.json",
    node: "package.json",
    pypi: "requirements.txt",
    python: "requirements.txt",
    cargo: "Cargo.toml",
    rust: "Cargo.toml",
    go: "go.mod",
    maven: "pom.xml",
    java: "pom.xml",
    nuget: "Directory.Build.props",
  };
  for (const [key, path] of Object.entries(fallback)) {
    if (eco.includes(key)) return [path];
  }
  return ["package.json"];
}

function packageIssueId(finding: BumblebeeFinding): string {
  const discriminator = finding.catalogId || finding.findingType || finding.id;
  return `package-${finding.severity}-${finding.packageName}-${finding.version}-${discriminator}`;
}

function pathsForCyclePath(
  cyclePath: string[],
  graph: CodeGraphInput,
): string[] {
  const cycleSet = new Set(cyclePath);
  const matched = graph.nodes
    .filter((n) =>
      cycleSet.has(n.module)
      || cycleSet.has(n.id)
      || cyclePath.some((p) => n.id === p || n.id.endsWith(`/${p}`)),
    )
    .sort((a, b) => b.importance - a.importance)
    .map((n) => n.id);
  return matched.slice(0, MAX_SCOPE_PATHS);
}

function modulesFromPaths(paths: string[], hotspots: HotspotsInput): string[] {
  const mods = new Set<string>();
  for (const p of paths) {
    const hit = hotspots.files.find((f) => f.path === p);
    if (hit?.module) mods.add(hit.module);
  }
  return [...mods];
}

function draft(
  partial: IssueDraft,
): IssueDraft {
  return partial;
}

export function isolateIssues(
  summary: CodeSummaryInput,
  hotspots: HotspotsInput,
  graph: CodeGraphInput,
  scan: BumblebeeScanResult | null,
  readiness: ReviewReadinessProfile | null,
): IssueDraft[] {
  const issues: IssueDraft[] = [];
  const severityTier: Record<BumblebeeFinding["severity"], SuggestionTier> = {
    critical: "P0",
    high: "P1",
    medium: "P2",
    low: "P4",
  };

  for (const finding of scan?.findings ?? []) {
    const scopePaths = scopePathsForFinding(finding).slice(0, MAX_SCOPE_PATHS);
    issues.push(draft({
      id: packageIssueId(finding),
      tier: severityTier[finding.severity],
      category: "security",
      title: `${finding.severity === "critical" ? "Remove or upgrade" : "Audit"} ${finding.packageName}@${finding.version}`,
      description: finding.catalogName || finding.evidence || `${finding.packageName} matched a supply-chain risk rule.`,
      detail: `${finding.severity.toUpperCase()} · ${finding.sourceType || "dependency"} · ${finding.sourceFile ?? "lockfile"}`,
      scopePaths,
      scopeModules: modulesFromPaths(scopePaths, hotspots),
      confidence: finding.confidence ?? "medium",
      estimatedEffort: finding.severity === "critical" || finding.severity === "high" ? "medium" : "small",
      estimatedRisk: finding.severity === "critical" || finding.severity === "high" ? "high" : "medium",
      evidence: [{ type: "package_scan", message: finding.evidence, file: finding.sourceFile }],
      labels: ["highest-impact", "supply-chain"],
    }));
  }

  for (let i = 0; i < summary.cycles.paths.length; i++) {
    const cyclePath = summary.cycles.paths[i];
    if (!cyclePath || cyclePath.length === 0) continue;
    const scopePaths = pathsForCyclePath(cyclePath, graph);
    const pathLabel = cyclePath.join(" → ");
    issues.push(draft({
      id: `critical-cycle-${i}-${cyclePath.join("-").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`,
      tier: "P0",
      category: "critical_path",
      title: `Break dependency cycle: ${pathLabel}`,
      description: "Circular dependencies prevent independent testing and can cause build failures.",
      detail: `Cycle ${i + 1}/${summary.cycles.count} · ${pathLabel}`,
      scopePaths,
      scopeModules: [...new Set(cyclePath)].slice(0, MAX_SCOPE_PATHS),
      confidence: "high",
      estimatedEffort: cyclePath.length > 3 ? "large" : "medium",
      estimatedRisk: "high",
      evidence: [{ type: "lapis", message: `LaPis cycle path: ${pathLabel}` }],
      labels: ["highest-impact"],
    }));
  }

  for (const file of hotspots.files) {
    if (file.complexity > 30) {
      issues.push(draft({
        id: `complexity-critical-${file.path}`,
        tier: "P1",
        category: "complexity",
        title: `Refactor ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Cyclomatic complexity of ${file.complexity} makes this file difficult to test and reason about.`,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        scopePaths: [file.path],
        scopeModules: [file.module],
        confidence: "high",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "lapis", message: `Complexity ${file.complexity} with ${file.symbols} symbols`, file: file.path }],
        labels: [],
      }));
    } else if (file.complexity > 20) {
      issues.push(draft({
        id: `complexity-high-${file.path}`,
        tier: "P4",
        category: "complexity",
        title: `Simplify ${fileName(file.path)} — complexity ${file.complexity}`,
        description: `Moderate complexity (${file.complexity}) — consider extracting helpers.`,
        detail: `Complexity: ${file.complexity} · ${file.symbols} symbols`,
        scopePaths: [file.path],
        scopeModules: [file.module],
        confidence: "medium",
        estimatedEffort: "small",
        estimatedRisk: "low",
        evidence: [{ type: "lapis", message: `Complexity ${file.complexity}`, file: file.path }],
        labels: [],
      }));
    }
  }

  const scopedPaths = new Set<string>();
  for (const issue of issues) {
    for (const p of issue.scopePaths) scopedPaths.add(p);
  }

  const inboundTargets = new Set(graph.edges.map((e) => e.to));
  const hotpaths = hotspots.files.slice(0, 20);
  const orphanCandidates = hotpaths.filter((f) => {
    if (scopedPaths.has(f.path)) return false;
    if (inboundTargets.has(f.path)) return false;
    return !summary.entryPoints.some(
      (ep) => f.path === ep || f.path.endsWith(`/${ep}`) || fileName(f.path) === ep,
    );
  });
  for (const file of orphanCandidates.slice(0, 5)) {
    issues.push(draft({
      id: `dead-code-${file.path.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      tier: "P1",
      category: "dead_code",
      title: `Remove or confirm unused file: ${fileName(file.path)}`,
      description: "This file does not match a detected entry point and may be dead code.",
      detail: file.path,
      scopePaths: [file.path],
      scopeModules: [file.module],
      confidence: "low",
      estimatedEffort: "small",
      estimatedRisk: "medium",
      evidence: [{ type: "heuristic", message: "Hotspot file does not match a detected entry point", file: file.path }],
      labels: [],
    }));
  }

  if (summary.modules.length > 1) {
    const totalFiles = summary.modules.reduce((s, m) => s + m.fileCount, 0);
    for (const mod of summary.modules.filter((m) => m.fileCount > totalFiles * 0.3)) {
      issues.push(draft({
        id: `coupling-${mod.name}`,
        tier: "P2",
        category: "coupling",
        title: `Extract one seam from ${mod.name} module`,
        description: `Module holds ${mod.fileCount} of ${totalFiles} files (${Math.round((mod.fileCount / totalFiles) * 100)}%) — pick one extraction to reduce coupling.`,
        detail: `${mod.fileCount} files · threshold: 30%`,
        scopePaths: [],
        scopeModules: [mod.name],
        confidence: "medium",
        estimatedEffort: "large",
        estimatedRisk: "high",
        evidence: [{ type: "lapis", message: `${mod.name} owns ${mod.fileCount}/${totalFiles} files` }],
        labels: [],
      }));
    }
  }

  if (readiness) {
    for (let i = 0; i < readiness.blockers.length; i++) {
      const blocker = readiness.blockers[i];
      issues.push(draft({
        id: `readiness-blocker-${i}`,
        tier: "P1",
        category: "documentation",
        title: `Fix setup blocker: ${blocker.slice(0, 60)}${blocker.length > 60 ? "…" : ""}`,
        description: blocker,
        detail: "Readiness analysis",
        scopePaths: [],
        scopeModules: [],
        confidence: "high",
        estimatedEffort: "small",
        estimatedRisk: "low",
        evidence: [{ type: "readiness", message: blocker }],
        labels: ["safest-first"],
      }));
    }
  }

  if (summary.modules.length >= 3) {
    const uiModules = summary.modules.filter((m) => /^(components?|pages?|views?|ui|frontend)/i.test(m.name));
    const dataModules = summary.modules.filter((m) => /^(api|services?|hooks?|data|backend|server)/i.test(m.name));
    if (uiModules.length > 0 && dataModules.length > 0) {
      issues.push(draft({
        id: "layer-violations",
        tier: "P2",
        category: "layer_violation",
        title: "Audit one UI → data import for layer violation",
        description: "Pick one UI file and verify it does not import data/service internals directly.",
        detail: `UI: ${uiModules.map((m) => m.name).join(", ")} · Data: ${dataModules.map((m) => m.name).join(", ")}`,
        scopePaths: [],
        scopeModules: [uiModules[0]?.name, dataModules[0]?.name].filter(Boolean) as string[],
        confidence: "low",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "heuristic", message: "UI-like and data-like modules detected" }],
        labels: [],
      }));
    }
  }

  for (const mod of summary.modules.filter((m) => m.fileCount > 20)) {
    issues.push(draft({
      id: `structure-${mod.name}`,
      tier: "P4",
      category: "structure",
      title: `Split ${mod.name} (${mod.fileCount} files) — one extraction`,
      description: `Large module — extract one focused sub-package or folder.`,
      detail: `${mod.fileCount} files`,
      scopePaths: [],
      scopeModules: [mod.name],
      confidence: "medium",
      estimatedEffort: "large",
      estimatedRisk: "medium",
      evidence: [{ type: "lapis", message: `${mod.name} has ${mod.fileCount} files` }],
      labels: [],
    }));
  }

  const testModules = summary.modules.filter((m) =>
    /^(test|tests|spec|specs|__tests__)/i.test(m.name),
  );
  const srcModules = summary.modules.filter(
    (m) => !/^(test|tests|spec|specs|__tests__|node_modules|dist|build|\.)/i.test(m.name),
  );
  const srcFileCount = srcModules.reduce((s, m) => s + m.fileCount, 0);
  const testFileCount = testModules.reduce((s, m) => s + m.fileCount, 0);
  if (srcFileCount > 10 && testFileCount === 0) {
    const entryScope = summary.entryPoints
      .slice(0, MAX_SCOPE_PATHS)
      .map((ep) => resolveEntryPointPath(ep, graph, hotspots));
    issues.push(draft({
      id: "test-coverage-none",
      tier: "P3",
      category: "test_coverage",
      title: "Add test infrastructure — no test directory found",
      description: `${srcFileCount} source files but zero test files detected. No safety net for changes.`,
      detail: `${srcFileCount} source files · 0 test files`,
      scopePaths: entryScope,
      scopeModules: [],
      confidence: "medium",
      estimatedEffort: "large",
      estimatedRisk: "low",
      evidence: [{ type: "lapis", message: `${srcFileCount} source files and no test modules detected` }],
      labels: ["safest-first"],
    }));
  } else if (srcFileCount > 0 && testFileCount > 0) {
    const ratio = testFileCount / srcFileCount;
    if (ratio < 0.2) {
      const entryScope = summary.entryPoints
        .slice(0, MAX_SCOPE_PATHS)
        .map((ep) => resolveEntryPointPath(ep, graph, hotspots));
      issues.push(draft({
        id: "test-coverage-low",
        tier: "P3",
        category: "test_coverage",
        title: `Improve test coverage — ${Math.round(ratio * 100)}% test-to-source ratio`,
        description: `Only ${testFileCount} test files for ${srcFileCount} source files. Aim for ≥ 20% ratio as a baseline.`,
        detail: `${testFileCount} tests / ${srcFileCount} sources · target: ≥ 20%`,
        scopePaths: entryScope,
        scopeModules: [],
        confidence: "medium",
        estimatedEffort: "medium",
        estimatedRisk: "low",
        evidence: [{ type: "lapis", message: `${testFileCount}/${srcFileCount} test-to-source file ratio` }],
        labels: ["safest-first"],
      }));
    }
  }

  if (summary.symbols > 50 && summary.entryPoints.length > 0) {
    for (const [i, ep] of summary.entryPoints.slice(0, 5).entries()) {
      const resolvedPath = resolveEntryPointPath(ep, graph, hotspots);
      issues.push(draft({
        id: `documentation-${i}-${resolvedPath.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)}`,
        tier: "P3",
        category: "documentation",
        title: `Document entry point: ${fileName(resolvedPath)}`,
        description: `Add JSDoc/TSDoc to this public entry point for discoverability.`,
        detail: `Entry point: ${resolvedPath}`,
        scopePaths: [resolvedPath],
        scopeModules: modulesFromPaths([resolvedPath], hotspots),
        confidence: "medium",
        estimatedEffort: "small",
        estimatedRisk: "low",
        evidence: [{ type: "lapis", message: `Entry point among ${summary.entryPoints.length} detected`, file: resolvedPath }],
        labels: [],
      }));
    }
  }

  if (summary.files > 0 && summary.edges / Math.max(summary.files, 1) > 5) {
    issues.push(draft({
      id: "performance-import-density",
      tier: "P4",
      category: "performance",
      title: `Audit import density — ${(summary.edges / summary.files).toFixed(1)} edges/file`,
      description: "High import density can slow builds and inflate bundles.",
      detail: `${summary.edges} imports across ${summary.files} files`,
      scopePaths: [],
      scopeModules: [],
      confidence: "medium",
      estimatedEffort: "medium",
      estimatedRisk: "low",
      evidence: [{ type: "lapis", message: `${summary.edges} edges across ${summary.files} files` }],
      labels: [],
    }));
  }

  if (summary.modules.length > 2) {
    const kebabCase = summary.modules.filter((m) => /^[a-z]+(-[a-z]+)+$/.test(m.name));
    const camelCase = summary.modules.filter((m) => /^[a-z]+[A-Z]/.test(m.name));
    const pascalCase = summary.modules.filter((m) => /^[A-Z]/.test(m.name));
    const conventions = [kebabCase, camelCase, pascalCase].filter((c) => c.length > 0);
    if (conventions.length >= 2) {
      issues.push(draft({
        id: "naming-convention",
        tier: "P5",
        category: "naming",
        title: `Standardize naming — ${conventions.length} conventions detected`,
        description: `Modules use ${conventions.length} different naming styles. Standardizing improves readability.`,
        detail: `Styles: ${[kebabCase.length && "kebab-case", camelCase.length && "camelCase", pascalCase.length && "PascalCase"].filter(Boolean).join(", ")}`,
        scopePaths: [],
        scopeModules: summary.modules.slice(0, MAX_SCOPE_PATHS).map((m) => m.name),
        confidence: "medium",
        estimatedEffort: "medium",
        estimatedRisk: "medium",
        evidence: [{ type: "heuristic", message: `${conventions.length} naming conventions detected` }],
        labels: [],
      }));
    }
  }

  if (summary.files > 15 && summary.modules.length > 2) {
    issues.push(draft({
      id: "style-contributing",
      tier: "P5",
      category: "style",
      title: "Add contributing guidelines and code style guide",
      description: `A project with ${summary.files} files and ${summary.modules.length} modules should have contributor documentation.`,
      detail: `${summary.files} files · ${summary.modules.length} modules`,
      scopePaths: [],
      scopeModules: [],
      confidence: "low",
      estimatedEffort: "small",
      estimatedRisk: "low",
      evidence: [{ type: "heuristic", message: `${summary.files} files and ${summary.modules.length} modules detected` }],
      labels: [],
    }));
  }

  issues.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return issues;
}

export function recommendIssues(issues: IsolatedIssue[]): { highestImpact?: string; safestFirst?: string } {
  const highestImpact = issues.find((s) => s.labels.includes("highest-impact")) ?? issues[0];
  const safestFirst = issues.find((s) => s.labels.includes("safest-first"))
    ?? issues.find((s) => s.estimatedRisk === "low" && (s.estimatedEffort === "small" || s.estimatedEffort === "medium"));
  return {
    highestImpact: highestImpact?.id,
    safestFirst: safestFirst?.id,
  };
}

export function countIssuesByTier(issues: IsolatedIssue[]): Partial<Record<SuggestionTier, number>> {
  const counts: Partial<Record<SuggestionTier, number>> = {};
  for (const issue of issues) {
    counts[issue.tier] = (counts[issue.tier] ?? 0) + 1;
  }
  return counts;
}
