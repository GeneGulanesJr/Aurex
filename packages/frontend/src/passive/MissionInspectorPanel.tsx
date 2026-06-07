import { useMemo, useState } from "react";
import type { BumblebeeFinding, BumblebeeScanResult, Milestone, WsClientEvent } from "@aurex/shared";
import { CodeContextPanel } from "./CodeContextPanel";
import { MissionActivityFeed } from "./MissionActivityFeed";
import { SupplyChainPanel } from "./SupplyChainPanel";
import { shouldShowSupplyChainTab, summarizeSupplyChainRisk } from "./missionUiModel";

interface MissionInspectorPanelProps {
  missionId: string;
  missionStatus: string;
  milestones: Milestone[];
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  events: WsClientEvent[];
  eventStreamCount: number;
  scanFindings: BumblebeeFinding[];
  isScanning: boolean;
  scans: BumblebeeScanResult[];
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
}

type TabId = "activity" | "code" | "supply";

export function MissionInspectorPanel(props: MissionInspectorPanelProps) {
  const latestScan = props.scans.length > 0 ? props.scans[props.scans.length - 1] : null;
  const showSupply = shouldShowSupplyChainTab({
    isScanning: props.isScanning,
    findingCount: props.scanFindings.length,
    scanCount: props.scans.length,
    hasLatestSummary: Boolean(latestScan?.summary),
  });
  const risk = summarizeSupplyChainRisk(props.scanFindings);
  const tabs = useMemo(() => [
    { id: "activity" as const, label: "Activity", badge: String(Math.min(props.eventStreamCount, props.events.length + props.logs.length)) },
    { id: "code" as const, label: "Code", badge: null },
    ...(showSupply ? [{ id: "supply" as const, label: "Supply", badge: risk.findingCount > 0 ? String(risk.findingCount) : risk.label }] : []),
  ], [props.eventStreamCount, props.events.length, props.logs.length, showSupply, risk.findingCount, risk.label]);
  const [activeTab, setActiveTab] = useState<TabId>("activity");
  const safeActiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : "activity";

  return (
    <aside className="mission-inspector-panel">
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "12px", flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: safeActiveTab === tab.id ? "var(--bg-elevated)" : "transparent",
              border: "none",
              borderBottom: `2px solid ${safeActiveTab === tab.id ? "var(--accent)" : "transparent"}`,
              color: safeActiveTab === tab.id ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "8px 10px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {tab.label}{tab.badge && <span style={{ marginLeft: "6px", color: tab.id === "supply" ? risk.color : "var(--text-secondary)" }}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div style={{ minHeight: 0, flex: 1, overflow: "hidden" }}>
        {safeActiveTab === "activity" && (
          <MissionActivityFeed logs={props.logs} events={props.events} active={props.missionStatus === "planning" || props.missionStatus === "running"} limit={props.eventStreamCount} />
        )}
        {safeActiveTab === "code" && (
          <div style={{ overflowY: "auto", height: "100%" }}>
            <CodeContextPanel missionId={props.missionId} logs={props.logs} milestones={props.milestones} variant="inspector" autoCollapse={false} showCollapsedSummary={false} />
          </div>
        )}
        {safeActiveTab === "supply" && (
          <div style={{ overflowY: "auto", height: "100%" }}>
            <SupplyChainPanel findings={props.scanFindings} scans={props.scans} isScanning={props.isScanning} onTriggerScan={props.onTriggerScan} variant="inspector" hideWhenEmpty />
          </div>
        )}
      </div>
    </aside>
  );
}
