import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMissions } from "./hooks/useMissions";
import { useMission } from "./hooks/useMission";
import { useTheme } from "./hooks/useTheme";
import { useGitHub } from "./hooks/useGitHub";
import { usePinyxStatus } from "./hooks/usePinyxStatus";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { useNotifications } from "./hooks/useNotifications";
import { useTabBadge } from "./hooks/useTabBadge";
import { useSettings } from "./hooks/useSettings";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { MissionSidebar } from "./active/MissionSidebar";
import { StatusBoard } from "./passive/StatusBoard";
import { EscalationOverlay } from "./active/EscalationOverlay";
import { IntegrationsPanel } from "./active/IntegrationsPanel";
import { SettingsPanel } from "./active/SettingsPanel";
import { TopBar } from "./frame/TopBar";
import { TelemetryBar } from "./frame/TelemetryBar";
import { submitCheckpoint, createMission, restartMission } from "./api";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

export function App() {
  const { theme, setTheme } = useTheme();
  const github = useGitHub();
  const pinyxStatus = usePinyxStatus();
  const systemReady = github.connected && pinyxStatus.configured;
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings, resetSettings } = useSettings();
  const { state: missionsState, selectMission, removeMission, addOptimisticMission, markMissionRestarted, handleWsEvent: missionsWsHandler } = useMissions();
  const { state, dispatch, handleWsEvent: missionWsHandler } = useMission(missionsState.selectedMissionId);
  const eventsRef = useRef<WsClientEvent[]>([]);

  const bp = useBreakpoint();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false);

  useEffect(() => {
    if (bp.isMobile) {
      setSidebarCollapsed(false);
      setMobileOverlayOpen(false);
    } else if (bp.isTablet) {
      setSidebarCollapsed(true);
      setMobileOverlayOpen(false);
    } else {
      setMobileOverlayOpen(false);
    }
  }, [bp.breakpoint]);

  const toggleSidebar = useCallback(() => {
    if (bp.isMobile) {
      setMobileOverlayOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  }, [bp.isMobile]);

  const [latestNotifEvent, setLatestNotifEvent] = useState<WsClientEvent | null>(null);

  const combinedHandler = useCallback((event: WsClientEvent) => {
    missionsWsHandler(event);
    missionWsHandler(event);
    eventsRef.current = [...eventsRef.current.slice(-49), event];
    if (event.type === "escalation" || event.type === "mission_completed") {
      setLatestNotifEvent(event);
    }
  }, [missionsWsHandler, missionWsHandler]);

  const { connected } = useWebSocket(combinedHandler, {
    missionId: missionsState.selectedMissionId,
    apiKey: import.meta.env.VITE_AUREX_API_KEY || undefined,
  });

  // Browser notifications + tab badge
  useNotifications(latestNotifEvent, missionsState.selectedMissionId);
  const pendingEscalations = state.escalation?.type === "escalation" ? 1 : 0;
  const terminalMissions = missionsState.missions.filter(
    (m) => m.state === "completed" || m.state === "failed",
  ).length;
  useTabBadge(pendingEscalations, terminalMissions);

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

  const handleRetryMission = useCallback(async () => {
    if (!state.mission) return;
    try {
      const { missionId } = await restartMission(state.mission.id);
      dispatch({ type: "CLEAR_ERRORS" });
      selectMission(missionId);
    } catch {}
  }, [state.mission, dispatch, selectMission]);

  // Keyboard shortcuts
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts({
    onSelectMissionByIndex: (i) => {
      const mission = missionsState.missions[i];
      if (mission) selectMission(mission.missionId);
    },
    onApprove: () => {
      if (state.escalation?.type === "escalation" && state.escalation.checkpointId) {
        handleDecision("approve");
      }
    },
    onReject: () => {
      if (state.escalation?.type === "escalation" && state.escalation.checkpointId) {
        handleDecision("reject");
      }
    },
    onDismiss: () => {
      if (state.escalation?.type === "escalation") {
        dispatch({ type: "CLEAR_ESCALATION" });
      }
    },
    onNewMission: () => {
      // Focus the new mission input by dispatching a custom event
      window.dispatchEvent(new CustomEvent("aurex:focus-new-mission"));
    },
    onToggleSidebar: toggleSidebar,
  });

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

  const gridColumns = bp.isMobile
    ? "1fr"
    : sidebarCollapsed
      ? "48px 1fr"
      : "280px 1fr";

  const showMobileOverlay = bp.isMobile && mobileOverlayOpen;

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
        sidebarCollapsed={bp.isMobile ? !mobileOverlayOpen : sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ display: "grid", gridTemplateColumns: gridColumns, gridTemplateRows: "1fr 36px", flex: 1, overflow: "hidden", position: "relative" }}>
        {!bp.isMobile && (
          <MissionSidebar
            missions={missionsState.missions}
            selectedMissionId={missionsState.selectedMissionId}
            escalationMissionId={state.escalation?.type === "escalation" ? missionsState.selectedMissionId : null}
            onSelect={selectMission}
            onRemove={removeMission}
            onRestart={markMissionRestarted}
            onCreateMission={handleCreateMission}
            github={github}
            systemReady={systemReady}
            totalCost={state.cost?.totalCost}
            collapsed={sidebarCollapsed}
          />
        )}
        <main style={{ overflowY: "auto", background: "var(--bg-deep)" }}>
          <StatusBoard
            mission={state.mission}
            milestones={state.milestones}
            workers={state.activeWorkers}
            cost={state.cost}
            events={eventsRef.current}
            logs={state.logs}
            errors={state.errors}
            agentLogs={state.agentLogs}
            blurred={!!state.escalation}
            onExampleClick={handleCreateMission}
            onRetryMission={handleRetryMission}
            onDismissErrors={() => dispatch({ type: "CLEAR_ERRORS" })}
          />
        </main>
        <div style={{ gridColumn: "1 / -1" }}>
          <TelemetryBar
            tokens={state.cost?.totalTokens ?? 0}
            cost={state.cost?.totalCost ?? 0}
            agentCount={state.activeWorkers.length}
            wsConnected={connected}
          />
        </div>
      </div>
      {showMobileOverlay && (
        <>
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileOverlayOpen(false)}
          />
          <div className="sidebar-mobile-overlay">
            <MissionSidebar
              missions={missionsState.missions}
              selectedMissionId={missionsState.selectedMissionId}
              escalationMissionId={state.escalation?.type === "escalation" ? missionsState.selectedMissionId : null}
              onSelect={(id) => { selectMission(id); setMobileOverlayOpen(false); }}
              onRemove={removeMission}
              onRestart={markMissionRestarted}
              onCreateMission={handleCreateMission}
              github={github}
              systemReady={systemReady}
              totalCost={state.cost?.totalCost}
              collapsed={false}
            />
          </div>
        </>
      )}
      <IntegrationsPanel open={integrationsOpen} github={github} onClose={() => setIntegrationsOpen(false)} onPinyxConfigUpdate={() => void pinyxStatus.refresh()} />
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
      />
      {state.escalation?.type === "escalation" && (
        <EscalationOverlay
          event={state.escalation}
          onDecision={handleDecision}
          onDismiss={() => dispatch({ type: "CLEAR_ESCALATION" })}
        />
      )}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: "1 - 9", desc: "Select mission by position" },
    { keys: "Enter", desc: "Approve checkpoint" },
    { keys: "Esc", desc: "Dismiss overlay / close help" },
    { keys: "R", desc: "Reject checkpoint" },
    { keys: "N", desc: "New mission" },
    { keys: "[ / ]", desc: "Toggle sidebar" },
    { keys: "?", desc: "Toggle this help" },
  ];
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
    >
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "24px 32px", minWidth: "320px", maxWidth: "420px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "16px" }}>
          Keyboard Shortcuts
        </div>
        {shortcuts.map((s) => (
          <div key={s.keys} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{s.desc}</span>
            <kbd style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--accent)", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "3px", padding: "2px 8px", letterSpacing: "1px" }}>{s.keys}</kbd>
          </div>
        ))}
        <button
          onClick={onClose}
          style={{ marginTop: "16px", color: "var(--text-muted)", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
