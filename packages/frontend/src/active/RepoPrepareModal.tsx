import type { GitHubRepoResponse } from "../api";

interface RepoPrepareModalProps {
  repo: GitHubRepoResponse;
  preparing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RepoPrepareModal({ repo, preparing, error, onCancel, onConfirm }: RepoPrepareModalProps) {
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
      onClick={preparing ? undefined : onCancel}
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
          Use this repository?
        </h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5 }}>
          Aurex will prepare this repository before starting your mission.
        </p>
        <ul style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.7, paddingLeft: "18px" }}>
          <li>Clone or update the repository in the Docker workspace</li>
          <li>Prepare the repo for LaPis indexing when the endpoint is available</li>
          <li>Use it as the working repo for this mission</li>
        </ul>
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

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
          </div>
        )}

        <div className="pinyx-btn-group" style={{ justifyContent: "flex-end" }}>
          <button className="pinyx-btn-outline" onClick={onCancel} disabled={preparing}>
            Cancel
          </button>
          <button className="pinyx-btn-primary" onClick={onConfirm} disabled={preparing}>
            {preparing ? "Preparing..." : "Use This Repo"}
          </button>
        </div>
      </section>
    </div>
  );
}
