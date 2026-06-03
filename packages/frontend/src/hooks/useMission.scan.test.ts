import { describe, it, expect } from "vitest";
import { missionReducer, initialMissionState } from "./useMission";

describe("missionReducer — supply chain scan events", () => {
  const seedState = {
    ...initialMissionState,
    mission: { id: "m1", description: "Test", status: "running", configJson: {} } as any,
  };

  it("handles SCAN_STARTED — sets isScanning to true", () => {
    const state = missionReducer(seedState as any, { type: "SCAN_STARTED" });
    expect(state.isScanning).toBe(true);
  });

  it("handles SCAN_COMPLETED — sets isScanning to false and stores summary", () => {
    const scanningState = { ...seedState, isScanning: true } as any;
    const summary = {
      totalPackages: 142,
      totalFindings: 2,
      criticalCount: 1,
      highCount: 0,
      mediumCount: 1,
      lowCount: 0,
      ecosystems: ["npm", "go"],
    };
    const state = missionReducer(scanningState, { type: "SCAN_COMPLETED", summary });
    expect(state.isScanning).toBe(false);
    expect(state.scanSummary).toEqual(summary);
  });

  it("handles SCAN_FINDING — appends finding to scanFindings", () => {
    const finding = {
      id: "f1",
      scanId: "s1",
      missionId: "m1",
      findingType: "package_exposure",
      severity: "critical" as const,
      catalogId: "advisory-2026-0042",
      catalogName: "example-pkg compromised",
      ecosystem: "npm",
      packageName: "example-pkg",
      normalizedName: "example-pkg",
      version: "1.2.3",
      sourceType: "pnpm-lockfile",
      sourceFile: "/repo/pnpm-lock.yaml",
      confidence: "high" as const,
      evidence: "exact name+version match",
    };
    const state = missionReducer(seedState as any, { type: "SCAN_FINDING", finding });
    expect(state.scanFindings).toHaveLength(1);
    expect(state.scanFindings[0]).toEqual(finding);
  });

  it("accumulates multiple findings", () => {
    let state = missionReducer(seedState as any, {
      type: "SCAN_FINDING",
      finding: { id: "f1", severity: "critical" } as any,
    });
    state = missionReducer(state, {
      type: "SCAN_FINDING",
      finding: { id: "f2", severity: "medium" } as any,
    });
    expect(state.scanFindings).toHaveLength(2);
  });

  it("resets scan state on RESET", () => {
    const stateWithScan = {
      ...seedState,
      isScanning: true,
      scanFindings: [{ id: "f1" } as any],
      scanSummary: { totalPackages: 10 } as any,
    };
    const state = missionReducer(stateWithScan as any, { type: "RESET" });
    expect(state.isScanning).toBe(false);
    expect(state.scanFindings).toHaveLength(0);
    expect(state.scanSummary).toBeNull();
  });
});
