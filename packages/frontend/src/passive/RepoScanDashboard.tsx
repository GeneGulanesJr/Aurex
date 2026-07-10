import { useState, useCallback, useEffect, useMemo } from "react";
import type {
  IsolatedIssue,
  ReviewReport,
  SuggestionCategory,
  SuggestionTier,
  IssueStatus,
} from "@aurex/shared";
import { exportRepoReview } from "../api";

interface RepoScanDashboardProps {
  repoName: string;
  fullName: string;
  report: ReviewReport | null;
  loading: boolean;
  error?: string | null;
  onRescan?: () => void;
  onIssueStatusChange?: (issueId: string, status: IssueStatus) => void;
}

type StatusFilter = "open" | "dismissed" | "all";
type DashboardTab = "suggestions" | "architecture";

const SCAN_PHASES = [
  "INDEXING REPOSITORY",
  "ANALYZING DEPENDENCY GRAPH",
  "RUNNING SUPPLY-CHAIN SCAN",
  "ISOLATING ISSUES",
  "GENERATING FIX PROMPTS",
] as const;

const tierConfig: Record<SuggestionTier, { color: string; label: string }> = {
  P0: { color: "var(--error)", label: "P0 CRITICAL" },
  P1: { color: "var(--accent)", label: "P1 HIGH" },
  P2: { color: "var(--warning)", label: "P2 MEDIUM" },
  P3: { color: "var(--info)", label: "P3 STANDARD" },
  P4: { color: "var(--text-secondary)", label: "P4 LOW" },
  P5: { color: "var(--text-muted)", label: "P5 POLISH" },
};

const ALL_CATEGORIES: SuggestionCategory[] = [
  "critical_path",
  "security",
  "dead_code",
  "complexity",
  "coupling",
  "layer_violation",
  "test_coverage",
  "documentation",
  "performance",
  "structure",
  "naming",
  "style",
];

const LIST_PAGE_SIZE = 50;

function formatScanTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatCategory(category: SuggestionCategory): string {
  return category.replace(/_/g, " ");
}

function supplyChainLabel(report: ReviewReport): string | null {
  const sc = report.summary.supplyChainSeverity;
  if (!sc) return null;
  const parts = [`${sc.totalFindings} supply-chain finding${sc.totalFindings === 1 ? "" : "s"}`];
  if (sc.criticalCount > 0) parts.push(`${sc.criticalCount} critical`);
  if (sc.highCount > 0) parts.push(`${sc.highCount} high`);
  return parts.join(" · ");
}

