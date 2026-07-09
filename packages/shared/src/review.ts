import type { BumblebeeScanSummary } from "./types.js";

export type SuggestionTier = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

export type SuggestionCategory =
  | "critical_path"
  | "security"
  | "dead_code"
  | "complexity"
  | "coupling"
  | "layer_violation"
  | "test_coverage"
  | "documentation"
  | "performance"
  | "structure"
  | "naming"
  | "style";

export type SuggestionConfidence = "high" | "medium" | "low";
export type SuggestionEffort = "small" | "medium" | "large";
export type SuggestionRisk = "low" | "medium" | "high";

export type IssueStatus = "open" | "acknowledged" | "dismissed" | "copied";

export interface SuggestionEvidence {
  type: "lapis" | "package_scan" | "manifest" | "heuristic" | "readiness";
  message: string;
  file?: string;
}

export interface IsolatedIssue {
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
  fixPrompt: string;
  fixPromptVersion: string;
  status?: IssueStatus;
}

export interface ReviewReportSummary {
  files: number;
  symbols: number;
  modules: number;
  cycleCount: number;
  issueCounts: Partial<Record<SuggestionTier, number>>;
  supplyChainSeverity?: BumblebeeScanSummary;
}

export interface ReviewArchitecture {
  modules: Array<{ name: string; fileCount: number }>;
  cycles: string[][];
  entryPoints: string[];
}

export interface ReviewReport {
  id: string;
  repoName: string;
  createdAt: string;
  analysisVersion: string;
  status: "running" | "completed" | "partial" | "failed";
  summary: ReviewReportSummary;
  issues: IsolatedIssue[];
  architecture: ReviewArchitecture;
  readiness: ReviewReadinessProfile | null;
  recommended?: { highestImpact?: string; safestFirst?: string };
  errors?: string[];
}

export interface ReviewReadinessCommand {
  name: "install" | "test" | "typecheck" | "lint" | "build" | "dev" | "e2e";
  command: string;
  confidence: SuggestionConfidence;
  source: string;
  warning?: string;
}

export interface ReviewReadinessProfile {
  repoName: string;
  profile: string;
  packageManager: string | null;
  languages: string[];
  frameworks: string[];
  monorepo: boolean;
  lockfiles: string[];
  commands: ReviewReadinessCommand[];
  blockers: string[];
  warnings: string[];
  confidence: SuggestionConfidence;
  generatedAt: string;
}
