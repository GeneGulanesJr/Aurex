import { useEffect, useRef, useState } from "react";
import { MissionPipeline } from "./MissionPipeline";
import { EmptyState } from "../frame/EmptyState";
import { dimPassive, restorePassive } from "../animations/state-transitions";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";
import type { MissionError } from "../hooks/useMission";

interface StatusBoardProps {
  mission: Mission | null;
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  logs: Array<{ phase: string; message: string; timestamp: number }>;
  errors: MissionError[];
  blurred: boolean;
  onExampleClick?: (text: string) => void;
  onRetryMission?: () => void;
  onDismissErrors?: () => void;
}

export function StatusBoard({ mission, milestones, workers, cost, events, logs, errors, blurred, onExampleClick, onRetryMission, onDismissErrors }: StatusBoardProps) {
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
    return (
      <div style={{ display: "flex", height: "100%" }}>
        <EmptyState onExampleClick={onExampleClick} />
      </div>
    );
  }

  return (
    <div ref={boardRef} style={{ height: "100%", overflowY: "auto" }}>
      {nonRecoverableErrors.length > 0 && (
        <ErrorBanner
          errors={nonRecoverableErrors}
          expanded={errorBannerExpanded}
          onToggleExpand={() => setErrorBannerExpanded(!errorBannerExpanded)}
          onDismiss={onDismissErrors}
        />
      )}
      <MissionPipeline
        mission={mission}
        milestones={milestones}
        workers={workers}
        cost={cost}
        events={events}
        logs={logs}
        errors={errors}
        onRetry={onRetryMission}
      />
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
