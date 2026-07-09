import { useState, useCallback, useEffect } from "react";
import type { IsolatedIssue, ReviewReport, SuggestionTier, IssueStatus } from "@aurex/shared";

interface RepoScanDashboardProps {
  repoName: string;
  fullName: string;
  report: ReviewReport | null;
  loading: boolean;
  error?: string | null;
  onRescan?: () => void;
  onIssueStatusChange?: (issueId: string, status: IssueStatus) => void;
}

const tierConfig: Record<SuggestionTier, { color: string; label: string }> = {
  P0: { color: "var(--error)", label: "P0 CRITICAL" },
  P1: { color: "var(--accent)", label: "P1 HIGH" },
  P2: { color: "var(--warning)", label: "P2 MEDIUM" },
  P3: { color: "var(--info)", label: "P3 STANDARD" },
  P4: { color: "var(--text-secondary)", label: "P4 LOW" },
  P5: { color: "var(--text-muted)", label: "P5 POLISH" },
};

export function RepoScanDashboard({
  repoName,
  fullName,
  report,
  loading,
  error,
  onRescan,
  onIssueStatusChange,
}: RepoScanDashboardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const issues = report?.issues ?? [];
  const selected = issues.find((i) => i.id === selectedId) ?? issues[0] ?? null;

  useEffect(() => {
    setSelectedId(null);
  }, [report?.id]);

  useEffect(() => {
    if (selectedId && !issues.some((i) => i.id === selectedId)) {
      setSelectedId(null);
    }
  }, [issues, selectedId]);

  const handleCopy = useCallback(async (text: string, issueId?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied!");
      if (issueId && onIssueStatusChange) onIssueStatusChange(issueId, "copied");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [onIssueStatusChange]);

  const handleExportAll = useCallback(() => {
    if (!report) return;
    const blob = new Blob(
      [issues.map((i) => i.fixPrompt).join("\n\n---\n\n")],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${repoName}-fix-prompts.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, issues, repoName]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "320px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--text-muted)", letterSpacing: "2px" }}>
          SCANNING REPOSITORY · INDEXING · GENERATING FIX PROMPTS…
        </div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "320px", padding: "24px", textAlign: "center" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--error)", letterSpacing: "2px", marginBottom: "12px" }}>
          SCAN FAILED
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "400px", lineHeight: 1.6 }}>{error}</div>
        {onRescan && (
          <button
            type="button"
            onClick={onRescan}
            style={{ marginTop: "16px", padding: "8px 16px", background: "var(--accent)", color: "var(--bg-deep)", border: "none", borderRadius: "4px", cursor: "pointer", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}
          >
            Retry scan
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "480px" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", color: "var(--text-muted)", marginBottom: "4px" }}>
            REPO SCAN
          </div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "14px", color: "var(--text-primary)" }}>
            {fullName}
            {report && (
              <span style={{ color: "var(--text-secondary)", marginLeft: "8px", fontSize: "11px" }}>
                · {report.summary.files} files · {issues.length} isolated issue{issues.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {copyFeedback && (
            <span style={{ fontSize: "10px", color: "var(--success)", fontFamily: '"JetBrains Mono", monospace' }}>{copyFeedback}</span>
          )}
          {report && issues.length > 0 && (
            <button
              type="button"
              onClick={handleExportAll}
              style={{ padding: "6px 12px", background: "transparent", color: "var(--accent)", border: "1px solid var(--accent-dim)", borderRadius: "4px", cursor: "pointer", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
            >
              Export all
            </button>
          )}
          {onRescan && (
            <button
              type="button"
              onClick={onRescan}
              style={{ padding: "6px 12px", background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
            >
              Re-scan
            </button>
          )}
        </div>
      </div>

      {error && report && (
        <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "var(--bg-inset)", border: "1px solid var(--warning)", borderRadius: "4px", fontSize: "11px", color: "var(--warning)" }}>
          ⚠ {error}
        </div>
      )}

      {issues.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
          No issues detected — repository looks clean.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "8px" }}>
            {issues.map((issue) => {
              const tier = tierConfig[issue.tier];
              const active = selected?.id === issue.id;
              return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedId(issue.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    marginBottom: "6px",
                    background: active ? "var(--bg-elevated)" : "var(--bg-surface)",
                    border: `1px solid ${active ? "var(--accent-dim)" : "var(--border)"}`,
                    borderRadius: "4px",
                    cursor: "pointer",
                    boxShadow: active ? "0 0 12px var(--accent-glow)" : "none",
                  }}
                >
                  <div style={{ fontSize: "9px", letterSpacing: "1px", color: tier.color, fontFamily: '"JetBrains Mono", monospace', marginBottom: "4px" }}>
                    {tier.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.4 }}>{issue.title}</div>
                  {issue.status && issue.status !== "open" && (
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", fontFamily: '"JetBrains Mono", monospace' }}>
                      {issue.status.toUpperCase()}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {selected && (
              <>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-secondary)" }}>
                    FIX PROMPT
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => onIssueStatusChange?.(selected.id, "dismissed")}
                      style={{ padding: "6px 10px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(selected.fixPrompt, selected.id)}
                      style={{ padding: "6px 14px", background: "var(--accent)", color: "var(--bg-deep)", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}
                    >
                      Copy fix prompt
                    </button>
                  </div>
                </div>
                <pre
                  style={{
                    flex: 1,
                    margin: 0,
                    padding: "16px 20px",
                    overflow: "auto",
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "12px",
                    lineHeight: 1.6,
                    color: "var(--text-primary)",
                    background: "var(--bg-inset)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {selected.fixPrompt}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
