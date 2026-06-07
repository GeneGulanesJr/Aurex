import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LaPisClient } from "../src/clients/lapis-client.js";
import type { BumblebeeClient, BumblebeeScanProgress, BumblebeeScanResult as BumblebeeScanResultType } from "../src/clients/bumblebee-client.js";
import type { EventBus } from "../src/ws/events.js";
import { createBumblebeeRunner } from "../src/orchestrator/bumblebee-runner.js";

function createMockLapis(): LaPisClient & { _store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  } as unknown as LaPisClient & { _store: Map<string, unknown> };
}

function createMockBumblebeeClient(
  scanResult?: Partial<BumblebeeScanResultType>,
  progressFindings?: BumblebeeScanProgress[],
): BumblebeeClient {
  return {
    isAvailable: vi.fn(async () => ({ available: true, version: "v0.1.1" })),
    scan: vi.fn(async (_opts, onProgress?: (p: BumblebeeScanProgress) => void) => {
      if (progressFindings) {
        for (const p of progressFindings) {
          onProgress?.(p);
        }
      } else {
        onProgress?.({ packages: [], findings: [] });
      }
      return scanResult ?? { packages: [], findings: [] };
    }),
  } as unknown as BumblebeeClient;
}

function createMockEventBus(): EventBus & { _events: unknown[] } {
  const events: unknown[] = [];
  return {
    _events: events,
    emit: vi.fn((event: unknown) => { events.push(event); }),
    subscribe: vi.fn(() => () => {}),
    getEventsSince: vi.fn(() => []),
    getCurrentSeq: vi.fn(() => 0),
  } as unknown as EventBus & { _events: unknown[] };
}

