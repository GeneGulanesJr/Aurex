import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStrykerConfig } from "../src/scanner/mutation-scanner.js";

describe("detectStrykerConfig", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "aurex-mutation-test-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns configured=true when stryker.config.mjs exists", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    const result = await detectStrykerConfig(repoDir);
    expect(result.strykerConfigured).toBe(true);
    expect(result.configPath).toBe("stryker.config.mjs");
  });

  it("returns configured=true for stryker.conf.js", async () => {
    writeFileSync(join(repoDir, "stryker.conf.js"), "module.exports = {};");
    const result = await detectStrykerConfig(repoDir);
    expect(result.strykerConfigured).toBe(true);
    expect(result.configPath).toBe("stryker.conf.js");
  });

  it("returns configured=true for stryker.config.json", async () => {
    writeFileSync(join(repoDir, "stryker.config.json"), "{}");
    const result = await detectStrykerConfig(repoDir);
    expect(result.strykerConfigured).toBe(true);
    expect(result.configPath).toBe("stryker.config.json");
  });

  it("returns configured=false when no config file exists", async () => {
    const result = await detectStrykerConfig(repoDir);
    expect(result.strykerConfigured).toBe(false);
    expect(result.configPath).toBeNull();
  });

  it("prefers .mjs over .js over .json when multiple exist", async () => {
    writeFileSync(join(repoDir, "stryker.config.json"), "{}");
    writeFileSync(join(repoDir, "stryker.config.js"), "module.exports = {};");
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    const result = await detectStrykerConfig(repoDir);
    expect(result.configPath).toBe("stryker.config.mjs");
  });

  it("ignores stryker config files in subdirectories", async () => {
    mkdirSync(join(repoDir, "subdir"));
    writeFileSync(join(repoDir, "subdir", "stryker.config.mjs"), "export default {};");
    const result = await detectStrykerConfig(repoDir);
    expect(result.strykerConfigured).toBe(false);
  });
});

import { parseStrykerReport, computeMutationScore, scanRepoForMutation } from "../src/scanner/mutation-scanner.js";
import { readFileSync } from "node:fs";

const FIXTURES = join(import.meta.dirname, "..", "src", "scanner", "__tests__", "fixtures");

describe("parseStrykerReport", () => {
  it("extracts counts from a healthy report", () => {
    const raw = readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8");
    const summary = parseStrykerReport(raw);
    expect(summary.counts).toEqual({
      killed: 2,
      survived: 1,
      timeout: 0,
      noCoverage: 0,
      ignored: 0,
      total: 3,
    });
    // 2 killed / 3 total = 66.67% — note: score formula excludes noCoverage/ignored
    expect(summary.score).toBeCloseTo(66.67, 1);
  });

  it("extracts counts from a poor report", () => {
    const raw = readFileSync(join(FIXTURES, "stryker-report-poor.json"), "utf8");
    const summary = parseStrykerReport(raw);
    expect(summary.counts?.killed).toBe(1);
    expect(summary.counts?.survived).toBe(2);
    // 1 / 3 = 33.33%
    expect(summary.score).toBeCloseTo(33.33, 1);
  });

  it("returns score=null for an empty report (no mutants)", () => {
    const raw = readFileSync(join(FIXTURES, "stryker-report-none.json"), "utf8");
    const summary = parseStrykerReport(raw);
    expect(summary.counts?.total).toBe(0);
    expect(summary.score).toBeNull();
  });

  it("throws on malformed JSON", () => {
    const raw = readFileSync(join(FIXTURES, "stryker-report-malformed.json"), "utf8");
    expect(() => parseStrykerReport(raw)).toThrow(/Failed to parse Stryker report/);
  });

  it("returns a partial summary (no strykerConfigured/path fields)", () => {
    const raw = readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8");
    const summary = parseStrykerReport(raw);
    // The parser doesn't know about configPath/reportPath/etc — that's the
    // scanner's job. Confirm the shape.
    expect("strykerConfigured" in summary).toBe(false);
    expect("configPath" in summary).toBe(false);
    expect("reportPath" in summary).toBe(false);
    expect("generatedAt" in summary).toBe(false);
  });
});

describe("computeMutationScore", () => {
  it("returns 100 when all mutants killed", () => {
    expect(computeMutationScore({ killed: 10, survived: 0, timeout: 0, noCoverage: 0, ignored: 0, total: 10 })).toBe(100);
  });

  it("returns 0 when no mutants killed", () => {
    expect(computeMutationScore({ killed: 0, survived: 5, timeout: 0, noCoverage: 0, ignored: 0, total: 5 })).toBe(0);
  });

  it("returns null when no mutants at all", () => {
    expect(computeMutationScore({ killed: 0, survived: 0, timeout: 0, noCoverage: 0, ignored: 0, total: 0 })).toBeNull();
  });

  it("excludes noCoverage and ignored from the denominator (per Stryker convention)", () => {
    // 4 killed / (4 killed + 2 survived + 1 timeout) = 4/7 = 57.14%
    // noCoverage and ignored do NOT count
    expect(computeMutationScore({ killed: 4, survived: 2, timeout: 1, noCoverage: 3, ignored: 2, total: 12 })).toBeCloseTo(57.14, 1);
  });
});

