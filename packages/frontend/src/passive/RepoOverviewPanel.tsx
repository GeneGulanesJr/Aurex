import { useRef, useEffect } from "react";
import { staggerEntrance } from "../animations/stagger";
import { MutationPanel } from "../active/MutationPanel";
import type { BumblebeeFinding, BumblebeeScanResult } from "@aurex/shared";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion, SuggestionTier, SuggestionCategory, RepoReadinessProfile } from "../api";

interface RepoOverviewPanelProps {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
  hotspots: CodeHotspotsResponse | null;
  suggestions: RepoSuggestion[];
  readiness: RepoReadinessProfile | null;
  packageScan: BumblebeeScanResult | null;
  packageFindings: BumblebeeFinding[];
  loading: boolean;
  onStartMission: (prefill: string) => void;
}

const tierConfig: Record<SuggestionTier, { color: string; bg: string; border: string; label: string }> = {
  P0: { color: "var(--error)",     bg: "rgba(239,68,68,0.08)",  border: "var(--error)",      label: "P0 CRITICAL" },
  P1: { color: "var(--accent)",  bg: "rgba(232,146,13,0.06)",  border: "var(--accent-dim)",  label: "P1 HIGH" },
  P2: { color: "var(--warning)",   bg: "rgba(250,204,21,0.05)", border: "rgba(250,204,21,0.2)", label: "P2 MEDIUM" },
  P3: { color: "var(--info)",      bg: "rgba(129,140,248,0.05)", border: "rgba(129,140,248,0.2)", label: "P3 STANDARD" },
  P4: { color: "var(--text-secondary)", bg: "rgba(155,142,122,0.05)", border: "var(--border)", label: "P4 LOW" },
  P5: { color: "var(--text-muted)",     bg: "transparent",              border: "var(--border)", label: "P5 POLISH" },
};

const categoryIcons: Record<SuggestionCategory, string> = {
  critical_path: "🔴",
  security: "🔒",
  dead_code: "💀",
  complexity: "🔥",
  coupling: "🔗",
  layer_violation: "📐",
  test_coverage: "🧪",
  documentation: "📝",
  performance: "⚡",
  structure: "📦",
  naming: "🏷️",
  style: "✨",
};

