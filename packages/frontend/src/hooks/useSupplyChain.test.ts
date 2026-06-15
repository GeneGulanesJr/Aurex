import { describe, it, expect } from "vitest";
import { supplyChainReducer, initialSupplyChainState } from "./useSupplyChain";

describe("supplyChainReducer — scan state management", () => {
  it("handles SCAN_STARTED — sets isScanning true AND adds a running scan row", () => {
    const state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    expect(state.isScanning).toBe(true);
    expect(state.error).toBeNull();
    expect(state.scans).toHaveLength(1);
    expect(state.scans[0]).toMatchObject({ id: "s1", status: "running", profile: "project" });
  });

  it("does not duplicate a scan row if SCAN_STARTED fires twice for the same id", () => {
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    expect(state.scans.filter((s) => s.id === "s1")).toHaveLength(1);
  });

  it("completes a full live scan lifecycle without dropping it", () => {
    const summary = { totalPackages: 1, totalFindings: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: ["npm"] };
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s1", summary });
    expect(state.scans.find((s) => s.id === "s1")?.status).toBe("completed");
    expect(state.scans.find((s) => s.id === "s1")?.summary).toEqual(summary);
    expect(state.isScanning).toBe(false);
    expect(state.latestSummary).toEqual(summary);
  });

  it("keeps isScanning true while at least one scan is still running", () => {
    let state = supplyChainReducer(initialSupplyChainState, { type: "SCAN_STARTED", scanId: "s1", profile: "project" });
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s2", profile: "deep" });
    expect(state.scans).toHaveLength(2);
    const summary = { totalPackages: 1, totalFindings: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, ecosystems: [] };
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s1", summary });
    expect(state.isScanning).toBe(true);
    state = supplyChainReducer(state, { type: "SCAN_COMPLETED", scanId: "s2", summary });
    expect(state.isScanning).toBe(false);
  });

  it("caps accumulated findings at 200 and clears them when a new scan starts", () => {
    const makeFinding = (i: number) => ({
      id: `f${i}`, scanId: "s1", missionId: "m1", findingType: "package_exposure",
      severity: "low" as const, catalogId: "c", catalogName: "n", ecosystem: "npm",
      packageName: "p", normalizedName: "p", version: "1", sourceType: "lockfile",
      sourceFile: "/f", confidence: "high" as const, evidence: "e",
    });
    let state = { ...initialSupplyChainState, isScanning: true, scans: [{ id: "s1", status: "running" }] } as any;
    for (let i = 0; i < 250; i++) {
      state = supplyChainReducer(state, { type: "SCAN_FINDING", finding: makeFinding(i) });
    }
    expect(state.findings).toHaveLength(200);
    state = supplyChainReducer(state, { type: "SCAN_STARTED", scanId: "s2", profile: "baseline" });
    expect(state.findings).toHaveLength(0);
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
