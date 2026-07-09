import { useEffect, useRef, useState } from "react";
import { MissionPipeline } from "./MissionPipeline";
import { MissionComplete } from "./MissionComplete";
import { MissionCreationView } from "../active/MissionCreationView";
import { dimPassive, restorePassive } from "../animations/state-transitions";
import { isMissionTerminal, isOrchestrationWarningError, getMissionErrorLabel } from "./missionUiModel";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent, BumblebeeFinding, BumblebeeScanResult } from "@aurex/shared";
import type { MissionError, AgentLogEntry } from "../hooks/useMission";
import type { CodeSummaryResponse } from "../api";
import type { ReviewReport } from "@aurex/shared";
import type { UseGitHubReturn } from "../hooks/useGitHub";

interface StatusBoardProps {
  mission: Mission | null;
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  logs: Array<{ phase: string; message: string; timestamp: number }>;
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
  blurred: boolean;
  eventStreamCount?: number;
  autoCollapseContext?: boolean;
  onExampleClick?: (text: string, cloneUrl?: string) => Promise<void>;
  onRetryMission?: () => void;
  onAbortMission?: () => void;
  abortingMission?: boolean;
  onDismissErrors?: () => void;
  scanFindings?: BumblebeeFinding[];
  isScanning?: boolean;
  scans?: BumblebeeScanResult[];
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
  scanError?: string | null;
  onDismissScanError?: () => void;
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    report: ReviewReport | null;
    loading: boolean;
    error?: string | null;
  } | null;
  onRescanRepo?: () => void;
  onIssueStatusChange?: (issueId: string, status: import("@aurex/shared").IssueStatus) => void;
  onRepoPrepared?: (info: { repoName: string; fullName: string; summary: CodeSummaryResponse | null }) => void;
  github?: UseGitHubReturn;
  systemReady?: boolean;
  loading?: boolean;
  loadError?: string | null;
  logsRehydrateError?: string | null;
  onRetryMissionLoad?: () => void;
  missionsEnabled?: boolean;
}

