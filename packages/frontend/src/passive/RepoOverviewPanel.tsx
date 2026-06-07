import { useRef, useEffect } from "react";
import { staggerEntrance } from "../animations/stagger";
import type { CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion } from "../api";

interface RepoOverviewPanelProps {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
  hotspots: CodeHotspotsResponse | null;
  suggestions: RepoSuggestion[];
  loading: boolean;
  onStartMission: (prefill: string) => void;
}

const categoryIcons: Record<string, string> = {
  high_complexity: "🔥",
  cycles: "⚠️",
  structure: "📐",
};

const priorityColors: Record<string, string> = {
  high: "var(--error)",
  medium: "var(--warning)",
  low: "var(--text-muted)",
};

export function RepoOverviewPanel({ fullName, summary, hotspots, suggestions, loading, onStartMission }: RepoOverviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>(".overview-section");
    staggerEntrance(Array.from(sections));
  }, [summary]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--text-muted)", letterSpacing: "2px" }}>
          ANALYZING REPOSITORY…
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

      {/* Modules + Hotspots grid */}
      <div className="overview-section" style={{ opacity: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Modules */}
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
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
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
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
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
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

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="overview-section" style={{ opacity: 0 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>SUGGESTED MISSIONS</span>
            <span style={{ fontSize: "9px", letterSpacing: "1px" }}>BASED ON CODE</span>
          </div>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "12px 16px",
                marginBottom: "8px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent-dim)";
                e.currentTarget.style.background = "var(--bg-elevated)";
                e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--bg-surface)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: "16px", flexShrink: 0 }}>{categoryIcons[suggestion.category] ?? "•"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>{suggestion.title}</div>
                <div style={{ fontSize: "11px", color: priorityColors[suggestion.priority] ?? "var(--text-muted)", marginTop: "2px" }}>{suggestion.detail}</div>
              </div>
              <button
                onClick={() => onStartMission(suggestion.prefill)}
                style={{
                  color: "var(--accent)",
                  background: "none",
                  border: "1px solid var(--accent-dim)",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  padding: "4px 8px",
                  fontFamily: '"JetBrains Mono", monospace',
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  whiteSpace: "nowrap" as const,
                  flexShrink: 0,
                }}
              >
                Start Mission →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
