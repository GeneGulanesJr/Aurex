import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket, type WsControlMessage } from "./hooks/useWebSocket";
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
import { getSessionState, clearSessionState, setSessionState } from "./lib/sessionState";
import { SettingsPanel } from "./active/SettingsPanel";
import { QuotaPanel } from "./active/QuotaPanel";
import { TopBar } from "./frame/TopBar";
import { TelemetryBar } from "./frame/TelemetryBar";
import { setTokenGetter, setAuthErrorHandler } from "./api";
import { submitCheckpoint, createMission, restartMission, abortMission, runRepoReview, getRepoReview, updateIssueStatus } from "./api";
import type { WsClientEvent, CheckpointDecision, ReviewReport } from "@aurex/shared";
import type { CodeSummaryResponse } from "./api";

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
    report: ReviewReport | null;
    loading: boolean;
    error: string | null;
    _version?: number;
  } | null>(null);
  const { settings, setSettings, resetSettings } = useSettings();
  const { state: missionsState, selectMission, addOptimisticMission, markMissionRestarted, markMissionAborted, handleWsEvent: missionsWsHandler } = useMissions();
  const { state, dispatch, handleWsEvent: missionWsHandler, reloadMission } = useMission(missionsState.selectedMissionId);
  const { state: supplyChainState, triggerScan: triggerSupplyChainScan, clearError: clearSupplyChainError, handleWsEvent: supplyChainWsHandler } = useSupplyChain(missionsState.selectedMissionId);
  const quotaWsHandlerRef = useRef<((event: WsClientEvent) => void) | null>(null);
  const quota = useQuota({
    onWsEvent: useCallback((handler: (event: WsClientEvent) => void) => {
      quotaWsHandlerRef.current = handler;
    }, []),
  });
  const quotaStatus = quota.status;
  // Event stream is kept in state (not a ref) so the activity feed, completion
  // view, and debug log re-render on every WS event — not only when another
  // handler happens to dispatch state. A ref would silently go stale for event
  // types that no reducer consumes.
  const [events, setEvents] = useState<WsClientEvent[]>([]);

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
  const restFallbackRef = useRef<((checkpointId: string, decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => Promise<void>) | null>(null);

  const combinedHandler = useCallback((event: WsClientEvent) => {
    missionsWsHandler(event);
    missionWsHandler(event);
    supplyChainWsHandler(event);
    setEvents((prev) => [...prev.slice(-49), event]);
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
    onAuthError: useCallback(() => {
      logout();
    }, [logout]),
    onControl: useCallback((msg: WsControlMessage) => {
      if (msg.type === "checkpoint_resolved") {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId: msg.checkpointId,
          accepted: msg.accepted,
          error: msg.error,
        });
      }
    }, [dispatch]),
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

  const CHECKPOINT_ACK_TIMEOUT_MS = 8_000;

  const handleDecision = useCallback(async (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => {
    if (!state.mission) return;
    const escalation = state.escalation;
    if (escalation?.type !== "escalation" || !escalation.checkpointId) return;
    // Idempotency guard: don't double-submit while one is already in flight.
    if (state.pendingCheckpoint) return;

    const checkpointId = escalation.checkpointId;
    const missionId = state.mission.id;

    // Mark submitting — keeps the overlay visible with a "Submitting…" state.
    dispatch({ type: "CHECKPOINT_SUBMITTING", decision });

    if (connected) {
      // Send over WS. The onControl handler (wired below) will reconcile the
      // state on `checkpoint_resolved`. We also arm a timeout: if no ack
      // arrives within the window, fall back to REST so a dropped decision
      // never silently stalls the mission.
      send({
        event: "checkpoint_decision",
        missionId,
        checkpointId,
        decision,
        guidance: opts?.guidance,
        reason: opts?.reason,
        rescopeGuidance: opts?.rescopeGuidance,
      });
      setTimeout(() => {
        // If still pending after the timeout, the ack didn't arrive — try REST.
        restFallbackRef.current?.(checkpointId, decision, opts);
      }, CHECKPOINT_ACK_TIMEOUT_MS);
    } else {
      // Socket down: go straight to REST (which now throws properly — T1).
      try {
        await submitCheckpoint(missionId, checkpointId, decision, opts);
        dispatch({ type: "CHECKPOINT_ACKED", checkpointId, accepted: true });
      } catch (err) {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId,
          accepted: false,
          error: err instanceof Error ? err.message : "Failed to submit checkpoint",
        });
      }
    }
  }, [state.mission, state.escalation, state.pendingCheckpoint, dispatch, connected, send]);

  // Keep the rest-fallback ref populated with a closure that reads the latest
  // mission ID. The ref pattern lets the setTimeout arm in handleDecision
  // access the freshest state without re-creating the timeout on every render.
  useEffect(() => {
    restFallbackRef.current = async (checkpointId, decision, opts) => {
      if (!state.mission) return;
      // The reducer's ack matching is idempotent on checkpointId — if the WS
      // ack landed in the meantime, this dispatch is a no-op.
      try {
        await submitCheckpoint(state.mission.id, checkpointId, decision, opts);
        dispatch({ type: "CHECKPOINT_ACKED", checkpointId, accepted: true });
      } catch (err) {
        dispatch({
          type: "CHECKPOINT_ACKED",
          checkpointId,
          accepted: false,
          error: err instanceof Error ? err.message : "Failed to submit checkpoint",
        });
      }
    };
  }, [state.mission, dispatch]);

  const handleCreateMission = useCallback(async (description: string, cloneUrl?: string) => {
    const { missionId } = await createMission(description, cloneUrl);
    addOptimisticMission(missionId, description);
    setPreparedRepo(null); // Clear overview when mission starts
    clearSessionState("prepared_repo"); // mission started — don't restore overview
  }, [addOptimisticMission]);

  const handleRepoPrepared = useCallback(async (
    info: { repoName: string; fullName: string; summary: CodeSummaryResponse | null; freshIndex?: boolean },
    opts?: { forceRescan?: boolean },
  ) => {
    const { repoName, fullName, summary } = info;
    setSessionState("prepared_repo", { repoName, fullName });
    const version = Date.now();
    setPreparedRepo({ repoName, fullName, summary, report: null, loading: true, error: null, _version: version });
    try {
      let report: ReviewReport;
      const shouldRunFreshReview = opts?.forceRescan || info.freshIndex;
      if (!shouldRunFreshReview) {
        try {
          ({ report } = await getRepoReview(repoName));
        } catch {
          ({ report } = await runRepoReview(repoName));
        }
      } else {
        ({ report } = await runRepoReview(repoName));
      }
      const warning = report.errors?.length
        ? report.errors.join("; ")
        : report.status === "partial"
          ? "Review completed with partial data."
          : null;
      setPreparedRepo((prev) => {
        if (!prev || prev._version !== version) return prev;
        return { repoName, fullName, summary, report, loading: false, error: warning };
      });
    } catch (err) {
      setPreparedRepo((prev) => {
        if (!prev || prev._version !== version) return prev;
        return {
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Repository scan failed.",
        };
      });
    }
  }, []);

  const handleRescanRepo = useCallback(async () => {
    if (!preparedRepo) return;
    await handleRepoPrepared(
      {
        repoName: preparedRepo.repoName,
        fullName: preparedRepo.fullName,
        summary: preparedRepo.summary,
      },
      { forceRescan: true },
    );
  }, [preparedRepo, handleRepoPrepared]);

  const handleIssueStatusChange = useCallback(async (issueId: string, status: import("@aurex/shared").IssueStatus) => {
    let reviewId: string | null = null;
    let repoName: string | null = null;
    let priorStatus: import("@aurex/shared").IssueStatus | undefined;
    setPreparedRepo((prev) => {
      if (!prev?.report) return prev;
      reviewId = prev.report.id;
      repoName = prev.repoName;
      priorStatus = prev.report.issues.find((i) => i.id === issueId)?.status ?? "open";
      return {
        ...prev,
        report: {
          ...prev.report,
          issues: prev.report.issues.map((i) => (i.id === issueId ? { ...i, status } : i)),
        },
      };
    });
    if (!reviewId || !repoName) return;
    try {
      const { report } = await updateIssueStatus(repoName, reviewId, issueId, status);
      setPreparedRepo((prev) => (prev ? { ...prev, report } : null));
    } catch {
      setPreparedRepo((prev) => {
        if (!prev?.report) return prev;
        return {
          ...prev,
          report: {
            ...prev.report,
            issues: prev.report.issues.map((i) =>
              i.id === issueId ? { ...i, status: priorStatus ?? "open" } : i,
            ),
          },
          error: prev.error ?? "Could not save issue status. Try again.",
        };
      });
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
    // No onDismiss: Esc must not silently clear a pending checkpoint.
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
        systemReady={systemReady}
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
            events={events}
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
            scanError={supplyChainState.error}
            onDismissScanError={clearSupplyChainError}
            preparedRepo={preparedRepo}
            onRescanRepo={() => { void handleRescanRepo(); }}
            onIssueStatusChange={(issueId, status) => { void handleIssueStatusChange(issueId, status); }}
            onRepoPrepared={handleRepoPrepared}
            github={github}
            systemReady={systemReady}
            loading={state.loading}
            loadError={state.loadError}
            logsRehydrateError={state.logsRehydrateError}
            onRetryMissionLoad={reloadMission}
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
          submitting={!!state.pendingCheckpoint}
          submitError={state.pendingCheckpointError}
          onDismissSubmitError={() => dispatch({ type: "CLEAR_PENDING_CHECKPOINT_ERROR" })}
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
