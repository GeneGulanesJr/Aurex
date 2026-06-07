import { useEffect, useRef, useState } from "react";
import { MissionPipeline } from "./MissionPipeline";
import { MissionComplete } from "./MissionComplete";
import { EmptyState } from "../frame/EmptyState";
import { RepoOverviewPanel } from "./RepoOverviewPanel";
import { dimPassive, restorePassive } from "../animations/state-transitions";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent, BumblebeeFinding, BumblebeeScanResult } from "@aurex/shared";
import type { MissionError, AgentLogEntry } from "../hooks/useMission";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion } from "../api";

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
  onExampleClick?: (text: string) => void;
  onRetryMission?: () => void;
  onDismissErrors?: () => void;
  scanFindings?: BumblebeeFinding[];
  isScanning?: boolean;
  scans?: BumblebeeScanResult[];
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    hotspots: CodeHotspotsResponse | null;
    suggestions: RepoSuggestion[];
    loading: boolean;
  } | null;
  onStartFromSuggestion?: (prefill: string) => void;
}

export function StatusBoard({ mission, milestones, workers, cost, events, logs, errors, agentLogs, blurred, eventStreamCount, onExampleClick, onRetryMission, onDismissErrors, scanFindings = [], isScanning = false, scans = [], onTriggerScan, preparedRepo, onStartFromSuggestion }: StatusBoardProps) {
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
  const [errorBannerExpanded, setErrorBannerExpanded] = useState(false);

  if (!mission) {
    if (preparedRepo) {
      return (
        <div style={{ display: "flex", height: "100%" }}>
          <RepoOverviewPanel
            repoName={preparedRepo.repoName}
            fullName={preparedRepo.fullName}
            summary={preparedRepo.summary}
            hotspots={preparedRepo.hotspots}
            suggestions={preparedRepo.suggestions}
            loading={preparedRepo.loading}
            onStartMission={onStartFromSuggestion ?? (() => {})}
          />
        </div>
      );
    }
    return (
      <div style={{ display: "flex", height: "100%" }}>
        <EmptyState onExampleClick={onExampleClick} />
      </div>
    );
  }

  const isTerminal = mission.status === "completed" || mission.status === "failed";

  return (
    <div ref={boardRef} style={{ height: "100%", overflowY: "auto" }}>
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
          onRetry={onRetryMission}
          scanFindings={scanFindings}
          isScanning={isScanning}
          scans={scans}
          onTriggerScan={onTriggerScan}
        />
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
