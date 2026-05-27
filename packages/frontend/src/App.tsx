import { useCallback, useRef } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMissions } from "./hooks/useMissions";
import { useMission } from "./hooks/useMission";
import { MissionSidebar } from "./active/MissionSidebar";
import { StatusBoard } from "./passive/StatusBoard";
import { EscalationOverlay } from "./active/EscalationOverlay";
import { submitCheckpoint } from "./api";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

export function App() {
  const { state: missionsState, selectMission, removeMission, handleWsEvent: missionsWsHandler } = useMissions();
  const { state, dispatch, handleWsEvent: missionWsHandler } = useMission(missionsState.selectedMissionId);
  const eventsRef = useRef<WsClientEvent[]>([]);

  const combinedHandler = useCallback((event: WsClientEvent) => {
    missionsWsHandler(event);
    missionWsHandler(event);
    eventsRef.current = [...eventsRef.current.slice(-49), event];
  }, [missionsWsHandler, missionWsHandler]);

  const { connected } = useWebSocket(combinedHandler);

  const handleDecision = useCallback(async (decision: CheckpointDecision, guidance?: string, reason?: string) => {
    if (!state.mission) return;
    const checkpointId = crypto.randomUUID();
    await submitCheckpoint(state.mission.id, checkpointId, decision, guidance, reason);
    dispatch({ type: "CLEAR_ESCALATION" });
  }, [state.mission, dispatch]);

  if (!connected) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Connecting...</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold">Aurex</h1>
        <span className="text-sm text-gray-400">
          {state.mission ? state.mission.description : "No active mission"}
        </span>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
        />
        <main className="flex-1 overflow-y-auto">
          <StatusBoard
            mission={state.mission}
            milestones={state.milestones}
            workers={state.activeWorkers}
            cost={state.cost}
            events={eventsRef.current}
            blurred={!!state.escalation}
          />
        </main>
      </div>
      {state.escalation?.type === "escalation" && (
        <EscalationOverlay
          event={state.escalation}
          onDecision={handleDecision}
          onDismiss={() => dispatch({ type: "CLEAR_ESCALATION" })}
        />
      )}
    </div>
  );
}
