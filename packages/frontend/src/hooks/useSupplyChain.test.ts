import { describe, it, expect } from "vitest";
import { supplyChainReducer, initialSupplyChainState } from "./useSupplyChain";

describe("supplyChainReducer — scan state management", () => {
  it("handles SCAN_STARTED — sets isScanning to true", () => {
    const state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    expect(state.isScanning).toBe(true);
    expect(state.error).toBeNull();
  });

  it("handles SCAN_COMPLETED — sets isScanning to false and stores summary", () => {
    const scanningState = { ...initialSupplyChainState, isScanning: true, scans: [{ id: "s1", missionId: "m1", profile: "project", status: "running", startedAt: "" }] } as any;
    const summary = {
      totalPackages: 142,
      totalFindings: 2,
      criticalCount: 1,
      highCount: 0,
      mediumCount: 1,
      lowCount: 0,
      ecosystems: ["npm", "go"],
    };
    const state = supplyChainReducer(scanningState, { type: "SCAN_COMPLETED", scanId: "s1", summary });
    expect(state.isScanning).toBe(false);
    expect(state.latestSummary).toEqual(summary);
  });

  it("handles SCAN_FINDING — appends finding to findings", () => {
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
    const state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_FINDING", finding });
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]).toEqual(finding);
  });

  it("accumulates multiple findings", () => {
    let state = supplyChainReducer(initialSupplyChainState, {
      type: "SCAN_FINDING",
      finding: { id: "f1", severity: "critical" } as any,
    });
    state = supplyChainReducer(state, {
      type: "SCAN_FINDING",
      finding: { id: "f2", severity: "medium" } as any,
    });
    expect(state.findings).toHaveLength(2);
  });

  it("resets scan state on RESET", () => {
    const stateWithScan = {
      ...initialSupplyChainState,
      isScanning: true,
      findings: [{ id: "f1" } as any],
      latestSummary: { totalPackages: 10 } as any,
    };
    const state = supplyChainReducer(stateWithScan, { type: "RESET" });
    expect(state.isScanning).toBe(false);
    expect(state.findings).toHaveLength(0);
    expect(state.latestSummary).toBeNull();
  });
});
