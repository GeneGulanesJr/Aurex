import type { BumblebeeFinding, BumblebeeScanResult, Milestone, WsClientEvent } from "@aurex/shared";
import type { AgentLogEntry, MissionError } from "../hooks/useMission";
import { CodeContextPanel } from "./CodeContextPanel";
import { MissionActivityFeed } from "./MissionActivityFeed";
import { MissionDebugLog } from "./MissionDebugLog";
import { SupplyChainPanel } from "./SupplyChainPanel";
import { shouldShowSupplyChainTab, summarizeSupplyChainRisk, isMissionActive } from "./missionUiModel";

interface MissionInspectorPanelProps {
  mission: { id: string; description: string; status: string };
  missionId: string;
  missionStatus: string;
  milestones: Milestone[];
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  events: WsClientEvent[];
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
  eventStreamCount: number;
  autoCollapseContext?: boolean;
  scanFindings: BumblebeeFinding[];
  isScanning: boolean;
  scans: BumblebeeScanResult[];
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
}

export function MissionInspectorPanel(props: MissionInspectorPanelProps) {
  const latestScan = props.scans.length > 0 ? props.scans[props.scans.length - 1] : null;
  const showSupply = shouldShowSupplyChainTab({
    isScanning: props.isScanning,
    findingCount: props.scanFindings.length,
    scanCount: props.scans.length,
    hasLatestSummary: Boolean(latestScan?.summary),
  });
  const risk = summarizeSupplyChainRisk(props.scanFindings);
  const activityCount = Math.min(props.eventStreamCount, props.events.length + props.logs.length);
  const isMissionActiveStatus = isMissionActive(props.missionStatus);

  return (
    <aside className="mission-inspector-panel mission-inspector-panel--open">
      <InspectorSection
        title="Live Activity"
        badge={activityCount > 0 ? String(activityCount) : "Ready"}
      >
        <MissionActivityFeed
          logs={props.logs}
          events={props.events}
          active={isMissionActiveStatus}
          limit={props.eventStreamCount}
        />
      </InspectorSection>

      <InspectorSection
        title="Debug Log"
        badge="Copyable"
      >
        <MissionDebugLog
          mission={props.mission}
          milestones={props.milestones}
          logs={props.logs}
          events={props.events}
          errors={props.errors}
          agentLogs={props.agentLogs}
        />
      </InspectorSection>

      <InspectorSection title="Code Context" badge="Always visible">
        <CodeContextPanel
          missionId={props.missionId}
          logs={props.logs}
          milestones={props.milestones}
          variant="inspector"
          autoCollapse={props.autoCollapseContext ?? false}
          showCollapsedSummary={false}
        />
      </InspectorSection>

      {showSupply && (
        <InspectorSection title="Supply Chain" badge={risk.findingCount > 0 ? String(risk.findingCount) : risk.label} badgeColor={risk.color}>
          <SupplyChainPanel
            findings={props.scanFindings}
            scans={props.scans}
            isScanning={props.isScanning}
            onTriggerScan={props.onTriggerScan}
            variant="inspector"
            hideWhenEmpty
          />
        </InspectorSection>
      )}
    </aside>
  );
}

function InspectorSection({
  title,
  badge,
  badgeColor = "var(--text-secondary)",
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mission-inspector-section">
      <div className="mission-inspector-section-header">
        <span>{title}</span>
        {badge && <span style={{ color: badgeColor }}>{badge}</span>}
      </div>
      <div className="mission-inspector-section-body">{children}</div>
    </section>
  );
}
