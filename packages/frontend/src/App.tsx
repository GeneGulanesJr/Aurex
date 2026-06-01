import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMissions } from "./hooks/useMissions";
import { useMission } from "./hooks/useMission";
import { useTheme } from "./hooks/useTheme";
import { useGitHub } from "./hooks/useGitHub";
import { usePinyxStatus } from "./hooks/usePinyxStatus";
import { MissionSidebar } from "./active/MissionSidebar";
import { StatusBoard } from "./passive/StatusBoard";
import { EscalationOverlay } from "./active/EscalationOverlay";
import { IntegrationsPanel } from "./active/IntegrationsPanel";
import { TopBar } from "./frame/TopBar";
import { TelemetryBar } from "./frame/TelemetryBar";
import { submitCheckpoint, createMission } from "./api";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

export function App() {
  const { theme, setTheme } = useTheme();
  const github = useGitHub();
  const pinyxStatus = usePinyxStatus();
  const systemReady = github.connected && pinyxStatus.configured;
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const { state: missionsState, selectMission, removeMission, addOptimisticMission, markMissionRestarted, handleWsEvent: missionsWsHandler } = useMissions();
  const { state, dispatch, handleWsEvent: missionWsHandler } = useMission(missionsState.selectedMissionId);
  const eventsRef = useRef<WsClientEvent[]>([]);

  const combinedHandler = useCallback((event: WsClientEvent) => {
    missionsWsHandler(event);
    missionWsHandler(event);
    eventsRef.current = [...eventsRef.current.slice(-49), event];
  }, [missionsWsHandler, missionWsHandler]);

  const { connected } = useWebSocket(combinedHandler, {
    missionId: missionsState.selectedMissionId,
    apiKey: import.meta.env.VITE_AUREX_API_KEY || undefined,
  });

  // Uptime timer
  const [uptime, setUptime] = useState("00:00:00");
  useEffect(() => {
    if (!connected) { setUptime("00:00:00"); return; }
    const start = Date.now();
    const fmt = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      return `${h}:${m}:${sec}`;
    };
    setUptime(fmt());
    const id = setInterval(() => setUptime(fmt()), 1000);
    return () => clearInterval(id);
  }, [connected]);

  const handleDecision = useCallback(async (decision: CheckpointDecision, guidance?: string, reason?: string) => {
    if (!state.mission) return;
    const escalation = state.escalation;
    if (escalation?.type !== "escalation" || !escalation.checkpointId) return;
    await submitCheckpoint(state.mission.id, escalation.checkpointId, decision, guidance, reason);
    dispatch({ type: "CLEAR_ESCALATION" });
  }, [state.mission, state.escalation, dispatch]);

  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
  }, [addOptimisticMission]);

  // Connecting overlay
  if (!connected) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-deep)",
        color: "var(--text-muted)",
        fontFamily: '"JetBrains Mono", monospace',
        letterSpacing: "4px",
        fontSize: "13px",
      }}>
        <div style={{
          fontSize: "48px",
          fontWeight: 700,
          letterSpacing: "12px",
          color: "var(--accent)",
          marginBottom: "16px",
        }}>AUREX</div>
        CONNECTING...
      </div>
    );
  }

  const activeMissionCount = missionsState.missions.filter(m =>
    ["queued", "planning", "executing", "waiting_checkpoint"].includes(m.state)
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar
        connected={connected}
        missionCount={activeMissionCount}
        uptime={uptime}
        theme={theme}
        onThemeChange={setTheme}
        githubUser={github.user}
        pinyxConfigured={pinyxStatus.configured}
        onOpenIntegrations={() => setIntegrationsOpen(true)}
      />
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gridTemplateRows: "1fr 36px", flex: 1, overflow: "hidden" }}>
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
          onRestart={markMissionRestarted}
          onCreateMission={handleCreateMission}
          github={github}
          systemReady={systemReady}
        />
        <main style={{ overflowY: "auto", background: "var(--bg-deep)" }}>
          <StatusBoard
            mission={state.mission}
            milestones={state.milestones}
            workers={state.activeWorkers}
            cost={state.cost}
            events={eventsRef.current}
            logs={state.logs}
            blurred={!!state.escalation}
            onExampleClick={handleCreateMission}
          />
        </main>
        <TelemetryBar
          tokens={state.cost?.totalTokens ?? 0}
          cost={state.cost?.totalCost ?? 0}
          agentCount={state.activeWorkers.length}
          wsConnected={connected}
        />
      </div>
      <IntegrationsPanel open={integrationsOpen} github={github} onClose={() => setIntegrationsOpen(false)} onPinyxConfigUpdate={() => void pinyxStatus.refresh()} />
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
