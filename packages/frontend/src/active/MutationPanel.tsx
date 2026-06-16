import { useState, useCallback, useRef, useEffect } from "react";
import type { MutationReportSummary, MutationRunStatus } from "@aurex/shared";
import { runMutationTests, getMutationRunStatus, getMutationSummary } from "../api";
import { scoreBand, bandColorVar } from "./mutation-score";
import { getSessionState, setSessionState, clearSessionState } from "../lib/sessionState";

interface Props {
  repoName: string;
}

const POLL_INTERVAL_MS = 2000;
const runKey = (repoName: string) => `mutation_run:${repoName}`;

const sectionStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "12px",
};

const headerLabelStyle: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
};

const mutedTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "var(--text-muted)",
};

const TERMINAL_STATES = new Set(["completed", "failed"]);

export function MutationPanel({ repoName }: Props) {
  const [summary, setSummary] = useState<MutationReportSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [runStatus, setRunStatus] = useState<MutationRunStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Clear any persisted in-flight run once it reaches a terminal state.
  const handleTerminal = useCallback((state: MutationRunStatus) => {
    if (TERMINAL_STATES.has(state.state)) {
      clearSessionState(runKey(repoName));
    }
  }, [repoName]);

  // Poll a specific runId, updating status and clearing the interval on
  // completion/failure/error. Used both for new runs and for resuming a run
  // that was already in progress when the component (re)mounted.
  const pollRun = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await getMutationRunStatus(repoName, id);
        setRunStatus(status);
        if (status.state === "completed" && status.summary) {
          setSummary(status.summary);
        }
        if (TERMINAL_STATES.has(status.state)) {
          handleTerminal(status);
          stopPolling();
        }
      } catch {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [repoName, stopPolling, handleTerminal]);

  useEffect(() => {
    let cancelled = false;
    setSummaryError(false);
    getMutationSummary(repoName)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummaryError(true); });
    return () => { cancelled = true; };
  }, [repoName]);

  // On mount (or when repoName changes), resume polling an in-flight run that
  // was started in a previous mount. This prevents the "Run Mutation Tests"
  // button re-enabling and starting a *duplicate concurrent run* for the same
  // repo after a remount/refresh while the server-side run is still going.
  useEffect(() => {
    const persisted = getSessionState<{ runId: string; startedAt: string }>(runKey(repoName));
    if (persisted?.runId) {
      setRunStatus({ state: "running", runId: persisted.runId, progress: 0, currentMutator: null });
      pollRun(persisted.runId);
    }
    return () => { stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoName]);

  const startRun = useCallback(async () => {
    // Always clear any existing poll before starting a new run so we never
    // have two intervals running (e.g. after a repo switch left one dangling).
    stopPolling();
    setRunStatus({ state: "starting", runId: "", startedAt: new Date().toISOString() });
    try {
      const { runId } = await runMutationTests(repoName);
      // Persist so a remount resumes this run instead of letting the user
      // start a duplicate.
      setSessionState(runKey(repoName), { runId, startedAt: new Date().toISOString() });
      pollRun(runId);
    } catch (err) {
      clearSessionState(runKey(repoName));
      setRunStatus({
        state: "failed",
        runId: "",
        error: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      });
    }
  }, [repoName, stopPolling, pollRun]);

  const runIsBusy = runStatus.state === "starting" || runStatus.state === "running";

  if (summaryError) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>
          Could not load mutation data for this repo.
        </p>
      </div>
    );
  }

  if (summary && !summary.strykerConfigured) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>
          Stryker is not configured in this repo. Add a <code style={{ fontFamily: '"JetBrains Mono", monospace', color: "var(--accent)" }}>stryker.config.*</code> file to enable mutation testing.
        </p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div data-testid="mutation-panel" style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={headerLabelStyle}>Mutation Testing</span>
        </div>
        <p style={{ ...mutedTextStyle, marginTop: "8px" }}>Loading mutation data…</p>
      </div>
    );
  }

  const band = scoreBand(summary.score);

  return (
    <div data-testid="mutation-panel" style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: bandColorVar(band),
              boxShadow: band !== "none" ? `0 0 6px ${bandColorVar(band)}` : "none",
            }}
          />
          <span style={headerLabelStyle}>Mutation Score</span>
        </div>
        <span
          data-testid="mutation-score"
          data-band={band}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "15px",
            fontWeight: 500,
            color: bandColorVar(band),
          }}
        >
          {summary.score !== null ? `${summary.score.toFixed(1)}%` : "—"}
        </span>
      </div>

      {summary.counts && (
        <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>
          <span><span style={{ color: "var(--success)" }}>{summary.counts.killed}</span> killed</span>
          <span><span style={{ color: "var(--error)" }}>{summary.counts.survived}</span> survived</span>
          <span><span style={{ color: "var(--text-muted)" }}>{summary.counts.noCoverage}</span> no-cov</span>
        </div>
      )}

      {summary.generatedAt && (
        <p style={{ marginTop: "8px", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>
          Last run: {new Date(summary.generatedAt).toLocaleString()}
        </p>
      )}

      <button
        type="button"
        onClick={startRun}
        disabled={runIsBusy}
        style={{
          marginTop: "12px",
          width: "100%",
          borderRadius: "4px",
          border: "1px solid var(--accent-dim)",
          background: "transparent",
          padding: "6px 12px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "10px",
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--accent)",
          cursor: runIsBusy ? "not-allowed" : "pointer",
          opacity: runIsBusy ? 0.5 : 1,
        }}
        onMouseEnter={(e) => { if (!runIsBusy) e.currentTarget.style.background = "var(--accent-glow)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {runStatus.state === "idle" && "Run Mutation Tests"}
        {runStatus.state === "starting" && "Starting…"}
        {runStatus.state === "running" && "Running…"}
        {runStatus.state === "completed" && "Re-run Mutation Tests"}
        {runStatus.state === "failed" && "Retry"}
      </button>

      {runStatus.state === "failed" && "error" in runStatus && (
        <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--error)" }}>{runStatus.error}</p>
      )}
    </div>
  );
}
