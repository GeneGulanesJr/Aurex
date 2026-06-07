import { useState, useCallback, useRef, useEffect } from "react";
import type { MutationReportSummary, MutationRunStatus } from "@aurex/shared";
import { runMutationTests, getMutationRunStatus } from "../api.js";
import { scoreBand, bandColorVar } from "./mutation-score.js";

interface Props {
  repoName: string;
  summary: MutationReportSummary;
}

export function MutationPanel({ repoName, summary }: Props) {
  const [runStatus, setRunStatus] = useState<MutationRunStatus>({ state: "idle" });
  const band = scoreBand(summary.score);

  // Keep the poll handle in a ref so we can clean it up on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startRun = useCallback(async () => {
    setRunStatus({ state: "starting", runId: "", startedAt: new Date().toISOString() });
    try {
      const { runId } = await runMutationTests(repoName);
      // Poll for completion. The WebSocket event bus (`mutation_progress` events)
      // is used for streaming progress; the status endpoint is used for terminal state.
      pollRef.current = setInterval(async () => {
        try {
          const status = await getMutationRunStatus(repoName, runId);
          setRunStatus(status);
          if (status.state === "completed" || status.state === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
    } catch (err) {
      setRunStatus({
        state: "failed",
        runId: "",
        error: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      });
    }
  }, [repoName]);

  if (!summary.strykerConfigured) {
    return (
      <div data-testid="mutation-panel" className="rounded-md border border-border bg-bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
          <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-secondary">
            Mutation Testing
          </span>
        </div>
        <p className="mt-2 text-[13px] text-text-muted">
          Stryker is not configured in this repo. Add a <code>stryker.config.*</code> file to enable mutation testing.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="mutation-panel" className="rounded-md border border-border bg-bg-surface p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: bandColorVar(band),
              boxShadow: band !== "none" ? "0 0 6px currentColor" : "none",
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-secondary">
            Mutation Score
          </span>
        </div>
        <span
          data-testid="mutation-score"
          data-band={band}
          className="font-mono text-[15px] font-medium"
          style={{ color: bandColorVar(band) }}
        >
          {summary.score !== null ? `${summary.score.toFixed(1)}%` : "—"}
        </span>
      </div>

      {summary.counts && (
        <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px] text-text-muted">
          <span><span className="text-success">{summary.counts.killed}</span> killed</span>
          <span><span className="text-error">{summary.counts.survived}</span> survived</span>
          <span><span className="text-text-muted">{summary.counts.noCoverage}</span> no-cov</span>
        </div>
      )}

      {summary.generatedAt && (
        <p className="mt-2 font-mono text-[10px] text-text-muted">
          Last run: {new Date(summary.generatedAt).toLocaleString()}
        </p>
      )}

      <button
        type="button"
        onClick={startRun}
        disabled={runStatus.state === "starting" || runStatus.state === "running"}
        className="mt-3 w-full rounded border border-accent-dim bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[2px] text-accent hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-50"
      >
        {runStatus.state === "idle" && "Run Mutation Tests"}
        {runStatus.state === "starting" && "Starting…"}
        {runStatus.state === "running" && "Running…"}
        {runStatus.state === "completed" && "Re-run Mutation Tests"}
        {runStatus.state === "failed" && "Retry"}
      </button>

      {runStatus.state === "failed" && "error" in runStatus && (
        <p className="mt-2 text-[12px] text-error">{runStatus.error}</p>
      )}
    </div>
  );
}
