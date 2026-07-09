import { randomUUID } from "crypto";
import { stat } from "fs/promises";
import type { BumblebeeFinding, BumblebeeScanResult, ReviewReport } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeClient } from "../clients/bumblebee-client.js";
import type { CodeGraphInput } from "../orchestrator/affected-code.js";
import { attachFixPrompts, type FixPromptContext } from "./fix-prompt-builder.js";
import {
  countIssuesByTier,
  isolateIssues,
  recommendIssues,
  type CodeSummaryInput,
  type HotspotsInput,
} from "./issue-isolator.js";
import type { ReviewReadinessProfile } from "@aurex/shared";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function resolveRepoPath(lapis: LaPisClient, repoName: string): Promise<string | null> {
  return lapis.getSetting<string>(`repo:${repoName}:path`);
}

async function appendToScanIndex(lapis: LaPisClient, repoName: string, scanId: string): Promise<void> {
  const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
  await lapis.setSetting(`repo:${repoName}:bumblebee_scans`, { scanIds: [...(index?.scanIds ?? []), scanId] });
}

async function getLatestRepoScan(lapis: LaPisClient, repoName: string): Promise<BumblebeeScanResult | null> {
  const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
  const latestId = index?.scanIds?.at(-1);
  return latestId ? lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${latestId}`) : null;
}

function scanIsRecent(scan: BumblebeeScanResult | null): boolean {
  if (!scan?.completedAt) return false;
  const completed = new Date(scan.completedAt).getTime();
  return Date.now() - completed < 24 * 60 * 60 * 1000;
}

function makeScanSummary(
  packages: Array<{ ecosystem: string }>,
  findings: BumblebeeFinding[],
): NonNullable<ReviewReport["summary"]["supplyChainSeverity"]> {
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    severityCounts[finding.severity as keyof typeof severityCounts]++;
  }
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

export interface RunReviewDeps {
  lapis: LaPisClient;
  bumblebeeClient?: BumblebeeClient;
  buildReadinessProfile: (repoName: string, repoPath: string) => Promise<ReviewReadinessProfile>;
}

export interface RunReviewResult {
  report: ReviewReport;
}

export async function runReview(
  deps: RunReviewDeps,
  repoName: string,
): Promise<RunReviewResult> {
  const { lapis, bumblebeeClient, buildReadinessProfile } = deps;
  const errors: string[] = [];
  const reviewId = randomUUID();
  const createdAt = new Date().toISOString();

  const repoPath = await resolveRepoPath(lapis, repoName);
  if (!repoPath || !await exists(repoPath)) {
    return {
      report: {
        id: reviewId,
        repoName,
        createdAt,
        analysisVersion: "3.0",
        status: "failed",
        summary: { files: 0, symbols: 0, modules: 0, cycleCount: 0, issueCounts: {} },
        issues: [],
        architecture: { modules: [], cycles: [], entryPoints: [] },
        readiness: null,
        errors: ["Repository not found. Run prepare first."],
      },
    };
  }

  let summary: CodeSummaryInput = {
    files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] },
  };
  let hotspots: HotspotsInput = { files: [] };
  let graph: CodeGraphInput = { nodes: [], edges: [], cycles: [] };
  let scan: BumblebeeScanResult | null = null;
  let readiness: ReviewReadinessProfile | null = null;

  try {
    await lapis.indexRepo(repoPath, repoName);
  } catch (err) {
    errors.push(`Index failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await Promise.all([
    lapis.getCodeSummary(repoName).then((s) => { summary = s as CodeSummaryInput; }).catch((e) => {
      errors.push(`Summary: ${e instanceof Error ? e.message : String(e)}`);
    }),
    lapis.getCodeHotspots(repoName).then((h) => { hotspots = h as HotspotsInput; }).catch((e) => {
      errors.push(`Hotspots: ${e instanceof Error ? e.message : String(e)}`);
    }),
    lapis.getCodeGraph(repoName).then((g) => { graph = g as CodeGraphInput; }).catch((e) => {
      errors.push(`Graph: ${e instanceof Error ? e.message : String(e)}`);
    }),
  ]);

  try {
    readiness = await buildReadinessProfile(repoName, repoPath);
    await lapis.setSetting(`repo:${repoName}:readiness`, readiness);
  } catch (err) {
    errors.push(`Readiness: ${err instanceof Error ? err.message : String(err)}`);
  }

  scan = await getLatestRepoScan(lapis, repoName);
  if (!scanIsRecent(scan) && bumblebeeClient) {
    try {
      const startedAt = new Date().toISOString();
      const result = await bumblebeeClient.scan({ root: repoPath, profile: "project" });
      const scanId = result.packages[0]?.scanId ?? result.findings[0]?.scanId ?? randomUUID();
      const findings = result.findings.map((f) => ({ ...f, scanId, missionId: `repo:${repoName}` }));
      scan = {
        id: scanId,
        missionId: `repo:${repoName}`,
        profile: "project",
        status: "completed",
        startedAt,
        completedAt: new Date().toISOString(),
        summary: makeScanSummary(result.packages, findings),
        findings,
      };
      await lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
      await appendToScanIndex(lapis, repoName, scan.id);
    } catch (err) {
      errors.push(`Package scan: ${err instanceof Error ? err.message : String(err)}`);
      if (!scanIsRecent(scan)) scan = null;
    }
  }

  const ctx: FixPromptContext = { graph, hotspots, readiness };
  const drafts = isolateIssues(summary, hotspots, graph, scan, readiness);
  const issues = attachFixPrompts(drafts, ctx);

  const status = errors.length > 0 && issues.length === 0
    ? "failed"
    : errors.length > 0
      ? "partial"
      : "completed";

  const report: ReviewReport = {
    id: reviewId,
    repoName,
    createdAt,
    analysisVersion: "3.0",
    status,
    summary: {
      files: summary.files,
      symbols: summary.symbols,
      modules: summary.modules.length,
      cycleCount: summary.cycles.count,
      issueCounts: countIssuesByTier(issues),
      supplyChainSeverity: scan?.summary,
    },
    issues,
    architecture: {
      modules: summary.modules,
      cycles: summary.cycles.paths,
      entryPoints: summary.entryPoints,
    },
    readiness,
    recommended: recommendIssues(issues),
    errors: errors.length > 0 ? errors : undefined,
  };

  return { report };
}
