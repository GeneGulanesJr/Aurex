import type { GitHubRepoResponse } from "../api";
import type { CodeSummaryResponse } from "../api";

interface RepoPrepareModalProps {
  repo: GitHubRepoResponse;
  phase: "confirm" | "cloning" | "indexing" | "complete" | "error";
  summary?: CodeSummaryResponse | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry?: () => void;
}

const phases = [
  { key: "cloning", label: "Clone or update the repository" },
  { key: "indexing", label: "Index code for AI context" },
  { key: "complete", label: "Ready for mission work" },
] as const;

function phaseIndex(phase: RepoPrepareModalProps["phase"]): number {
  if (phase === "confirm") return -1;
  return phases.findIndex((p) => p.key === phase);
}

export function RepoPrepareModal({ repo, phase, summary, error, onCancel, onConfirm, onRetry }: RepoPrepareModalProps) {
  const currentIdx = phaseIndex(phase);
  const isWorking = phase === "cloning" || phase === "indexing";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0, 0, 0, 0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onCancel}
    >
      <section
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "420px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-bright)",
          borderRadius: "6px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          padding: "16px",
        }}
      >
        {/* Header */}
        <h3
          style={{
            margin: 0,
            color: "var(--text-primary)",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "13px",
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          {phase === "confirm" && "Use this repository?"}
          {isWorking && "PREPARING REPOSITORY"}
          {phase === "complete" && "REPOSITORY READY ✓"}
          {phase === "error" && "PREPARATION FAILED"}
        </h3>

        {/* Repo identity */}
        <div
          style={{
            background: "var(--bg-inset)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "10px",
            marginTop: "12px",
          }}
        >
          <div style={{ color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>{repo.full_name}</div>
          <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "4px" }}>
            Default branch: {repo.default_branch}{repo.private ? " · PRIVATE" : ""}
          </div>
        </div>

        {/* Confirm state: show checklist */}
        {phase === "confirm" && (
          <>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5, marginTop: "12px" }}>
              Aurex will prepare this repository before starting your mission.
            </p>
            <ul style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.7, paddingLeft: "18px" }}>
              {phases.map((p) => (
                <li key={p.key}>{p.label}</li>
              ))}
            </ul>
          </>
        )}

        {/* Working state: show progress checklist */}
        {isWorking && (
          <div style={{ marginTop: "12px" }}>
            {phases.map((p, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <div key={p.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", color: done ? "var(--success)" : active ? "var(--accent)" : "var(--text-muted)", fontSize: "13px" }}>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
                    {done ? "✓" : active ? "◌" : "○"}
                  </span>
                  <span>{p.label}</span>
                  {active && (
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto" }}>
                      {phase === "indexing" ? "Indexing…" : "Cloning…"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Complete state: show summary */}
        {phase === "complete" && summary && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ color: "var(--text-primary)", fontSize: "13px", fontFamily: '"JetBrains Mono", monospace' }}>
              {summary.files} files · {summary.symbols} symbols · {summary.modules.length} modules
            </div>
            {summary.modules.length > 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" }}>
                Top modules: {summary.modules.slice(0, 3).map((m) => m.name).join(", ")}
              </div>
            )}
            <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
              Entry points: {summary.entryPoints.length} · Cycles: {summary.cycles.count}
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="pinyx-error-bar" style={{ marginTop: "12px" }}>
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pinyx-btn-group" style={{ justifyContent: "flex-end", marginTop: "12px" }}>
          <button className="pinyx-btn-outline" onClick={onCancel}>
            {isWorking ? "Cancel Anyway" : "Cancel"}
          </button>
          {phase === "confirm" && (
            <button className="pinyx-btn-primary" onClick={onConfirm} disabled={isWorking}>
              Prepare & Scan
            </button>
          )}
          {phase === "complete" && (
            <button className="pinyx-btn-primary" onClick={onConfirm} disabled={isWorking}>
              Use Repo
            </button>
          )}
          {phase === "error" && onRetry && (
            <button className="pinyx-btn-primary" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