describe("bumblebee-runner", () => {
  // ── triggerScan ────────────────────────────────────────────────────

  describe("triggerScan", () => {
    it("creates scan record and emits scan_started", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const result = await runner.triggerScan("mission-1", { profile: "project", root: "/tmp/test-repo" });

      expect(result.scanId).toBeTruthy();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "scan_started", missionId: "mission-1", profile: "project" }),
      );

      const scan = await runner.getScan(result.scanId);
      expect(scan).toBeTruthy();
      expect(scan?.status).toBe("running");
      expect(scan?.missionId).toBe("mission-1");
    });

    it("defaults profile to 'project' when not specified", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const result = await runner.triggerScan("mission-1", {});

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ profile: "project" }),
      );
    });

    it("defaults root to REPO_ROOT env var when not specified", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      process.env.REPO_ROOT = "/env/repo";
      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      await runner.triggerScan("mission-1", { profile: "baseline" });
      delete process.env.REPO_ROOT;

      // Wait for setImmediate
      await new Promise((r) => setTimeout(r, 50));

      expect(bumblebee.scan).toHaveBeenCalledWith(
        expect.objectContaining({ root: "/env/repo" }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });

    it("defaults root to /workspace when nothing specified", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      delete process.env.REPO_ROOT;
      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      await runner.triggerScan("mission-1", {});

      await new Promise((r) => setTimeout(r, 50));

      expect(bumblebee.scan).toHaveBeenCalledWith(
        expect.objectContaining({ root: "/workspace" }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });

    it("passes ecosystems to scan options", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      await runner.triggerScan("mission-1", { ecosystems: ["npm", "pip"] });

      await new Promise((r) => setTimeout(r, 50));

      expect(bumblebee.scan).toHaveBeenCalledWith(
        expect.objectContaining({ ecosystems: ["npm", "pip"] }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });

    it("emits scan_completed with summary when scan finishes", async () => {
      const lapis = createMockLapis();
      const scanResult = {
        packages: [
          { name: "lodash", version: "4.17.21", ecosystem: "npm" },
          { name: "express", version: "4.18.0", ecosystem: "npm" },
          { name: "flask", version: "2.0", ecosystem: "pip" },
        ],
        findings: [
          { id: "f-1", severity: "critical", title: "CVE-2024-001" },
          { id: "f-2", severity: "high", title: "CVE-2024-002" },
          { id: "f-3", severity: "medium", title: "CVE-2024-003" },
          { id: "f-4", severity: "low", title: "CVE-2024-004" },
          { id: "f-5", severity: "high", title: "CVE-2024-005" },
        ],
      };
      const bumblebee = createMockBumblebeeClient(scanResult);
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const { scanId } = await runner.triggerScan("mission-1", { root: "/tmp" });

      // Wait for setImmediate to fire
      await new Promise((r) => setTimeout(r, 50));

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "scan_completed",
          missionId: "mission-1",
          scanId,
          summary: expect.objectContaining({
            totalPackages: 3,
            totalFindings: 5,
            criticalCount: 1,
            highCount: 2,
            mediumCount: 1,
            lowCount: 1,
            ecosystems: expect.arrayContaining(["npm", "pip"]),
          }),
        }),
      );

      // Verify the scan was persisted with completed status
      const scan = await runner.getScan(scanId);
      expect(scan?.status).toBe("completed");
      expect(scan?.summary).toBeTruthy();
    });

    it("emits scan_finding for each new finding during progress", async () => {
      const lapis = createMockLapis();
      const progress1: BumblebeeScanProgress = {
        packages: [],
        findings: [{ id: "f-1", severity: "critical", title: "CVE-1" }],
      };
      const progress2: BumblebeeScanProgress = {
        packages: [],
        findings: [
          { id: "f-1", severity: "critical", title: "CVE-1" }, // duplicate — should be skipped
          { id: "f-2", severity: "high", title: "CVE-2" },
        ],
      };
      const bumblebee = createMockBumblebeeClient({}, [progress1, progress2]);
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const { scanId } = await runner.triggerScan("mission-1", { root: "/tmp" });

      await new Promise((r) => setTimeout(r, 50));

      // Should emit scan_finding for f-1 and f-2, but NOT a duplicate for f-1
      const findingEvents = eventBus._events.filter(
        (e: any) => e.type === "scan_finding",
      );
      expect(findingEvents).toHaveLength(2);
      expect(findingEvents[0]).toEqual(
        expect.objectContaining({
          type: "scan_finding",
          scanId,
          finding: expect.objectContaining({ id: "f-1", scanId, missionId: "mission-1" }),
        }),
      );
      expect(findingEvents[1]).toEqual(
        expect.objectContaining({
          finding: expect.objectContaining({ id: "f-2" }),
        }),
      );
    });

    it("emits mission_error when scan fails", async () => {
      const lapis = createMockLapis();
      const bumblebee = {
        isAvailable: vi.fn(async () => ({ available: true, version: "v0.1.1" })),
        scan: vi.fn(async () => { throw new Error("Bumblebee crashed"); }),
      } as unknown as BumblebeeClient;
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const { scanId } = await runner.triggerScan("mission-1", { root: "/tmp" });

      await new Promise((r) => setTimeout(r, 50));

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mission_error",
          missionId: "mission-1",
          code: "scan_failed",
          message: "Bumblebee crashed",
          recoverable: true,
        }),
      );

      // Scan should be persisted with failed status
      const scan = await runner.getScan(scanId);
      expect(scan?.status).toBe("failed");
    });

    it("uses stored catalog from lapis when catalogPath not configured", async () => {
      const lapis = createMockLapis();
      (lapis.getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === "bumblebee_catalog") {
          return { entries: [{ pattern: "*.env", exposure: "secrets" }] };
        }
        return lapis._store.get(key) ?? null;
      });

      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const { scanId } = await runner.triggerScan("mission-1", { root: "/tmp" });

      await new Promise((r) => setTimeout(r, 50));

      // The scan should have been called with an exposureCatalog path
      expect(bumblebee.scan).toHaveBeenCalledWith(
        expect.objectContaining({
          exposureCatalog: expect.stringContaining("bumblebee-catalog-"),
        }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });

    it("skips catalog when lapis has no stored catalog", async () => {
      const lapis = createMockLapis();
      (lapis.getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === "bumblebee_catalog") return null;
        return lapis._store.get(key) ?? null;
      });

      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      await runner.triggerScan("mission-1", { root: "/tmp" });

      await new Promise((r) => setTimeout(r, 50));

      expect(bumblebee.scan).toHaveBeenCalledWith(
        expect.objectContaining({ exposureCatalog: undefined }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
  });

  // ── getScan ──────────────────────────────────────────────────────────

  describe("getScan", () => {
    it("returns null for unknown scan", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const scan = await runner.getScan("nonexistent");
      expect(scan).toBeNull();
    });
  });

  // ── listScans ────────────────────────────────────────────────────────

  describe("listScans", () => {
    it("returns scans for a mission", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const result = await runner.triggerScan("mission-2", { profile: "deep" });

      const scans = await runner.listScans("mission-2");
      expect(scans).toHaveLength(1);
      expect(scans[0].id).toBe(result.scanId);
    });

    it("returns empty array for mission with no scans", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const scans = await runner.listScans("no-mission");
      expect(scans).toEqual([]);
    });
  });

  // ── cancelScan ────────────────────────────────────────────────────────

  describe("cancelScan", () => {
    it("returns true and aborts active scan", async () => {
      const lapis = createMockLapis();
      // Make scan hang so we can cancel it
      const bumblebee = {
        isAvailable: vi.fn(async () => ({ available: true, version: "v0.1.1" })),
        scan: vi.fn(async (_opts: any, _onProgress: any, signal: AbortSignal) => {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("Aborted")));
          });
        }),
      } as unknown as BumblebeeClient;
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const { scanId } = await runner.triggerScan("mission-1", { root: "/tmp" });

      const cancelled = await runner.cancelScan(scanId);
      expect(cancelled).toBe(true);

      await new Promise((r) => setTimeout(r, 50));
    });

    it("returns false for unknown scan", async () => {
      const lapis = createMockLapis();
      const bumblebee = createMockBumblebeeClient();
      const eventBus = createMockEventBus();

      const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
      const cancelled = await runner.cancelScan("nonexistent");
      expect(cancelled).toBe(false);
    });
  });
});
