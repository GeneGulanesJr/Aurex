import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { MutationReportSummary } from "@aurex/shared";

/**
 * Stryker accepts multiple config filenames. Order matters — .mjs is preferred
 * (it's the only ESM-native format and matches Aurex's own stryker.config.mjs).
 */
const STRYKER_CONFIG_NAMES = [
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.js",
  "stryker.conf.json",
] as const;

export interface StrykerConfigDiscovery {
  strykerConfigured: boolean;
  configPath: string | null;
}

/**
 * Check whether the target repo has a Stryker config file at its root.
 * Pure filesystem check — does not execute the config.
 */
export async function detectStrykerConfig(repoPath: string): Promise<StrykerConfigDiscovery> {
  for (const name of STRYKER_CONFIG_NAMES) {
    const candidate = join(repoPath, name);
    try {
      await access(candidate, constants.F_OK);
      return { strykerConfigured: true, configPath: name };
    } catch {
      // not found, try next
    }
  }
  return { strykerConfigured: false, configPath: null };
}

type MutantStatus = "Killed" | "Survived" | "Timeout" | "NoCoverage" | "Ignored";

/**
 * Stryker report mutant shape — only the fields we actually read.
 * The full shape is large; we keep this narrow so fixture changes don't break us.
 */
interface StrykerMutant {
  id: string;
  mutatorName: string;
  status: MutantStatus;
  replacement: string;
  location: { start: { line: number; column: number } };
}

interface StrykerReportFile {
  language: string;
  mutants: StrykerMutant[];
}

interface StrykerReport {
  schemaVersion: string;
  thresholds: { high: number; low: number; break: number };
  files: Record<string, StrykerReportFile>;
}

/**
 * Compute Stryker's mutation score: killed / (killed + survived + timeout) * 100.
 * NoCoverage and Ignored mutants are excluded from the denominator — they
 * represent tests that don't exist or files explicitly excluded, not test failures.
 * Returns null when there are no scored mutants (no signal to report).
 */
export function computeMutationScore(counts: {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  ignored: number;
  total: number;
}): number | null {
  const denominator = counts.killed + counts.survived + counts.timeout;
  if (denominator === 0) return null;
  return Math.round((counts.killed / denominator) * 10_000) / 100;
}

/**
 * Parse a Stryker JSON report (string content) into a summary.
 * Throws on malformed JSON or a report that doesn't match the expected shape.
 *
 * Returns a partial summary (no strykerConfigured/configPath/reportPath/generatedAt
 * — those are filled in by the scanner which knows about the filesystem).
 * Callers should compose with `scanRepoForMutation` rather than use this directly
 * when they need a full `MutationReportSummary`.
 */
export function parseStrykerReport(raw: string): Pick<MutationReportSummary, "score" | "counts"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse Stryker report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isStrykerReport(parsed)) {
    throw new Error("Stryker report does not match expected shape (missing files or schemaVersion)");
  }

  const counts = tallyMutants(parsed);
  const score = computeMutationScore(counts);

  return { score, counts };
}

interface MutantCounts {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  ignored: number;
  total: number;
}

function tallyMutants(report: StrykerReport): MutantCounts {
  const counts: MutantCounts = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, ignored: 0, total: 0 };
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      counts.total++;
      switch (mutant.status) {
        case "Killed": counts.killed++; break;
        case "Survived": counts.survived++; break;
        case "Timeout": counts.timeout++; break;
        case "NoCoverage": counts.noCoverage++; break;
        case "Ignored": counts.ignored++; break;
      }
    }
  }
  return counts;
}

function isStrykerReport(value: unknown): value is StrykerReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.schemaVersion !== "string") return false;
  if (typeof v.files !== "object" || v.files === null) return false;
  return true;
}

/**
 * Candidate report locations, in priority order. Stryker's default is
 * reports/stryker-report.json but older versions and some configs use
 * reports/mutation/mutation.json.
 */
const REPORT_PATHS = [
  "reports/stryker-report.json",
  "reports/mutation/mutation.json",
] as const;

/**
 * The full mutation scan for a repo: detect Stryker config + read the most
 * recent report. This is the function the route layer calls.
 *
 * Designed to be resilient — never throws on a missing or broken report.
 * If parsing fails, score is null but strykerConfigured reflects reality.
 */
export async function scanRepoForMutation(repoPath: string): Promise<MutationReportSummary> {
  const config = await detectStrykerConfig(repoPath);
  if (!config.strykerConfigured) {
    return {
      strykerConfigured: false,
      configPath: null,
      reportPath: null,
      score: null,
      generatedAt: null,
      counts: null,
    };
  }

  for (const relPath of REPORT_PATHS) {
    const absPath = `${repoPath}/${relPath}`;
    try {
      const raw = await readFile(absPath, "utf8");
      const summary = parseStrykerReport(raw);
      const fileStat = await stat(absPath);
      return {
        ...summary,
        strykerConfigured: true,
        configPath: config.configPath,
        reportPath: relPath,
        generatedAt: fileStat.mtime.toISOString(),
      };
    } catch {
      // try next location
    }
  }

  // Configured but no report found
  return {
    strykerConfigured: true,
    configPath: config.configPath,
    reportPath: null,
    score: null,
    generatedAt: null,
    counts: null,
  };
}

export interface RunMutationOptions {
  /** Called with each stdout/stderr chunk. Used to push progress over WebSocket. */
  onProgress: (line: string) => void;
  /**
   * Override the command (for tests). Default is `npx stryker run`.
   * Production callers should NOT set this — the default wires the
   * version-locked Stryker from the host's node_modules.
   */
  commandOverride?: string;
}

export interface RunMutationResult {
  exitCode: number;
  summary: MutationReportSummary;
  durationMs: number;
}

/**
 * Run Stryker mutation tests inside the given repo path. Streams progress
 * lines via the onProgress callback so the caller can forward them over
 * WebSocket. After the run completes, re-parses the report to return a
 * fresh summary.
 *
 * IMPORTANT: This does NOT install Stryker into the target repo. It assumes
 * the host running Aurex has Stryker available (we ship it as a devDep).
 * For repos that pin a different Stryker version, this will use the host's
 * version — acceptable for a "quick score" feature.
 */
export async function runMutationTests(
  repoPath: string,
  options: RunMutationOptions,
): Promise<RunMutationResult> {
  const config = await detectStrykerConfig(repoPath);
  if (!config.strykerConfigured) {
    throw new Error(`Stryker is not configured in ${repoPath}. Add a stryker.config.* file first.`);
  }

  const command = options.commandOverride ?? "npx stryker run";
  const startedAt = Date.now();

  const exitCode = await runProcess(command, repoPath, options.onProgress);

  // Re-parse the report regardless of exit code — Stryker still writes
  // the JSON even on threshold failure, which is exactly when we want
  // to surface the score.
  const summary = await scanRepoForMutation(repoPath);

  return {
    exitCode,
    summary,
    durationMs: Date.now() - startedAt,
  };
}

function runProcess(command: string, cwd: string, onProgress: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: "true" } });
    let buffer = "";

    const flush = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onProgress(line);
      }
    };

    child.stdout.on("data", flush);
    child.stderr.on("data", flush);
    child.on("error", reject);
    child.on("close", (code) => {
      if (buffer.trim()) onProgress(buffer);
      resolve(code ?? 1);
    });
  });
}
