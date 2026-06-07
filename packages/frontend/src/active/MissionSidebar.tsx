import { useCallback } from "react";
import type { MissionListItem } from "../hooks/useMissions";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { abortMission, restartMission } from "../api";
import { NewMissionForm } from "./NewMissionForm";
import type { CodeSummaryResponse } from "../api";

interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  escalationMissionId?: string | null;
  onSelect: (missionId: string) => void;
  onRemove: (missionId: string) => void;
  onRestart: (missionId: string) => void;
  onCreateMission: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  systemReady?: boolean;
  totalCost?: number;
  collapsed?: boolean;
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
  } | null;
  onRepoPrepared?: (info: { repoName: string; fullName: string; summary: CodeSummaryResponse | null }) => void;
  suggestedDescription?: string;
}

function statusBadge(state: string): { label: string; style: React.CSSProperties } {
  switch (state) {
    case "queued":
      return { label: "Queued", style: { background: "var(--warning)", color: "var(--bg-deep)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "planning":
    case "executing":
      return { label: "Running", style: { background: "var(--info)", color: "var(--bg-deep)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "waiting_checkpoint":
      return { label: "Checkpoint", style: { background: "var(--badge-info-bg)", color: "var(--info)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "completed":
      return { label: "Done", style: { background: "var(--badge-success-bg)", color: "var(--success)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "failed":
      return { label: "Failed", style: { background: "var(--badge-error-bg)", color: "var(--error)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    default:
      return { label: state, style: { background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
  }
}

function statusIcon(state: string): string {
  switch (state) {
    case "queued": return "◷";
    case "planning":
    case "executing": return "▶";
    case "waiting_checkpoint": return "⏸";
    case "completed": return "✓";
    case "failed": return "✕";
    default: return "•";
  }
}

function statusIconColor(state: string): string {
  switch (state) {
    case "queued": return "var(--warning)";
    case "planning":
    case "executing": return "var(--info)";
    case "waiting_checkpoint": return "var(--info)";
    case "completed": return "var(--success)";
    case "failed": return "var(--error)";
    default: return "var(--text-muted)";
  }
}

export function MissionSidebar({ missions, selectedMissionId, escalationMissionId, onSelect, onRemove, onRestart, onCreateMission, github, systemReady, totalCost, collapsed = false, preparedRepo, onRepoPrepared, suggestedDescription }: MissionSidebarProps) {
  const handleAbort = useCallback(async (e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    try {
      await abortMission(missionId);
      onRemove(missionId);
    } catch {}
  }, [onRemove]);

  const handleRestart = useCallback(async (e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    try {
      await restartMission(missionId);
      onRestart(missionId);
    } catch {}
  }, [onRestart]);

  if (collapsed) {
    return (
      <aside className="sidebar-transition" style={{ width: "48px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "12px", gap: "4px" }}>
        <div style={{ fontSize: "10px", fontFamily: '"JetBrains Mono", monospace', color: "var(--text-muted)", letterSpacing: "0", marginBottom: "8px" }}>
          M
        </div>
        {missions.map((mission) => {
          const isSelected = mission.missionId === selectedMissionId;
          return (
            <div
              key={mission.missionId}
              onClick={() => onSelect(mission.missionId)}
              title={mission.description ?? mission.missionId}
              style={{
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                borderRadius: "4px",
                background: isSelected ? "var(--bg-elevated)" : "transparent",
                color: statusIconColor(mission.state),
                fontSize: "14px",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-elevated)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              {statusIcon(mission.state)}
            </div>
          );
        })}
      </aside>
    );
  }

  if (missions.length === 0) {
    return (
      <aside className="sidebar-transition" style={{ width: "280px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "2px", margin: 0 }}>Missions</h2>
        </div>
        <NewMissionForm onSubmit={onCreateMission} github={github} preparedRepo={preparedRepo} onRepoPrepared={onRepoPrepared} suggestedDescription={suggestedDescription} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <div style={{ width: "32px", height: "32px", border: "1px dashed var(--border)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--border-bright)", fontSize: "16px" }}>◎</div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>NO ACTIVE MISSIONS</span>
          {!systemReady ? (
            <span style={{ fontSize: "10px", color: "var(--warning)" }}>Configure integrations first</span>
          ) : (
            <span style={{ fontSize: "10px", color: "var(--border-bright)" }}>Create a mission to begin</span>
          )}
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", marginTop: "auto" }}>
          <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "4px" }}>
            Total Spent
          </div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace' }}>
            ${(totalCost ?? 0).toFixed(2)}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar-transition" style={{ width: "280px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "2px", margin: 0 }}>Missions</h2>
      </div>
      {!systemReady ? (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--warning)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "1px" }}>Integrations Required</span>
          <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>Configure GitHub & PiNyx in Integrations panel before creating missions.</span>
        </div>
      ) : (
        <NewMissionForm onSubmit={onCreateMission} github={github} preparedRepo={preparedRepo} onRepoPrepared={onRepoPrepared} suggestedDescription={suggestedDescription} />
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {missions.map((mission) => {
          const badge = statusBadge(mission.state);
          const isSelected = mission.missionId === selectedMissionId;
          return (
            <div
              key={mission.missionId}
              onClick={() => onSelect(mission.missionId)}
              style={{
                padding: "12px 16px",
                cursor: "pointer",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: isSelected ? "var(--bg-elevated)" : "transparent",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-elevated)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {escalationMissionId === mission.missionId && (
                    <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--warning)", boxShadow: "0 0 6px var(--warning)", flexShrink: 0 }} />
                  )}
                  <span style={badge.style}>{badge.label}</span>
                  {mission.queuePosition != null && (
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>#{mission.queuePosition}</span>
                  )}
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-primary)", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {mission.description ?? mission.missionId}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
                {mission.state === "failed" && (
                  <button
                    onClick={(e) => handleRestart(e, mission.missionId)}
                    style={{ color: "var(--accent)", background: "none", border: "1px solid var(--accent-dim)", borderRadius: "3px", cursor: "pointer", fontSize: "10px", opacity: 1, padding: "3px 6px", fontFamily: '\"JetBrains Mono\", monospace', textTransform: "uppercase", letterSpacing: "1px" }}
                    title="Restart mission"
                  >
                    Restart
                  </button>
                )}
                {(mission.state === "queued" || mission.state === "planning" || mission.state === "executing" || mission.state === "waiting_checkpoint") && (
                  <button
                    onClick={(e) => handleAbort(e, mission.missionId)}
                    style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "12px", opacity: 0, transition: "opacity 0.15s", padding: "4px" }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "var(--error)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.style.color = "var(--text-muted)"; }}
                    title="Abort mission"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "4px" }}>
          Total Spent
        </div>
        <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace' }}>
          ${(totalCost ?? 0).toFixed(2)}
        </div>
      </div>
    </aside>
  );
}
