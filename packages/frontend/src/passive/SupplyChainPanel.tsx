import { useState, useCallback, useEffect, useRef } from "react";
import type { BumblebeeFinding, BumblebeeScanResult } from "@aurex/shared";

interface SupplyChainPanelProps {
  findings: BumblebeeFinding[];
  scans: BumblebeeScanResult[];
  isScanning: boolean;
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
  variant?: "inline" | "inspector";
  hideWhenEmpty?: boolean;
}

const severityConfig: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--error)", bg: "var(--bg-inset)", label: "CRITICAL" },
  high: { color: "var(--warning)", bg: "var(--bg-inset)", label: "HIGH" },
  medium: { color: "var(--info)", bg: "var(--bg-inset)", label: "MEDIUM" },
  low: { color: "var(--text-muted)", bg: "var(--bg-inset)", label: "LOW" },
};

export function SupplyChainPanel({ findings, scans, isScanning, onTriggerScan, variant = "inline", hideWhenEmpty = false }: SupplyChainPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  const latestScan = scans.length > 0 ? scans[scans.length - 1] : null;
  const findingCount = findings.length;
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const hasFindings = findingCount > 0;

  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dotRef.current || !isScanning) return;
    dotRef.current.style.animation = "pulse 1.5s infinite";
    return () => {
      if (dotRef.current) dotRef.current.style.animation = "none";
    };
  }, [isScanning]);

  if (hideWhenEmpty && !isScanning && !hasFindings && !latestScan?.summary) return null;

  const headerColor = hasFindings
    ? criticalCount > 0 ? "var(--error)" : "var(--warning)"
    : "var(--text-muted)";

  const sortedFindings = [...findings].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  return (
    <div style={{ marginTop: variant === "inspector" ? 0 : "20px" }}>
      <div
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          userSelect: "none",
          padding: "8px 0",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: headerColor,
          }}
        >
          SUPPLY CHAIN
        </span>

        {isScanning && (
          <div
            ref={dotRef}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
        )}

        {hasFindings && (
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "9px",
              letterSpacing: "1px",
              color: headerColor,
              background: "var(--bg-elevated)",
              padding: "1px 6px",
              borderRadius: "3px",
              border: `1px solid ${headerColor}`,
            }}
          >
            {findingCount} FINDING{findingCount !== 1 ? "S" : ""}
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onTriggerScan?.("project");
          }}
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            letterSpacing: "1px",
            textTransform: "uppercase",
            background: "transparent",
            color: isScanning ? "var(--text-muted)" : "var(--accent)",
            border: `1px solid ${isScanning ? "var(--border)" : "var(--accent-dim)"}`,
            borderRadius: "4px",
            padding: "4px 12px",
            cursor: isScanning ? "not-allowed" : "pointer",
            marginLeft: "auto",
            opacity: isScanning ? 0.5 : 1,
          }}
        >
          {isScanning ? "SCANNING..." : "SCAN"}
        </button>

        <span
          style={{
            fontSize: "9px",
            color: "var(--text-muted)",
            transition: "transform 0.2s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 0" }}>
          {sortedFindings.length === 0 && !isScanning && (
            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "11px",
                color: "var(--text-muted)",
                padding: "16px 0",
                textAlign: "center",
              }}
            >
              {scans.length === 0
                ? "No scans yet — click SCAN to check for compromised packages"
                : "No findings — all packages look clean"}
            </div>
          )}

          {isScanning && sortedFindings.length === 0 && (
            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "11px",
                color: "var(--accent)",
                padding: "16px 0",
                textAlign: "center",
                letterSpacing: "1px",
              }}
            >
              SCANNING PACKAGES...
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sortedFindings.map((finding) => {
              const cfg = severityConfig[finding.severity] || severityConfig.medium;
              return (
                <div
                  key={finding.id}
                  style={{
                    background: cfg.bg,
                    border: `1px solid var(--border)`,
                    borderLeft: `3px solid ${cfg.color}`,
                    borderRadius: "6px",
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "9px",
                        letterSpacing: "1.5px",
                        textTransform: "uppercase",
                        color: cfg.color,
                        background: "var(--bg-elevated)",
                        padding: "2px 6px",
                        borderRadius: "3px",
                      }}
                    >
                      {cfg.label}
                    </span>
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "12px",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {finding.packageName}@{finding.version}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      marginBottom: "6px",
                    }}
                  >
                    {finding.catalogName || finding.evidence}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Tag label={finding.ecosystem} />
                    <Tag label={finding.sourceType.replace(/_/g, " ")} />
                    <Tag label={finding.confidence} />
                  </div>
                </div>
              );
            })}
          </div>

          {latestScan?.summary && (
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginTop: "12px",
                padding: "8px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: "10px",
                  color: "var(--text-muted)",
                }}
              >
                {latestScan.summary.totalPackages} packages
              </span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: "10px",
                  color: "var(--text-muted)",
                }}
              >
                {latestScan.summary.ecosystems.join(", ")}
              </span>
              {latestScan.completedAt && (
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    marginLeft: "auto",
                  }}
                >
                  {formatTimeAgo(latestScan.completedAt)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: "9px",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        background: "var(--bg-elevated)",
        padding: "1px 6px",
        borderRadius: "3px",
        border: "1px solid var(--border)",
      }}
    >
      {label}
    </span>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
