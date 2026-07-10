import { useCallback } from "react";
import type { MissionListItem } from "../hooks/useMissions";
import { getMissionStatusUi, isMissionStoppable } from "../passive/missionUiModel";

interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  escalationMissionId?: string | null;
  onSelect: (missionId: string | null) => void;
  onAbort: (missionId: string) => void;
  onRestart: (missionId: string) => void;
  onDelete?: (missionId: string) => void;
  deletingMissionId?: string | null;
  abortingMissionId?: string | null;
  systemReady?: boolean;
  totalCost?: number;
  collapsed?: boolean;
  loadError?: string | null;
}

export function MissionSidebar({ missions, selectedMissionId, escalationMissionId, onSelect, onAbort, onRestart, onDelete, deletingMissionId, abortingMissionId, systemReady, totalCost, collapsed = false, loadError }: MissionSidebarProps) {
  const handleNewMission = useCallback(() => {
    onSelect(null);
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("aurex:focus-new-mission"));
    });
  }, [onSelect]);

  const handleAbort = useCallback((e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    onAbort(missionId);
  }, [onAbort]);

  const handleRestart = useCallback((e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    onRestart(missionId);
  }, [onRestart]);

  const handleDelete = useCallback((e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    onDelete?.(missionId);
  }, [onDelete]);

  if (collapsed) {
    return (
      <aside className="sidebar-transition" style={{ width: "48px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "12px", gap: "4px" }}>
        {systemReady && (
          <div
            onClick={handleNewMission}
            title="New mission"
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              borderRadius: "4px",
              color: "var(--accent)",
              fontSize: "16px",
              fontWeight: 600,
              marginBottom: "4px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            +
          </div>
        )}
        {missions.map((mission) => {
          const isSelected = mission.missionId === selectedMissionId;
          const statusUi = getMissionStatusUi(mission.state);
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
                color: statusUi.iconColor,
                fontSize: "14px",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-elevated)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              {statusUi.icon}
            </div>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="sidebar-transition" style={{ width: "280px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "2px", margin: 0 }}>Missions</h2>
        {systemReady && (
          <button
            onClick={handleNewMission}
            style={{
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--accent)",
              color: "var(--bg-deep)",
              border: "none",
              borderRadius: "4px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: '"JetBrains Mono", monospace',
              lineHeight: 1,
            }}
            title="New mission"
          >
            +
          </button>
        )}
      </div>
      {loadError && (
        <div style={{ margin: "8px 12px 0", padding: "8px 10px", borderRadius: "4px", border: "1px solid var(--error)", background: "var(--bg-inset)", color: "var(--error)", fontSize: "11px", lineHeight: 1.5 }}>
          {loadError}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {missions.length === 0 && (
          <div style={{ padding: "16px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
            No missions yet
          </div>
        )}
        {missions.map((mission) => {
          const statusUi = getMissionStatusUi(mission.state);
          const isSelected = mission.missionId === selectedMissionId;
          return (
            <div
              key={mission.missionId}
              onClick={() => onSelect(mission.missionId)}
              style={{
                padding: "10px 12px",
                marginBottom: "4px",
                borderRadius: "6px",
                cursor: "pointer",
                background: isSelected ? "var(--bg-elevated)" : "transparent",
                border: isSelected ? "1px solid var(--border)" : "1px solid transparent",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                  <span style={{ color: statusUi.iconColor, fontSize: "12px" }}>{statusUi.icon}</span>
                  <span style={{ fontSize: "12px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {mission.description ?? mission.missionId.slice(0, 8)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  {mission.queuePosition != null && (
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>#{mission.queuePosition}</span>
                  )}
                  <span style={statusUi.badgeStyle}>{statusUi.sidebarLabel}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "4px", marginTop: "8px", justifyContent: "flex-end" }}>
                {(mission.state === "failed" || mission.state === "aborted") && (
                  <button
                    onClick={(e) => handleRestart(e, mission.missionId)}
                    style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "3px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}
                  >
                    Restart
                  </button>
                )}
                {isMissionStoppable(mission.state) && (
                  <button
                    onClick={(e) => handleAbort(e, mission.missionId)}
                    disabled={abortingMissionId === mission.missionId}
                    style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "3px", border: "1px solid var(--error)", background: "transparent", color: "var(--error)", cursor: abortingMissionId === mission.missionId ? "wait" : "pointer", opacity: abortingMissionId === mission.missionId ? 0.6 : 1 }}
                  >
                    {abortingMissionId === mission.missionId ? "Stopping…" : "Stop"}
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => handleDelete(e, mission.missionId)}
                    disabled={deletingMissionId === mission.missionId}
                    style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "3px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: deletingMissionId === mission.missionId ? "wait" : "pointer", opacity: deletingMissionId === mission.missionId ? 0.6 : 1 }}
                  >
                    {deletingMissionId === mission.missionId ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
              {escalationMissionId === mission.missionId && (
                <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--warning)" }}>Awaiting checkpoint decision</div>
              )}
            </div>
          );
        })}
      </div>
      {typeof totalCost === "number" && (
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
          Session cost: ${totalCost.toFixed(2)}
        </div>
      )}
    </aside>
  );
}
