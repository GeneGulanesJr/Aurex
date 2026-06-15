import type { CSSProperties } from "react";
import { buildMissionSnapshot, isMissionStoppable } from "./missionUiModel";

interface MissionSummaryHeaderProps {
  mission: { description: string; status: string };
  milestones: Array<{ status: string }>;
  workers: Array<{ status: string }>;
  cost: { totalCost: number; totalTokens: number } | null;
  onAbort?: () => void;
  aborting?: boolean;
}

const labelStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const valueStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "11px",
  color: "var(--text-secondary)",
};

export function MissionSummaryHeader({ mission, milestones, workers, cost, onAbort, aborting = false }: MissionSummaryHeaderProps) {
  const snapshot = buildMissionSnapshot({
    missionStatus: mission.status,
    milestoneStatuses: milestones.map((milestone) => milestone.status),
    workerStatuses: workers.map((worker) => worker.status),
    cost,
  });
  const showAbort = Boolean(onAbort) && isMissionStoppable(mission.status);

  return (
    <section style={{ border: "1px solid var(--border)", background: "var(--bg-surface)", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
        <span style={{ ...labelStyle, color: snapshot.statusColor, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "3px", padding: "3px 8px" }}>
          {snapshot.statusLabel}
        </span>
        <span style={valueStyle}>{snapshot.progressLabel}</span>
        <span style={valueStyle}>{snapshot.costLabel}</span>
        <span style={valueStyle}>{snapshot.tokensLabel}</span>
        <span style={valueStyle}>workers {snapshot.activeWorkers} active</span>
        {snapshot.failedWorkers > 0 && <span style={{ ...valueStyle, color: "var(--error)" }}>{snapshot.failedWorkers} failed</span>}
        {showAbort && (
          <button
            type="button"
            onClick={onAbort}
            disabled={aborting}
            title="Stop this mission"
            style={{
              marginLeft: "auto",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              padding: "6px 10px",
              borderRadius: "3px",
              border: "1px solid var(--error)",
              background: aborting ? "var(--bg-elevated)" : "var(--error)",
              color: aborting ? "var(--text-muted)" : "#fff",
              cursor: aborting ? "not-allowed" : "pointer",
            }}
          >
            {aborting ? "Stopping…" : "Stop Mission"}
          </button>
        )}
      </div>
      <div style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: 500, lineHeight: 1.4 }}>
        {mission.description}
      </div>
    </section>
  );
}
