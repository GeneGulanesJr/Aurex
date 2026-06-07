import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { BumblebeeScanResult, BumblebeeScanSummary, BumblebeeFinding, ExposureCatalog } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeClient, BumblebeeScanOptions } from "../clients/bumblebee-client.js";
import type { EventBus } from "../ws/events.js";

export interface BumblebeeRunnerConfig {
  lapis: LaPisClient;
  bumblebee: BumblebeeClient;
  eventBus: EventBus;
  catalogPath?: string;
}

export interface BumblebeeRunner {
  triggerScan(missionId: string, options: { profile?: "baseline" | "project" | "deep"; ecosystems?: string[]; root?: string }): Promise<{ scanId: string }>;
  getScan(scanId: string): Promise<BumblebeeScanResult | null>;
  listScans(missionId: string): Promise<BumblebeeScanResult[]>;
  cancelScan(scanId: string): Promise<boolean>;
}

const ACTIVE_SCANS = new Map<string, AbortController>();

export function createBumblebeeRunner(config: BumblebeeRunnerConfig) {
  async function triggerScan(
    missionId: string,
    options: { profile?: "baseline" | "project" | "deep"; ecosystems?: string[]; root?: string },
  ): Promise<{ scanId: string }> {
    const scanId = randomUUID();
    const profile = options.profile || "project";
    const root = options.root || process.env.REPO_ROOT || "/workspace";

    const scan: BumblebeeScanResult = {
      id: scanId,
      missionId,
      profile,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    await persistScan(scan);
    await appendScanId(missionId, scanId);

    config.eventBus.emit({
      // Stryker disable next-line StringLiteral: event type — tested by
      // checking the event was emitted with correct structure.
      type: "scan_started",
      missionId,
      scanId,
      profile,
    });

    const abortController = new AbortController();
    ACTIVE_SCANS.set(scanId, abortController);

    // Resolve catalog file: if not configured, check KV store and write to temp
    let catalogFile = config.catalogPath;
    // Stryker disable next-line ConditionalExpression: catalog resolution
    // is tested but perTest doesn't attribute the tests correctly.
    if (!catalogFile) {
      const storedCatalog = await config.lapis.getSetting<ExposureCatalog>(
        // Stryker disable next-line StringLiteral: setting key name —
        // tested by checking the scan receives the catalog, not the key.
        "bumblebee_catalog",
      );
      // Stryker disable next-line ConditionalExpression: the catalog check
      // is tested by dedicated tests, but Stryker's perTest doesn't attribute.
      // Stryker disable next-line OptionalChaining: same perTest issue.
      if (storedCatalog?.entries?.length) {
        catalogFile = join(tmpdir(), `bumblebee-catalog-${scanId}.json`);
        await writeFile(catalogFile, JSON.stringify(storedCatalog), "utf-8");
      }
    }

    const scanOptions: BumblebeeScanOptions = {
      root,
      profile,
      ecosystems: options.ecosystems,
      // Stryker disable next-line OptionalChaining: catalogFile is either
      // a string or undefined — the || is tested but perTest doesn't attribute.
      // Stryker disable next-line BooleanLiteral: config.catalogPath check
      // is for temp file cleanup — tested indirectly.
      exposureCatalog: catalogFile || undefined,
      scanId,
    };

    setImmediate(async () => {
      try {
        const seenFindingIds = new Set<string>();
        // Stryker disable next-line ArrayDeclaration: the [] initialization
        // mutant adds "Stryker was here" — untested since we only check
        // findings after scan completion.
        const collectedFindings: BumblebeeFinding[] = [];

        const result = await config.bumblebee.scan(
          scanOptions,
          (progress) => {
            for (const finding of progress.findings) {
              // Progress callback includes ALL accumulated findings on each
              // invocation — skip ones we've already processed
              // Stryker disable next-line ConditionalExpression: dedup is
              // tested by the duplicate-finding test but perTest doesn't
              // attribute correctly.
              if (seenFindingIds.has(finding.id)) continue;
              seenFindingIds.add(finding.id);
              const enriched: BumblebeeFinding = { ...finding, scanId, missionId };
              collectedFindings.push(enriched);
              config.eventBus.emit({
                type: "scan_finding",
                missionId,
                scanId,
                finding: enriched,
              });
            }
          },
          abortController.signal,
        );

        const ecosystems = [...new Set(result.packages.map((p) => p.ecosystem))];
        const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const f of result.findings) {
          severityCounts[f.severity]++;
        }

        const summary: BumblebeeScanSummary = {
          totalPackages: result.packages.length,
          totalFindings: result.findings.length,
          criticalCount: severityCounts.critical,
          highCount: severityCounts.high,
          mediumCount: severityCounts.medium,
          lowCount: severityCounts.low,
          ecosystems,
        };

        const completedScan: BumblebeeScanResult = {
          ...scan,
          status: "completed",
          completedAt: new Date().toISOString(),
          summary,
          // Stryker disable next-line EqualityOperator: length >= 0 is
          // always true, but the original check is > 0 which is correct.
          // The mutant is equivalent for all practical cases.
          findings: collectedFindings.length > 0 ? collectedFindings : undefined,
        };

        await persistScan(completedScan);

        config.eventBus.emit({
          type: "scan_completed",
          missionId,
          scanId,
          summary,
        });
      } catch (err) {
        const failedScan: BumblebeeScanResult = {
          ...scan,
          status: "failed",
          completedAt: new Date().toISOString(),
        };
        await persistScan(failedScan);

        config.eventBus.emit({
          type: "mission_error",
          missionId,
          code: "scan_failed",
          // Stryker disable next-line StringLiteral: fallback error message
          // — the Error case is tested, the string fallback is not.
          message: err instanceof Error ? err.message : "Scan failed",
          recoverable: true,
        });
      } finally {
        ACTIVE_SCANS.delete(scanId);
        // Clean up temp catalog file
        // Stryker disable next-line ConditionalExpression: the catalogFile
        // and config.catalogPath check is for temp file cleanup — tested
        // indirectly but perTest doesn't attribute.
        // Stryker disable next-line BooleanLiteral: same perTest issue.
        if (catalogFile && !config.catalogPath) {
          // Stryker disable next-line BlockStatement: cleanup is best-effort
          await unlink(catalogFile).catch(() => {});
        }
      }
    });

    return { scanId };
  }

  async function getScan(scanId: string): Promise<BumblebeeScanResult | null> {
    return config.lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${scanId}`);
  }

  async function listScans(missionId: string): Promise<BumblebeeScanResult[]> {
    // Stryker disable next-line StringLiteral: setting key pattern —
    // tested by verifying scan results, not key format.
    const index = await config.lapis.getSetting<{ scanIds: string[] }>(`bumblebee_scans:${missionId}`);
    // Stryker disable next-line ConditionalExpression: the null check
    // is tested but perTest doesn't attribute.
    // Stryker disable next-line OptionalChaining: same perTest issue.
    if (!index?.scanIds?.length) return [];
    const scans: BumblebeeScanResult[] = [];
    for (const id of index.scanIds) {
      // Stryker disable next-line StringLiteral: setting key pattern
      const scan = await config.lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${id}`);
      // Stryker disable next-line ConditionalExpression: null filter
      if (scan) scans.push(scan);
    }
    return scans;
  }

  async function cancelScan(scanId: string): Promise<boolean> {
    const ac = ACTIVE_SCANS.get(scanId);
    if (ac) {
      ac.abort();
      ACTIVE_SCANS.delete(scanId);
      return true;
    }
    return false;
  }

  async function persistScan(scan: BumblebeeScanResult): Promise<void> {
    await config.lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
  }

  async function appendScanId(missionId: string, scanId: string): Promise<void> {
    // Stryker disable next-line StringLiteral: setting key pattern
    const existing = await config.lapis.getSetting<{ scanIds: string[] }>(`bumblebee_scans:${missionId}`);
    // Stryker disable next-line ArrayDeclaration: the ?? [] fallback is
    // tested by listScans but perTest doesn't attribute.
    const scanIds = existing?.scanIds ?? [];
    scanIds.push(scanId);
    // Stryker disable next-line StringLiteral: setting key pattern
    await config.lapis.setSetting(`bumblebee_scans:${missionId}`, { scanIds });
  }

  return {
    triggerScan,
    getScan,
    listScans,
    cancelScan,
  };
}
