import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMissions } from "./hooks/useMissions";
import { useMission } from "./hooks/useMission";
import { useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import { useGitHub } from "./hooks/useGitHub";
import { usePinyxStatus } from "./hooks/usePinyxStatus";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { useNotifications } from "./hooks/useNotifications";
import { useTabBadge } from "./hooks/useTabBadge";
import { useSettings } from "./hooks/useSettings";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSupplyChain } from "./hooks/useSupplyChain";
import { useQuota } from "./hooks/useQuota";
import { useUpdateStatus } from "./hooks/useUpdateStatus";
import { countActiveMissions, countTerminalMissions } from "./passive/missionUiModel";
import { MissionSidebar } from "./active/MissionSidebar";
import { StatusBoard } from "./passive/StatusBoard";
import { EscalationOverlay } from "./active/EscalationOverlay";
import { IntegrationsPanel } from "./active/IntegrationsPanel";
import { LoginScreen } from "./frame/LoginScreen";
import { getSessionState, clearSessionState } from "./lib/sessionState";
import { SettingsPanel } from "./active/SettingsPanel";
import { QuotaPanel } from "./active/QuotaPanel";
import { TopBar } from "./frame/TopBar";
import { TelemetryBar } from "./frame/TelemetryBar";
import { setTokenGetter, setAuthErrorHandler } from "./api";
import { submitCheckpoint, createMission, restartMission, abortMission, getRepoHotspots, getRepoSuggestions, getRepoReadiness, listRepoScans } from "./api";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion, RepoReadinessProfile } from "./api";
import type { BumblebeeScanResult, BumblebeeFinding } from "@aurex/shared";