function filterIssues(
  issues: IsolatedIssue[],
  opts: {
    tier: SuggestionTier | "all";
    category: SuggestionCategory | "all";
    status: StatusFilter;
    query: string;
  },
): IsolatedIssue[] {
  const q = opts.query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (opts.tier !== "all" && issue.tier !== opts.tier) return false;
    if (opts.category !== "all" && issue.category !== opts.category) return false;
    const status = issue.status ?? "open";
    if (opts.status === "open" && status === "dismissed") return false;
    if (opts.status === "dismissed" && status !== "dismissed") return false;
    if (q) {
      const haystack = `${issue.title} ${issue.description} ${issue.category}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function EmptyIssuesMessage({ report }: { report: ReviewReport }) {
  if (report.status === "partial") {
    return (
      <div style={{ textAlign: "center", maxWidth: "420px", lineHeight: 1.6 }}>
        <div style={{ marginBottom: "8px" }}>Partial scan — some analysis steps failed.</div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          Check the warning banner above or re-scan. No isolated issues were produced from the data that did load.
        </div>
      </div>
    );
  }
  if (report.status === "failed") {
    return <span>Review failed — no issues could be generated.</span>;
  }
  return <span>No issues detected — repository looks clean.</span>;
}

function ArchitecturePanel({ report }: { report: ReviewReport }) {
  const { architecture } = report;
  return (
    <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
      <section style={{ marginBottom: "20px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", color: "var(--text-muted)", marginBottom: "8px" }}>
          MODULES ({architecture.modules.length})
        </div>
        {architecture.modules.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No modules indexed.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", lineHeight: 1.8 }}>
            {architecture.modules.map((m) => (
              <li key={m.name}>{m.name} — {m.fileCount} file{m.fileCount === 1 ? "" : "s"}</li>
            ))}
          </ul>
        )}
      </section>
      <section style={{ marginBottom: "20px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", color: "var(--text-muted)", marginBottom: "8px" }}>
          DEPENDENCY CYCLES ({architecture.cycles.length})
        </div>
        {architecture.cycles.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No cycles detected.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", lineHeight: 1.8 }}>
            {architecture.cycles.map((cycle, i) => (
              <li key={i}>{cycle.join(" → ")}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", color: "var(--text-muted)", marginBottom: "8px" }}>
          ENTRY POINTS ({architecture.entryPoints.length})
        </div>
        {architecture.entryPoints.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No entry points detected.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", lineHeight: 1.8 }}>
            {architecture.entryPoints.map((ep) => (
              <li key={ep}>{ep}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

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
  const [actionFeedback, setActionFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<DashboardTab>("suggestions");
  const [tierFilter, setTierFilter] = useState<SuggestionTier | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<SuggestionCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [scanPhaseIndex, setScanPhaseIndex] = useState(0);

  const issues = report?.issues ?? [];

  const filteredIssues = useMemo(
    () => filterIssues(issues, {
      tier: tierFilter,
      category: categoryFilter,
      status: statusFilter,
      query: searchQuery,
    }),
    [issues, tierFilter, categoryFilter, statusFilter, searchQuery],
  );

  const visibleIssues = filteredIssues.slice(0, listLimit);
  const selected = visibleIssues.find((i) => i.id === selectedId)
    ?? filteredIssues.find((i) => i.id === selectedId)
    ?? visibleIssues[0]
    ?? filteredIssues[0]
    ?? null;

  const recommendedHighest = report?.recommended?.highestImpact
    ? issues.find((i) => i.id === report.recommended!.highestImpact)
    : undefined;
  const recommendedSafest = report?.recommended?.safestFirst
    ? issues.find((i) => i.id === report.recommended!.safestFirst)
    : undefined;

  useEffect(() => {
    setSelectedId(null);
    setListLimit(LIST_PAGE_SIZE);
  }, [report?.id]);

  useEffect(() => {
    if (selectedId && !filteredIssues.some((i) => i.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredIssues, selectedId]);

  useEffect(() => {
    if (!loading) {
      setScanPhaseIndex(0);
      return;
    }
    const id = setInterval(() => {
      setScanPhaseIndex((i) => (i + 1) % SCAN_PHASES.length);
    }, 2200);
    return () => clearInterval(id);
  }, [loading]);

  const handleCopy = useCallback(async (text: string, issueId?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setActionFeedback({ message: "Copied!", ok: true });
      if (issueId && onIssueStatusChange) onIssueStatusChange(issueId, "copied");
      setTimeout(() => setActionFeedback(null), 2000);
    } catch {
      setActionFeedback({ message: "Copy failed", ok: false });
      setTimeout(() => setActionFeedback(null), 2000);
    }
  }, [onIssueStatusChange]);

  const handleExportAll = useCallback(async () => {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const markdown = await exportRepoReview(repoName, report.id);
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${repoName}-fix-prompts.md`;
      a.click();
      URL.revokeObjectURL(url);
      setActionFeedback({ message: "Exported!", ok: true });
      setTimeout(() => setActionFeedback(null), 2000);
    } catch {
      setActionFeedback({ message: "Export failed", ok: false });
      setTimeout(() => setActionFeedback(null), 2000);
    } finally {
      setExporting(false);
    }
  }, [report, repoName, exporting]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "320px", gap: "12px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--text-muted)", letterSpacing: "2px" }}>
          {SCAN_PHASES[scanPhaseIndex]}…
        </div>
        <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
          Step {scanPhaseIndex + 1} of {SCAN_PHASES.length}
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

  const supplyChain = report ? supplyChainLabel(report) : null;

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
                {report.createdAt && (
                  <span style={{ color: "var(--text-muted)" }}> · scanned {formatScanTime(report.createdAt)}</span>
                )}
                {report.status === "partial" && (
                  <span style={{ color: "var(--warning)" }}> · partial</span>
                )}
              </span>
            )}
          </div>
          {supplyChain && (
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "6px", fontFamily: '"JetBrains Mono", monospace' }}>
              {supplyChain}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {actionFeedback && (
            <span style={{ fontSize: "10px", color: actionFeedback.ok ? "var(--success)" : "var(--error)", fontFamily: '"JetBrains Mono", monospace' }}>{actionFeedback.message}</span>
          )}
          {report && issues.length > 0 && (
            <button
              type="button"
              onClick={handleExportAll}
              disabled={exporting}
              style={{ padding: "6px 12px", background: "transparent", color: "var(--accent)", border: "1px solid var(--accent-dim)", borderRadius: "4px", cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.6 : 1, fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
            >
              {exporting ? "Exporting…" : "Export all"}
            </button>
          )}
          {onRescan && (
            <button
              type="button"
              onClick={onRescan}
              disabled={loading || exporting}
              style={{ padding: "6px 12px", background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: "4px", cursor: loading || exporting ? "not-allowed" : "pointer", opacity: loading || exporting ? 0.6 : 1, fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
            >
              Re-scan
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", padding: "8px 16px 0", borderBottom: "1px solid var(--border)" }}>
        {(["suggestions", "architecture"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: "6px 12px",
              background: tab === t ? "var(--bg-elevated)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "1px",
            }}
          >
            {t === "suggestions" ? "SUGGESTIONS" : t.toUpperCase()}
          </button>
        ))}
      </div>

      {error && report && (
        <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "var(--bg-inset)", border: "1px solid var(--warning)", borderRadius: "4px", fontSize: "11px", color: "var(--warning)" }}>
          ⚠ {error}
        </div>
      )}

      {tab === "architecture" && report ? (
        <ArchitecturePanel report={report} />
      ) : issues.length === 0 && report ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", padding: "24px" }}>
          <EmptyIssuesMessage report={report} />
        </div>
      ) : (
        <>
          {(recommendedHighest || recommendedSafest) && (
            <div style={{ padding: "10px 16px", display: "flex", gap: "8px", flexWrap: "wrap", borderBottom: "1px solid var(--border)", background: "var(--bg-inset)" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', alignSelf: "center" }}>START HERE</span>
              {recommendedHighest && (
                <button
                  type="button"
                  onClick={() => { setSelectedId(recommendedHighest.id); setTab("suggestions"); }}
                  style={{ padding: "4px 10px", background: "var(--bg-elevated)", border: "1px solid var(--error)", borderRadius: "4px", color: "var(--text-primary)", cursor: "pointer", fontSize: "10px" }}
                >
                  Highest impact: {recommendedHighest.title.slice(0, 48)}{recommendedHighest.title.length > 48 ? "…" : ""}
                </button>
              )}
              {recommendedSafest && recommendedSafest.id !== recommendedHighest?.id && (
                <button
                  type="button"
                  onClick={() => { setSelectedId(recommendedSafest.id); setTab("suggestions"); }}
                  style={{ padding: "4px 10px", background: "var(--bg-elevated)", border: "1px solid var(--success)", borderRadius: "4px", color: "var(--text-primary)", cursor: "pointer", fontSize: "10px" }}
                >
                  Safest first: {recommendedSafest.title.slice(0, 48)}{recommendedSafest.title.length > 48 ? "…" : ""}
                </button>
              )}
            </div>
          )}

          <div style={{ padding: "8px 16px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
            <input
              type="search"
              placeholder="Search suggestions…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: "1 1 140px", minWidth: "120px", padding: "6px 10px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-primary)", fontSize: "11px" }}
            />
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as SuggestionTier | "all")} style={{ padding: "6px 8px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-secondary)", fontSize: "10px" }}>
              <option value="all">All tiers</option>
              {(["P0", "P1", "P2", "P3", "P4", "P5"] as const).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as SuggestionCategory | "all")} style={{ padding: "6px 8px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-secondary)", fontSize: "10px" }}>
              <option value="all">All categories</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{formatCategory(c)}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ padding: "6px 8px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-secondary)", fontSize: "10px" }}>
              <option value="open">Open</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All statuses</option>
            </select>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
              {filteredIssues.length}/{issues.length}
            </span>
          </div>

          {filteredIssues.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px" }}>
              No issues match the current filters.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "8px" }}>
                {visibleIssues.map((issue) => {
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
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "6px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "9px", letterSpacing: "1px", color: tier.color, fontFamily: '"JetBrains Mono", monospace' }}>
                          {tier.label}
                        </span>
                        <span style={{ fontSize: "8px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase" }}>
                          {formatCategory(issue.category)}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.4 }}>{issue.title}</div>
                      <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", fontFamily: '"JetBrains Mono", monospace' }}>
                        {issue.confidence} conf · {issue.estimatedEffort} effort
                        {issue.status && issue.status !== "open" && ` · ${issue.status.toUpperCase()}`}
                      </div>
                    </button>
                  );
                })}
                {filteredIssues.length > listLimit && (
                  <button
                    type="button"
                    onClick={() => setListLimit((n) => n + LIST_PAGE_SIZE)}
                    style={{ width: "100%", padding: "8px", marginTop: "4px", background: "transparent", border: "1px dashed var(--border)", borderRadius: "4px", color: "var(--accent)", cursor: "pointer", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}
                  >
                    Show more ({filteredIssues.length - listLimit} remaining)
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                {selected && (
                  <>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
                        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-secondary)" }}>
                          FIX PROMPT
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => onIssueStatusChange?.(selected.id, "acknowledged")}
                            style={{ padding: "6px 10px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}
                          >
                            Acknowledge
                          </button>
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
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                        {selected.description}
                        {selected.evidence.length > 0 && (
                          <span> · Evidence: {selected.evidence[0].message.slice(0, 80)}{selected.evidence[0].message.length > 80 ? "…" : ""}</span>
                        )}
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
        </>
      )}
    </div>
  );
}