export function RepoOverviewPanel({ repoName, fullName, summary, hotspots, suggestions, readiness, packageScan, packageFindings, loading, onStartMission }: RepoOverviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>(".overview-section");
    if (sections.length === 0) return;
    staggerEntrance(Array.from(sections));
  }, [summary, readiness, packageScan, loading]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--text-muted)", letterSpacing: "2px" }}>
          ANALYZING REPOSITORY, PACKAGES, AND READINESS…
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ maxWidth: "800px", margin: "0 auto", padding: "24px" }}>
      {/* Header */}
      <div className="overview-section" style={{ opacity: 0, marginBottom: "24px" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "4px" }}>
          REPO MAP
        </div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "14px", color: "var(--text-primary)" }}>
          {fullName}
          {summary && (
            <span style={{ color: "var(--text-secondary)", marginLeft: "8px" }}>
              · {summary.files} files · {summary.symbols} symbols
            </span>
          )}
        </div>
      </div>


      {/* Suggestions grouped by tier */}
      {suggestions.length > 0 && (() => {
        // Group suggestions by tier
        const tiers: SuggestionTier[] = ["P0", "P1", "P2", "P3", "P4", "P5"];
        const grouped = new Map<SuggestionTier, RepoSuggestion[]>();
        for (const s of suggestions) {
          const group = grouped.get(s.tier) ?? [];
          group.push(s);
          grouped.set(s.tier, group);
        }
        const activeTiers = tiers.filter((t) => (grouped.get(t)?.length ?? 0) > 0);

        return (
          <div className="overview-section" style={{ opacity: 0 }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>NEXT BEST MISSIONS</span>
              <span style={{ fontSize: "9px", letterSpacing: "1px" }}>{suggestions.length} actionable · {activeTiers.length} priority bands</span>
            </div>
            {activeTiers.map((tier) => {
              const cfg = tierConfig[tier];
              const items = grouped.get(tier)!;
              return (
                <div key={tier} style={{ marginBottom: "16px" }}>
                  {/* Tier header */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "8px",
                    paddingBottom: "4px",
                    borderBottom: `1px solid ${cfg.border}`,
                  }}>
                    <span style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "10px",
                      letterSpacing: "1px",
                      color: cfg.color,
                      fontWeight: 600,
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      {items.length} mission{items.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {/* Tier items */}
                  {items.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      style={{
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`,
                        borderRadius: "6px",
                        padding: "10px 14px",
                        marginBottom: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent-dim)";
                        e.currentTarget.style.background = "var(--bg-elevated)";
                        e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = cfg.border;
                        e.currentTarget.style.background = cfg.bg;
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <span style={{ fontSize: "14px", flexShrink: 0 }}>{categoryIcons[suggestion.category] ?? "•"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "12px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>{suggestion.title}</div>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px", lineHeight: 1.4 }}>{suggestion.description}</div>
                        {(suggestion.confidence || suggestion.estimatedEffort || suggestion.estimatedRisk) && (
                          <div style={{ display: "flex", gap: "6px", marginTop: "5px", flexWrap: "wrap" }}>
                            {suggestion.confidence && <span style={{ fontSize: "9px", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "3px", padding: "1px 4px" }}>{suggestion.confidence} confidence</span>}
                            {suggestion.estimatedEffort && <span style={{ fontSize: "9px", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "3px", padding: "1px 4px" }}>{suggestion.estimatedEffort} effort</span>}
                            {suggestion.estimatedRisk && <span style={{ fontSize: "9px", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "3px", padding: "1px 4px" }}>{suggestion.estimatedRisk} risk</span>}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => onStartMission(suggestion.prefill)}
                        style={{
                          color: "var(--bg-deep)",
                          background: "var(--accent)",
                          border: "1px solid var(--accent)",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "10px",
                          padding: "6px 10px",
                          fontFamily: '"JetBrains Mono", monospace',
                          textTransform: "uppercase",
                          letterSpacing: "1px",
                          whiteSpace: "nowrap" as const,
                          flexShrink: 0,
                          fontWeight: 600,
                        }}
                      >
                        Start Mission →
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}


      {/* Readiness + package scan */}
      <div className="overview-section" style={{ opacity: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "8px" }}>
            READINESS PROFILE
          </div>
          {readiness ? (
            <>
              <div style={{ fontSize: "12px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "8px" }}>
                {readiness.profile}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                <div>Package manager: <span style={{ color: "var(--text-primary)" }}>{readiness.packageManager ?? "unknown"}</span></div>
                <div>Mode: <span style={{ color: "var(--text-primary)" }}>{readiness.monorepo ? "monorepo" : "single project"}</span></div>
                <div>Languages: <span style={{ color: "var(--text-primary)" }}>{readiness.languages.join(", ") || "unknown"}</span></div>
              </div>
              {readiness.commands.length > 0 && (
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {readiness.commands.slice(0, 5).map((cmd) => (
                    <div key={`${cmd.name}-${cmd.command}`} style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
                      <span style={{ color: "var(--accent)" }}>{cmd.name}</span> · {cmd.command}
                    </div>
                  ))}
                </div>
              )}
              {[...readiness.blockers, ...readiness.warnings].slice(0, 2).map((warning) => (
                <div key={warning} style={{ marginTop: "6px", fontSize: "10px", color: "var(--warning)", lineHeight: 1.4 }}>⚠ {warning}</div>
              ))}
            </>
          ) : (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No readiness data</div>
          )}
        </div>

        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "8px" }}>
            PACKAGE SCAN
          </div>
          {packageScan?.summary ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginBottom: "10px" }}>
                {[
                  ["CRIT", packageScan.summary.criticalCount, "var(--error)"],
                  ["HIGH", packageScan.summary.highCount, "var(--accent)"],
                  ["MED", packageScan.summary.mediumCount, "var(--warning)"],
                  ["LOW", packageScan.summary.lowCount, "var(--text-muted)"],
                ].map(([label, count, color]) => (
                  <div key={label as string} style={{ border: `1px solid ${color}`, borderRadius: "4px", padding: "6px", textAlign: "center" }}>
                    <div style={{ fontSize: "14px", color: color as string, fontFamily: '"JetBrains Mono", monospace' }}>{count as number}</div>
                    <div style={{ fontSize: "8px", color: "var(--text-muted)", letterSpacing: "1px" }}>{label as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                {packageScan.summary.totalPackages} packages · {packageScan.summary.totalFindings} findings · {packageScan.summary.ecosystems.join(", ") || "no ecosystems"}
              </div>
              {packageFindings.slice(0, 3).map((finding) => (
                <div key={finding.id} style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  <span style={{ color: finding.severity === "critical" ? "var(--error)" : finding.severity === "high" ? "var(--accent)" : "var(--warning)" }}>{finding.severity.toUpperCase()}</span> · {finding.packageName}@{finding.version}
                </div>
              ))}
            </>
          ) : (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No package scan findings</div>
          )}
        </div>
      </div>

      {/* Modules + Hotspots grid */}
      <div className="overview-section" style={{ opacity: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Modules */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "8px" }}>
            MODULES
          </div>
          {summary?.modules.map((mod) => (
            <div key={mod.name} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: "12px" }}>
              <span style={{ color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>{mod.name}</span>
              <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace' }}>{mod.fileCount}</span>
            </div>
          ))}
          {(!summary || summary.modules.length === 0) && (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No module data</div>
          )}
        </div>

        {/* Hotspots */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "8px" }}>
            HOTSPOTS
          </div>
          {hotspots?.files.slice(0, 6).map((file) => {
            const barWidth = Math.min(100, (file.complexity / 50) * 100);
            return (
              <div key={file.path} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 0", fontSize: "12px" }}>
                <span style={{ color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path.split("/").pop()}
                </span>
                <div style={{ width: "60px", height: "6px", background: "var(--bg-inset)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${barWidth}%`, height: "100%", background: file.complexity > 30 ? "var(--error)" : file.complexity > 20 ? "var(--warning)" : "var(--text-muted)", borderRadius: "3px" }} />
                </div>
                <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", minWidth: "16px", textAlign: "right" as const }}>{file.complexity}</span>
              </div>
            );
          })}
          {(!hotspots || hotspots.files.length === 0) && (
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>No hotspot data</div>
          )}
        </div>
      </div>

      {/* Structure */}
      {summary && (
        <div className="overview-section" style={{ opacity: 0, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", marginBottom: "16px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "8px" }}>
            STRUCTURE
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {summary.entryPoints.length > 0 && (
              <div>
                <span style={{ color: "var(--text-muted)" }}>Entry Points: </span>
                {summary.entryPoints.join(", ")}
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-muted)" }}>Dependency Cycles: </span>
              {summary.cycles.count}
              <span style={{ color: "var(--text-muted)", marginLeft: "12px" }}>Edges: </span>
              {summary.edges}
            </div>
          </div>
        </div>
      )}

      {/* Mutation testing */}
      <div className="overview-section" style={{ opacity: 0, marginBottom: "16px" }}>
        <MutationPanel repoName={repoName} />
      </div>

    </div>
  );
}
