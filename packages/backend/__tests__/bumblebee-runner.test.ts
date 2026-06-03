import { describe, it, expect, vi } from "vitest";
import type { LaPisClient } from "../src/clients/lapis-client.js";
import type { BumblebeeClient, BumblebeeScanProgress } from "../src/clients/bumblebee-client.js";
import type { EventBus } from "../src/ws/events.js";
import { createBumblebeeRunner } from "../src/orchestrator/bumblebee-runner.js";

function createMockLapis(): LaPisClient {
  const store = new Map<string, unknown>();
  return {
    getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  } as unknown as LaPisClient;
}

function createMockBumblebeeClient(): BumblebeeClient {
  return {
    isAvailable: vi.fn(async () => ({ available: true, version: "v0.1.1" })),
    scan: vi.fn(async (_opts, onProgress?: (p: BumblebeeScanProgress) => void) => {
      const progress: BumblebeeScanProgress = { packages: [], findings: [] };
      onProgress?.(progress);
      return progress;
    }),
  } as unknown as BumblebeeClient;
}

function createMockEventBus(): EventBus {
  const events: unknown[] = [];
  return {
    emit: vi.fn((event: unknown) => { events.push(event); }),
    subscribe: vi.fn(() => () => {}),
    getEventsSince: vi.fn(() => []),
    getCurrentSeq: vi.fn(() => 0),
  } as unknown as EventBus;
}

describe("bumblebee-runner", () => {
  it("triggerScan creates scan record and emits scan_started", async () => {
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

  it("listScans returns scans for a mission", async () => {
    const lapis = createMockLapis();
    const bumblebee = createMockBumblebeeClient();
    const eventBus = createMockEventBus();

    const store = new Map<string, unknown>();
    (lapis.getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => store.get(key) ?? null);
    (lapis.setSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, value: unknown) => { store.set(key, value); });

    const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
    const result = await runner.triggerScan("mission-2", { profile: "deep" });

    const scans = await runner.listScans("mission-2");
    expect(scans).toHaveLength(1);
    expect(scans[0].id).toBe(result.scanId);
  });

  it("getScan returns null for unknown scan", async () => {
    const lapis = createMockLapis();
    const bumblebee = createMockBumblebeeClient();
    const eventBus = createMockEventBus();

    const runner = createBumblebeeRunner({ lapis, bumblebee, eventBus });
    const scan = await runner.getScan("nonexistent");
    expect(scan).toBeNull();
  });
});
