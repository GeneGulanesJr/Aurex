import { randomUUID } from "crypto";
import { writeFile, unlink, mkdir } from "fs/promises";
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
      type: "scan_started",
      missionId,
      scanId,
      profile,
    });

    const abortController = new AbortController();
    ACTIVE_SCANS.set(scanId, abortController);

    // Resolve catalog file: if not configured, check KV store and write to temp
    let catalogFile = config.catalogPath;
    if (!catalogFile) {
      const storedCatalog = await config.lapis.getSetting<ExposureCatalog>("bumblebee_catalog");
      if (storedCatalog?.entries?.length) {
        catalogFile = join(tmpdir(), `bumblebee-catalog-${scanId}.json`);
        await writeFile(catalogFile, JSON.stringify(storedCatalog), "utf-8");
      }
    }

    const scanOptions: BumblebeeScanOptions = {
      root,
      profile,
      ecosystems: options.ecosystems,
      exposureCatalog: catalogFile || undefined,
      scanId,
    };

    setImmediate(async () => {
      try {
        const collectedFindings: BumblebeeFinding[] = [];

        const result = await config.bumblebee.scan(
          scanOptions,
          (progress) => {
            for (const finding of progress.findings) {
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
          findings: collectedFindings.length > 0 ? collectedFindings : undefined,
        };

        await persistScan(completedScan);

        // Clean up temp catalog file
        if (catalogFile && !config.catalogPath) {
          await unlink(catalogFile).catch(() => {});
        }

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
          message: err instanceof Error ? err.message : "Scan failed",
          recoverable: true,
        });
      } finally {
        ACTIVE_SCANS.delete(scanId);
      }
    });

    return { scanId };
  }

  async function getScan(scanId: string): Promise<BumblebeeScanResult | null> {
    return config.lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${scanId}`);
  }

  async function listScans(missionId: string): Promise<BumblebeeScanResult[]> {
    const index = await config.lapis.getSetting<{ scanIds: string[] }>(`bumblebee_scans:${missionId}`);
    if (!index?.scanIds?.length) return [];
    const scans: BumblebeeScanResult[] = [];
    for (const id of index.scanIds) {
      const scan = await config.lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${id}`);
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
    const existing = await config.lapis.getSetting<{ scanIds: string[] }>(`bumblebee_scans:${missionId}`);
    const scanIds = existing?.scanIds ?? [];
    scanIds.push(scanId);
    await config.lapis.setSetting(`bumblebee_scans:${missionId}`, { scanIds });
  }

  return {
    triggerScan,
    getScan,
    listScans,
    cancelScan,
  };
}
