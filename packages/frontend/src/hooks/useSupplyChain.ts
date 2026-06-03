import { useReducer, useCallback } from "react";
import type { BumblebeeScanResult, BumblebeeFinding, BumblebeeScanSummary, WsClientEvent } from "@aurex/shared";
import { triggerScan, listScans } from "../api";

export interface SupplyChainState {
  scans: BumblebeeScanResult[];
  findings: BumblebeeFinding[];
  isScanning: boolean;
  latestSummary: BumblebeeScanSummary | null;
  error: string | null;
}

type Action =
  | { type: "SCAN_STARTED"; scanId: string; profile: string }
  | { type: "SCAN_COMPLETED"; scanId: string; summary: BumblebeeScanSummary }
  | { type: "SCAN_FINDING"; finding: BumblebeeFinding }
  | { type: "SET_SCANS"; scans: BumblebeeScanResult[] }
  | { type: "SET_ERROR"; error: string }
  | { type: "RESET" };

export const initialSupplyChainState: SupplyChainState = {
  scans: [],
  findings: [],
  isScanning: false,
  latestSummary: null,
  error: null,
};

export function supplyChainReducer(state: SupplyChainState, action: Action): SupplyChainState {
  switch (action.type) {
    case "SCAN_STARTED":
      return { ...state, isScanning: true, error: null };
    case "SCAN_COMPLETED":
      return {
        ...state,
        isScanning: state.scans.some((s) => s.status === "running"),
        latestSummary: action.summary,
        scans: state.scans.map((s) =>
          s.id === action.scanId
            ? { ...s, status: "completed", summary: action.summary, completedAt: new Date().toISOString() }
            : s,
        ),
      };
    case "SCAN_FINDING":
      return { ...state, findings: [...state.findings, action.finding] };
    case "SET_SCANS":
      return { ...state, scans: action.scans, isScanning: action.scans.some((s) => s.status === "running") };
    case "SET_ERROR":
      return { ...state, error: action.error, isScanning: false };
    case "RESET":
      return initialSupplyChainState;
    default:
      return state;
  }
}

export function useSupplyChain(missionId: string | null) {
  const [state, dispatch] = useReducer(supplyChainReducer, initialSupplyChainState);

  const loadScans = useCallback(async () => {
    if (!missionId) return;
    try {
      const { scans } = await listScans(missionId);
      dispatch({ type: "SET_SCANS", scans });
    } catch {}
  }, [missionId]);

  const handleTriggerScan = useCallback(async (profile?: "baseline" | "project" | "deep", ecosystems?: string[]) => {
    if (!missionId) return;
    try {
      await triggerScan(missionId, { profile, ecosystems });
    } catch (err) {
      dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "Failed to trigger scan" });
    }
  }, [missionId]);

  const handleWsEvent = useCallback((event: WsClientEvent) => {
    if (!missionId) return;
    if ("missionId" in event && event.missionId !== missionId) return;

    switch (event.type) {
      case "scan_started":
        dispatch({ type: "SCAN_STARTED", scanId: event.scanId, profile: event.profile });
        break;
      case "scan_completed":
        dispatch({ type: "SCAN_COMPLETED", scanId: event.scanId, summary: event.summary });
        break;
      case "scan_finding":
        dispatch({ type: "SCAN_FINDING", finding: event.finding });
        break;
    }
  }, [missionId]);

  return { state, dispatch, loadScans, triggerScan: handleTriggerScan, handleWsEvent };
}
