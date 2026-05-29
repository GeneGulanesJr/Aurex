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

function statusBadge(state: string): { label: string; className: string } {
  switch (state) {
    case "queued":
      return { label: "Queued", className: "bg-yellow-900 text-yellow-300" };
    case "planning":
    case "executing":
      return { label: "Running", className: "bg-blue-900 text-blue-300" };
    case "waiting_checkpoint":
      return { label: "Checkpoint", className: "bg-purple-900 text-purple-300" };
    case "completed":
      return { label: "Done", className: "bg-green-900 text-green-300" };
    case "failed":
      return { label: "Failed", className: "bg-red-900 text-red-300" };
    default:
      return { label: state, className: "bg-gray-800 text-gray-400" };
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
      <aside className="w-64 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Missions</h2>
        </div>
        <NewMissionForm onSubmit={onCreateMission} />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          No missions
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Missions</h2>
      </div>
      <NewMissionForm onSubmit={onCreateMission} />
      <div className="flex-1 overflow-y-auto">
        {missions.map((mission) => {
          const badge = statusBadge(mission.state);
          const isSelected = mission.missionId === selectedMissionId;
          return (
            <div
              key={mission.missionId}
              onClick={() => onSelect(mission.missionId)}
              className={`px-4 py-3 cursor-pointer border-b border-gray-800/50 flex items-center justify-between group ${
                isSelected ? "bg-gray-800" : "hover:bg-gray-800/50"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${badge.className}`}>{badge.label}</span>
                  {mission.queuePosition != null && (
                    <span className="text-xs text-gray-500">#{mission.queuePosition}</span>
                  )}
                </div>
                <div className="text-sm text-gray-300 truncate mt-1">
                  {mission.description ?? mission.missionId}
                </div>
              </div>
              {(mission.state === "queued" || mission.state === "planning" || mission.state === "executing" || mission.state === "waiting_checkpoint") && (
                <button
                  onClick={(e) => handleAbort(e, mission.missionId)}
                  className="ml-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  title="Abort mission"
                >
                  &#x2715;
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