export function StatusBoard({ mission, milestones, workers, cost, events, logs, errors, agentLogs, blurred, eventStreamCount, autoCollapseContext, onExampleClick, onRetryMission, onAbortMission, abortingMission = false, onDismissErrors, scanFindings = [], isScanning = false, scans = [], onTriggerScan, scanError, onDismissScanError, preparedRepo, onRescanRepo, onIssueStatusChange, onRepoPrepared, github, systemReady, loading, loadError, logsRehydrateError, onRetryMissionLoad, missionsEnabled = true }: StatusBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    if (blurred) {
      dimPassive(el);
    } else {
      restorePassive(el);
    }
  }, [blurred]);

  const nonRecoverableErrors = errors.filter((e) => !e.recoverable);
  const orchestrationWarnings = errors.filter((e) => e.recoverable && isOrchestrationWarningError(e.code));
  const [errorBannerExpanded, setErrorBannerExpanded] = useState(() => nonRecoverableErrors.length > 0);
  const lastErrorCountRef = useRef(nonRecoverableErrors.length);

  // Auto-expand the error banner whenever a *new* non-recoverable error arrives.
  // The useState initializer only runs once on mount, so without this a banner
  // that appears later in a live session would stay collapsed.
  useEffect(() => {
    if (nonRecoverableErrors.length > lastErrorCountRef.current) {
      setErrorBannerExpanded(true);
    }
    lastErrorCountRef.current = nonRecoverableErrors.length;
  }, [nonRecoverableErrors.length]);

  if (loading && !mission && missionsEnabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', letterSpacing: "2px", fontSize: "12px" }}>
        <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: "24px", marginBottom: "12px", color: "var(--accent)" }}>↻</span>
        LOADING MISSION...
      </div>
    );
  }

  if (!mission || !missionsEnabled) {
    if (loadError && missionsEnabled) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "24px", textAlign: "center" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--error)", letterSpacing: "2px", marginBottom: "12px" }}>
            FAILED TO LOAD MISSION
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "400px", marginBottom: "16px", lineHeight: 1.6 }}>
            {loadError}
          </div>
          {onRetryMissionLoad && (
            <button
              onClick={onRetryMissionLoad}
              style={{
                background: "var(--accent)",
                color: "var(--bg-deep)",
                border: "none",
                borderRadius: "4px",
                padding: "8px 20px",
                cursor: "pointer",
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "11px",
                letterSpacing: "1px",
              }}
            >
              Retry
            </button>
          )}
        </div>
      );
    }
    return (
      <MissionCreationView
        onSubmit={async (description, cloneUrl) => { if (onExampleClick) await onExampleClick(description, cloneUrl); }}
        github={github}
        preparedRepo={preparedRepo ? { repoName: preparedRepo.repoName, fullName: preparedRepo.fullName, summary: preparedRepo.summary, report: preparedRepo.report, loading: preparedRepo.loading, error: preparedRepo.error } : null}
        onRescanRepo={onRescanRepo}
        onIssueStatusChange={onIssueStatusChange}
        onRepoPrepared={onRepoPrepared}
        systemReady={systemReady}
      />
    );
  }

  const isTerminal = isMissionTerminal(mission.status);

  return (
    <div ref={boardRef} style={{ height: "100%", overflowY: "auto" }}>
      {logsRehydrateError && (
        <div style={{ margin: "12px 16px 0", padding: "8px 16px", background: "var(--bg-inset)", border: "1px solid var(--warning)", borderRadius: "6px", fontSize: "11px", color: "var(--warning)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{logsRehydrateError}</span>
        </div>
      )}
      {!isTerminal && orchestrationWarnings.length > 0 && (
        <OrchestrationWarningBanner
          errors={orchestrationWarnings}
          onDismiss={onDismissErrors}
        />
      )}
      {!isTerminal && nonRecoverableErrors.length > 0 && (
        <ErrorBanner
          errors={nonRecoverableErrors}
          expanded={errorBannerExpanded}
          onToggleExpand={() => setErrorBannerExpanded(!errorBannerExpanded)}
          onDismiss={onDismissErrors}
        />
      )}
      {isTerminal ? (
        <MissionComplete
          mission={mission}
          milestones={milestones}
          workers={workers}
          cost={cost}
          events={events}
          logs={logs}
          errors={errors}
          onRestart={onRetryMission}
          onCreateMission={onExampleClick}
        />
      ) : (
        <MissionPipeline
          mission={mission}
          milestones={milestones}
          workers={workers}
          cost={cost}
          events={events}
          logs={logs}
          errors={errors}
          agentLogs={agentLogs}
          eventStreamCount={eventStreamCount}
          autoCollapseContext={autoCollapseContext}
          onRetry={onRetryMission}
          onAbort={onAbortMission}
          aborting={abortingMission}
          scanFindings={scanFindings}
          isScanning={isScanning}
          scans={scans}
          onTriggerScan={onTriggerScan}
          scanError={scanError}
          onDismissScanError={onDismissScanError}
        />
      )}
    </div>
  );
}

function OrchestrationWarningBanner({ errors, onDismiss }: {
  errors: MissionError[];
  onDismiss?: () => void;
}) {
  const lastError = errors[errors.length - 1];
  if (!lastError) return null;

  return (
    <div style={{
      margin: "12px 16px 0",
      padding: "12px 16px",
      background: "var(--bg-inset)",
      border: "1px solid var(--warning)",
      borderRadius: "6px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--warning)", letterSpacing: "1px", textTransform: "uppercase" }}>
          {getMissionErrorLabel(lastError.code)}
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", flex: 1 }}>
          {lastError.message}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "9px",
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: "3px",
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            DISMISS
          </button>
        )}
      </div>
      {errors.length > 1 && (
        <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
          {errors.length - 1} additional orchestration warning{errors.length > 2 ? "s" : ""} logged in the activity feed.
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ errors, expanded, onToggleExpand, onDismiss }: {
  errors: MissionError[];
  expanded: boolean;
  onToggleExpand: () => void;
  onDismiss?: () => void;
}) {
  const lastError = errors[errors.length - 1];
  if (!lastError) return null;

  return (
    <div style={{
      margin: "12px 16px 0",
      padding: "12px 16px",
      background: "var(--bg-inset)",
      border: "1px solid var(--error)",
      borderRadius: "6px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--error)", letterSpacing: "1px", textTransform: "uppercase" }}>
          Error
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", flex: 1 }}>
          {lastError.message}
        </span>
        <button
          onClick={onToggleExpand}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            background: "transparent",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: "3px",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          {expanded ? "HIDE" : "DETAILS"}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "9px",
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: "3px",
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            DISMISS
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
          {errors.map((err, i) => (
            <div key={i} style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
              <span style={{ color: "var(--error)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>{err.code}</span>
              {" — "}{err.message}
              <span style={{ fontSize: "10px", marginLeft: "8px" }}>
                {new Date(err.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
