import { useCallback } from "react";
import type { MissionListItem } from "../hooks/useMissions";
import { abortMission } from "../api";
import { NewMissionForm } from "./NewMissionForm";

interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onRemove: (missionId: string) => void;
  onCreateMission: (description: string) => Promise<void>;
}

function statusBadge(state: string): { label: string; style: React.CSSProperties } {
  switch (state) {
    case "queued":
      return { label: "Queued", style: { background: "var(--warning)", color: "var(--bg-deep)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "planning":
    case "executing":
      return { label: "Running", style: { background: "var(--info)", color: "var(--bg-deep)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "waiting_checkpoint":
      return { label: "Checkpoint", style: { background: "rgba(129, 140, 248, 0.2)", color: "var(--info)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "completed":
      return { label: "Done", style: { background: "rgba(74, 222, 128, 0.2)", color: "var(--success)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "failed":
      return { label: "Failed", style: { background: "rgba(239, 68, 68, 0.2)", color: "var(--error)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    default:
      return { label: state, style: { background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
  }
}

export function MissionSidebar({ missions, selectedMissionId, onSelect, onRemove, onCreateMission }: MissionSidebarProps) {
  const handleAbort = useCallback(async (e: React.MouseEvent, missionId: string) => {
    e.stopPropagation();
    try {
      await abortMission(missionId);
      onRemove(missionId);
    } catch {}
  }, [onRemove]);

  if (missions.length === 0) {
    return (
      <aside style={{ width: "280px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "2px", margin: 0 }}>Missions</h2>
        </div>
        <NewMissionForm onSubmit={onCreateMission} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <div style={{ width: "32px", height: "32px", border: "1px dashed var(--border)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--border-bright)", fontSize: "16px" }}>◎</div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>NO ACTIVE MISSIONS</span>
          <span style={{ fontSize: "10px", color: "var(--border-bright)" }}>Create a mission to begin</span>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)" }}>
          <span>TOTAL SPENT</span>
          <span style={{ color: "var(--accent)", fontWeight: 500 }}>$0.00</span>
        </div>
      </aside>
    );
  }

  return (
    <aside style={{ width: "280px", borderRight: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "2px", margin: 0 }}>Missions</h2>
      </div>
      <NewMissionForm onSubmit={onCreateMission} />
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
                  <span style={badge.style}>{badge.label}</span>
                  {mission.queuePosition != null && (
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>#{mission.queuePosition}</span>
                  )}
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-primary)", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {mission.description ?? mission.missionId}
                </div>
              </div>
              {(mission.state === "queued" || mission.state === "planning" || mission.state === "executing" || mission.state === "waiting_checkpoint") && (
                <button
                  onClick={(e) => handleAbort(e, mission.missionId)}
                  style={{ marginLeft: "8px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "12px", opacity: 0, transition: "opacity 0.15s", padding: "4px" }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "var(--error)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  title="Abort mission"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