export function App() {
  const { theme, setTheme } = useTheme();
  const { isAuthenticated, isLoading: authLoading, getToken, logout } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      setTokenGetter(getToken);
      setAuthErrorHandler(() => {
        logout();
      });
    }
  }, [isAuthenticated, getToken, logout]);

  const github = useGitHub();
  const pinyxStatus = usePinyxStatus();
  const systemReady = github.connected && pinyxStatus.configured;
  const [integrationsOpen, setIntegrationsOpen] = useState(() => {
    const ret = getSessionState<{ open: boolean; pinyxTab: string }>("integrations_return");
    return ret?.open ?? false;
  });
  const [restoredPinyxTab, setRestoredPinyxTab] = useState<string | null>(() => {
    const ret = getSessionState<{ open: boolean; pinyxTab: string }>("integrations_return");
    clearSessionState("integrations_return");
    return ret?.open ? (ret.pinyxTab ?? null) : null;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [preparedRepo, setPreparedRepo] = useState<{
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    hotspots: CodeHotspotsResponse | null;
    suggestions: RepoSuggestion[];
    readiness: RepoReadinessProfile | null;
    packageScan: BumblebeeScanResult | null;
    packageFindings: BumblebeeFinding[];
    loading: boolean;
  } | null>(null);
  const { settings, setSettings, resetSettings } = useSettings();
  const { state: missionsState, selectMission, addOptimisticMission, markMissionRestarted, markMissionAborted, handleWsEvent: missionsWsHandler } = useMissions();
  const { state, dispatch, handleWsEvent: missionWsHandler, reloadMission } = useMission(missionsState.selectedMissionId);
  const { state: supplyChainState, triggerScan: triggerSupplyChainScan, handleWsEvent: supplyChainWsHandler } = useSupplyChain(missionsState.selectedMissionId);
  const quotaWsHandlerRef = useRef<((event: WsClientEvent) => void) | null>(null);
  const quota = useQuota({
    onWsEvent: useCallback((handler: (event: WsClientEvent) => void) => {
      quotaWsHandlerRef.current = handler;
    }, []),
  });
  const quotaStatus = quota.status;
  const eventsRef = useRef<WsClientEvent[]>([]);

  const bp = useBreakpoint();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    settings.defaultSidebarCollapsed,
  );
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

  const [abortingMissionId, setAbortingMissionId] = useState<string | null>(null);
  const [latestNotifEvent, setLatestNotifEvent] = useState<WsClientEvent | null>(null);

  const updateWsHandlerRef = useRef<((event: WsClientEvent) => void) | null>(null);

  const combinedHandler = useCallback((event: WsClientEvent) => {
    missionsWsHandler(event);
    missionWsHandler(event);
    supplyChainWsHandler(event);
    eventsRef.current = [...eventsRef.current.slice(-49), event];
    if (event.type === "escalation" || event.type === "mission_completed") {
      setLatestNotifEvent(event);
    }
    if (updateWsHandlerRef.current) updateWsHandlerRef.current(event);
    if (quotaWsHandlerRef.current) quotaWsHandlerRef.current(event);
  }, [missionsWsHandler, missionWsHandler, supplyChainWsHandler]);

  const updateStatus = useUpdateStatus({
    onWsEvent: useCallback((handler: (event: WsClientEvent) => void) => {
      updateWsHandlerRef.current = handler;
    }, []),
  });

  const { connected, send } = useWebSocket(combinedHandler, {
    missionId: missionsState.selectedMissionId,
    getToken,
    enabled: isAuthenticated,
  });

  // Browser notifications + tab badge
  useNotifications(latestNotifEvent, missionsState.selectedMissionId, settings.notificationsEnabled);
  const pendingEscalations = state.escalation?.type === "escalation" ? 1 : 0;
  const terminalMissions = countTerminalMissions(missionsState.missions.map((m) => m.state));
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

  const handleDecision = useCallback(async (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => {
    if (!state.mission) return;
    const escalation = state.escalation;
    if (escalation?.type !== "escalation" || !escalation.checkpointId) return;
    // Prefer the WebSocket `checkpoint_decision` message when connected — the
    // server resolves it through the same dedup tracker as the REST route and
    // replies with a `checkpoint_resolved` ack. Fall back to REST when the
    // socket is down so a decision never silently drops.
    if (connected) {
      send({
        event: "checkpoint_decision",
        missionId: state.mission.id,
        checkpointId: escalation.checkpointId,
        decision,
        guidance: opts?.guidance,
        reason: opts?.reason,
        rescopeGuidance: opts?.rescopeGuidance,
      });
    } else {
      await submitCheckpoint(state.mission.id, escalation.checkpointId, decision, opts);
    }
    dispatch({ type: "CLEAR_ESCALATION" });
  }, [state.mission, state.escalation, dispatch, connected, send]);

  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
    setPreparedRepo(null); // Clear overview when mission starts
  }, [addOptimisticMission]);

  const handleRepoPrepared = useCallback(async (info: { repoName: string; fullName: string; summary: CodeSummaryResponse | null }) => {
    const { repoName, fullName, summary } = info;
    const version = Date.now();
    setPreparedRepo({ repoName, fullName, summary, hotspots: null, suggestions: [], readiness: null, packageScan: null, packageFindings: [], loading: true, _version: version } as any);
    try {
      const [hotspots, readiness, scanList] = await Promise.all([
        getRepoHotspots(repoName).catch(() => null),
        getRepoReadiness(repoName).catch(() => null),
        listRepoScans(repoName).catch(() => ({ scans: [] })),
      ]);
      const latestScan = scanList.scans.at(-1);
      const suggestionsRes = await getRepoSuggestions(repoName).catch(() => ({ suggestions: [], analysisVersion: "2.0" }));
      setPreparedRepo((prev) => {
        // Don't overwrite if cleared (e.g., mission created while loading)
        if (!prev || (prev as any)._version !== version) return prev;
        return {
          repoName,
          fullName,
          summary,
          hotspots,
          suggestions: suggestionsRes.suggestions,
          readiness,
          packageScan: latestScan ?? null,
          packageFindings: latestScan?.findings ?? [],
          loading: false,
        };
      });
    } catch {
      setPreparedRepo((prev) => prev ? { ...prev, loading: false } : null);
    }
  }, []);

  const handleRestartMission = useCallback(async (missionId: string) => {
    try {
      const { missionId: restartedId } = await restartMission(missionId);
      markMissionRestarted(restartedId);
      selectMission(restartedId);
      dispatch({ type: "CLEAR_ERRORS" });
      dispatch({ type: "CLEAR_ESCALATION" });
      reloadMission();
    } catch {
      // Leave mission state unchanged when restart fails.
    }
  }, [markMissionRestarted, selectMission, dispatch, reloadMission]);

  const handleRetryMission = useCallback(async () => {
    if (!state.mission) return;
    await handleRestartMission(state.mission.id);
  }, [state.mission, handleRestartMission]);

  const handleAbortMission = useCallback(async (missionId?: string) => {
    const targetId = missionId ?? state.mission?.id;
    if (!targetId) return;
    setAbortingMissionId(targetId);
    try {
      await abortMission(targetId);
      markMissionAborted(targetId);
      if (state.mission?.id === targetId) {
        dispatch({ type: "MISSION_STATUS", status: "aborted" });
        dispatch({ type: "CLEAR_ESCALATION" });
      }
    } catch {
      // Leave mission state unchanged when abort fails (e.g. already finished).
    } finally {
      setAbortingMissionId((current) => (current === targetId ? null : current));
    }
  }, [state.mission?.id, dispatch, markMissionAborted]);

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
      selectMission(null);
    },
    onToggleSidebar: toggleSidebar,
  });

  // Auth gate
  if (!isAuthenticated && !authLoading) {
    return <LoginScreen />;
  }

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

  const activeMissionCount = countActiveMissions(missionsState.missions.map((m) => m.state));

  const gridColumns = bp.isMobile
    ? "1fr"
    : sidebarCollapsed
      ? "48px 1fr"
      : "280px 1fr";

  const showMobileOverlay = bp.isMobile && mobileOverlayOpen;

  return (
    <div className="app-shell">
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
        onOpenQuota={() => setQuotaOpen(true)}
        quotaStatus={quotaStatus?.providers?.find(p => p.tracked)?.status ?? null}
        updateStatus={updateStatus}
      />
      <div className="app-workspace" style={{ gridTemplateColumns: gridColumns }}>
        {!bp.isMobile && (
          <MissionSidebar
            missions={missionsState.missions}
            selectedMissionId={missionsState.selectedMissionId}
            escalationMissionId={state.escalation?.type === "escalation" ? missionsState.selectedMissionId : null}
            onSelect={selectMission}
            onAbort={handleAbortMission}
            onRestart={handleRestartMission}
            abortingMissionId={abortingMissionId}
            systemReady={systemReady}
            totalCost={state.cost?.totalCost}
            collapsed={sidebarCollapsed}
          />
        )}
        <main className="app-main">
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
            eventStreamCount={settings.eventStreamCount}
            autoCollapseContext={settings.autoCollapseContext}
            onExampleClick={handleCreateMission}
            onRetryMission={handleRetryMission}
            onAbortMission={() => { void handleAbortMission(); }}
            abortingMission={abortingMissionId === state.mission?.id}
            onDismissErrors={() => dispatch({ type: "CLEAR_ERRORS" })}
            scanFindings={supplyChainState.findings}
            isScanning={supplyChainState.isScanning}
            scans={supplyChainState.scans}
            onTriggerScan={triggerSupplyChainScan}
            preparedRepo={preparedRepo}
            onStartFromSuggestion={(prefill: string) => {
              window.dispatchEvent(new CustomEvent("aurex:focus-new-mission", { detail: prefill }));
            }}
            onRepoPrepared={handleRepoPrepared}
            github={github}
            systemReady={systemReady}
          />
        </main>
        <div className="app-telemetry-row">
          <TelemetryBar
            tokens={state.cost?.totalTokens ?? 0}
            cost={state.cost?.totalCost ?? 0}
            agentCount={state.activeWorkers.length}
            wsConnected={connected}
            scanFindings={supplyChainState.findings.length}
            isScanning={supplyChainState.isScanning}
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
              onSelect={(id) => { selectMission(id); if (id !== null) setMobileOverlayOpen(false); }}
              onAbort={handleAbortMission}
              onRestart={handleRestartMission}
              abortingMissionId={abortingMissionId}
              systemReady={systemReady}
              totalCost={state.cost?.totalCost}
              collapsed={false}
            />
          </div>
        </>
      )}
      <IntegrationsPanel open={integrationsOpen} github={github} onClose={() => setIntegrationsOpen(false)} onPinyxConfigUpdate={() => void pinyxStatus.refresh()} initialPinyxTab={restoredPinyxTab ?? undefined} />
      <QuotaPanel open={quotaOpen} onClose={() => setQuotaOpen(false)} quota={quota} />
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