describe("scanRepoForMutation", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "aurex-mutation-scan-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns configured=false when no Stryker config is present", async () => {
    const result = await scanRepoForMutation(repoDir);
    expect(result.strykerConfigured).toBe(false);
    expect(result.score).toBeNull();
    expect(result.counts).toBeNull();
  });

  it("returns configured=true with no score when config exists but no report", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    const result = await scanRepoForMutation(repoDir);
    expect(result.strykerConfigured).toBe(true);
    expect(result.configPath).toBe("stryker.config.mjs");
    expect(result.score).toBeNull();
    expect(result.reportPath).toBeNull();
  });

  it("returns score from reports/stryker-report.json", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    mkdirSync(join(repoDir, "reports"));
    const fixture = readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8");
    writeFileSync(join(repoDir, "reports", "stryker-report.json"), fixture);
    const result = await scanRepoForMutation(repoDir);
    expect(result.score).toBeCloseTo(66.67, 1);
    expect(result.reportPath).toBe("reports/stryker-report.json");
    expect(result.counts?.killed).toBe(2);
  });

  it("also checks reports/mutation/mutation.json as a fallback location", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    mkdirSync(join(repoDir, "reports", "mutation"), { recursive: true });
    const fixture = readFileSync(join(FIXTURES, "stryker-report-poor.json"), "utf8");
    writeFileSync(join(repoDir, "reports", "mutation", "mutation.json"), fixture);
    const result = await scanRepoForMutation(repoDir);
    expect(result.score).toBeCloseTo(33.33, 1);
    expect(result.reportPath).toBe("reports/mutation/mutation.json");
  });

  it("prefers reports/stryker-report.json over the mutation/ fallback", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    mkdirSync(join(repoDir, "reports", "mutation"), { recursive: true });
    writeFileSync(join(repoDir, "reports", "stryker-report.json"), readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8"));
    writeFileSync(join(repoDir, "reports", "mutation", "mutation.json"), readFileSync(join(FIXTURES, "stryker-report-poor.json"), "utf8"));
    const result = await scanRepoForMutation(repoDir);
    expect(result.score).toBeCloseTo(66.67, 1); // the "good" one wins
    expect(result.reportPath).toBe("reports/stryker-report.json");
  });

  it("returns score=null (not throws) when report file is malformed", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    mkdirSync(join(repoDir, "reports"));
    writeFileSync(join(repoDir, "reports", "stryker-report.json"), "{ broken");
    const result = await scanRepoForMutation(repoDir);
    // Discovery should be resilient: configured=true, but no score available
    expect(result.strykerConfigured).toBe(true);
    expect(result.score).toBeNull();
  });
});

import { runMutationTests } from "../src/scanner/mutation-scanner.js";

describe("runMutationTests", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "aurex-mutation-run-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("throws immediately when Stryker is not configured", async () => {
    await expect(runMutationTests(repoDir, { onProgress: () => {} })).rejects.toThrow(
      /Stryker is not configured/,
    );
  });

  it("invokes the configured command and reports progress", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    // Use a mock command via the override param (no real npx call in unit tests)
    const events: string[] = [];
    const result = await runMutationTests(repoDir, {
      onProgress: (msg) => events.push(msg),
      commandOverride: "node -e \"console.log('mock run done'); process.exit(0)\"",
    });
    expect(result.exitCode).toBe(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it("captures non-zero exit codes as failure", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    const result = await runMutationTests(repoDir, {
      onProgress: () => {},
      commandOverride: "node -e \"process.exit(2)\"",
    });
    expect(result.exitCode).toBe(2);
  });

  it("re-parses the report after a successful run", async () => {
    writeFileSync(join(repoDir, "stryker.config.mjs"), "export default {};");
    mkdirSync(join(repoDir, "reports"));
    // Pre-write a "good" report, then run a no-op command — we just verify
    // the post-run summary reflects whatever's on disk.
    writeFileSync(join(repoDir, "reports", "stryker-report.json"),
      readFileSync(join(FIXTURES, "stryker-report-good.json"), "utf8"));
    const result = await runMutationTests(repoDir, {
      onProgress: () => {},
      commandOverride: "node -e \"process.exit(0)\"",
    });
    expect(result.summary.score).toBeCloseTo(66.67, 1);
  });
});
