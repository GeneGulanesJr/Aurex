import { useState } from "react";
import type { GitHubRepoResponse } from "../api";

interface RepoPickerProps {
  repos: GitHubRepoResponse[];
  selectedRepoId?: number | null;
  onSelect: (repo: GitHubRepoResponse) => void;
}

export function RepoPicker({ repos, selectedRepoId, onSelect }: RepoPickerProps) {
  const [search, setSearch] = useState("");
  const filtered = repos.filter((repo) =>
    repo.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search repositories..."
        style={{
          width: "100%",
          padding: "6px 8px",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          fontSize: "12px",
          fontFamily: '"Inter", sans-serif',
          outline: "none",
        }}
      />
      <div
        style={{
          maxHeight: "200px",
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          background: "var(--bg-inset)",
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: "8px",
              color: "var(--text-muted)",
              fontSize: "11px",
              fontFamily: '"Inter", sans-serif',
            }}
          >
            No repos found
          </div>
        )}
        {filtered.map((repo) => {
          const selected = repo.id === selectedRepoId;
          return (
            <button
              key={repo.id}
              onClick={() => onSelect(repo)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                padding: "6px 8px",
                background: selected ? "var(--bg-elevated)" : "none",
                border: "none",
                borderBottom: "1px solid var(--border)",
                color: selected ? "var(--accent)" : "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left" as const,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = selected ? "var(--bg-elevated)" : "none")}
            >
              <span style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace' }}>
                {repo.full_name}
              </span>
              <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {repo.private && (
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 4px",
                      background: "var(--accent-glow)",
                      color: "var(--accent)",
                      borderRadius: "2px",
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    PRIVATE
                  </span>
                )}
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  {repo.default_branch}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
