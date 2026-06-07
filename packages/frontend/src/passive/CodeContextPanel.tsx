import { useEffect, useState, useMemo, useRef } from "react";
import { animate } from "animejs";
import { getCodeSummary, getCodeGraph, getCodeHotspots, type CodeSummaryResponse, type CodeGraphResponse, type CodeHotspotsResponse } from "../api";
import { ArchitectureSummary } from "./ArchitectureSummary";
import { DependencyGraph } from "./DependencyGraph";
import { HotspotHeatmap } from "./HotspotHeatmap";
import type { CSSProperties } from "react";

interface LogEntry {
  phase: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface CodeContextPanelProps {
  missionId: string;
  logs: LogEntry[];
  milestones: { status?: string }[];
  variant?: "inline" | "inspector";
  autoCollapse?: boolean;
  showCollapsedSummary?: boolean;
}

const COLLAPSED_BG: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "1px",
  cursor: "pointer",
  padding: "8px 0",
};

export function CodeContextPanel({
  missionId,
  logs,
  milestones,
  variant = "inline",
  autoCollapse = true,
  showCollapsedSummary = true,
}: CodeContextPanelProps) {
  const [summary, setSummary] = useState<CodeSummaryResponse | null>(null);
  const [graph, setGraph] = useState<CodeGraphResponse | null>(null);
  const [hotspots, setHotspots] = useState<CodeHotspotsResponse | null>(null);
  const [graphError, setGraphError] = useState(false);
  const [hotspotsError, setHotspotsError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const indexingDone = useMemo(() => logs.some((l) => l.phase === "indexing" && l.data?.indexingDone === true), [logs]);

  const indexCounts = useMemo(() => {
    const doneLog = logs.find((l) => l.phase === "indexing" && l.data?.indexingDone === true);
    return { files: (doneLog?.data?.files as number) ?? 0, symbols: (doneLog?.data?.symbols as number) ?? 0 };
  }, [logs]);

  useEffect(() => {
    if (!indexingDone || !missionId) return;
    getCodeSummary(missionId).then(setSummary).catch(() => setSummaryError(true));
    getCodeGraph(missionId).then(setGraph).catch(() => setGraphError(true));
    getCodeHotspots(missionId).then(setHotspots).catch(() => setHotspotsError(true));
  }, [indexingDone, missionId]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || !indexingDone) return;
    animate(el, { opacity: [0, 1], translateY: [12, 0], duration: 400, ease: "outExpo" });
  }, [indexingDone]);

  useEffect(() => {
    if (autoCollapse && milestones.length > 0 && indexingDone && !collapsed) {
      setCollapsed(true);
    }
  }, [autoCollapse, milestones.length, indexingDone, collapsed]);

  const toggleCollapse = () => setCollapsed((c) => !c);

  if (!indexingDone) {
    if (variant === "inspector") {
      return (
        <div style={{ border: "1px dashed var(--border)", borderRadius: "6px", padding: "16px", textAlign: "center", color: "var(--text-muted)", fontFamily: '\"JetBrains Mono\", monospace', fontSize: "11px", lineHeight: 1.5 }}>
          Code context pending indexing…
        </div>
      );
    }
    return null;
  }

  if (collapsed && showCollapsedSummary) {
    return (
      <div style={COLLAPSED_BG} onClick={toggleCollapse}>
        ▸ Code Context ({indexCounts.files} files, {indexCounts.symbols} symbols)
      </div>
    );
  }

  if (collapsed && !showCollapsedSummary) return null;

  const rootStyle: CSSProperties = variant === "inspector"
    ? { opacity: 0 }
    : { borderBottom: "1px solid var(--border)", marginBottom: "16px", opacity: 0 };

  return (
    <div ref={panelRef} style={rootStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Code Context
        </span>
        <span onClick={toggleCollapse} style={{ cursor: "pointer", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>
          ▾ collapse
        </span>
      </div>
      <ArchitectureSummary data={summary} error={summaryError} />
      <DependencyGraph data={graph} error={graphError} />
      <HotspotHeatmap data={hotspots} error={hotspotsError} />
    </div>
  );
}