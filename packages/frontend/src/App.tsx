import { useCallback, useRef } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMission } from "./hooks/useMission";
import { StatusBoard } from "./passive/StatusBoard";
import { EscalationOverlay } from "./active/EscalationOverlay";
import { submitCheckpoint } from "./api";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

export function App() {
  const { state, dispatch, handleWsEvent } = useMission();
  const eventsRef = useRef<WsClientEvent[]>([]);

  // Track events for the feed
  const trackedHandle = useCallback((event: WsClientEvent) => {
    eventsRef.current = [...eventsRef.current.slice(-49), event];
    handleWsEvent(event);
  }, [handleWsEvent]);

  const { connected } = useWebSocket(trackedHandle);

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
      <main className="flex-1">
        <StatusBoard
          mission={state.mission}
          milestones={state.milestones}
          workers={state.activeWorkers}
          cost={state.cost}
          events={eventsRef.current}
          blurred={!!state.escalation}
        />
      </main>
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
