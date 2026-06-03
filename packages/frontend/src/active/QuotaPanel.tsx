import { useState, useCallback } from "react";
import { useQuota } from "../hooks/useQuota";
import { calculatePrefire } from "../api";
import type { QuotaStatus } from "@aurex/shared";

interface QuotaPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "--";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  unlimited: { color: "var(--text-muted)", label: "UNLIMITED" },
  active: { color: "var(--accent)", label: "ACTIVE" },
  exhausted: { color: "var(--error, #ef4444)", label: "EXHAUSTED" },
  window_expired: { color: "var(--warning, #eab308)", label: "WINDOW EXPIRED" },
};

export function QuotaPanel({ open, onClose }: QuotaPanelProps) {
  const { status, loading, prefire, reset, refresh } = useQuota();
  const [prefireTime, setPrefireTime] = useState("");
  const [prefireResult, setPrefireResult] = useState<Array<{ time: string; event: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handlePrefire = useCallback(async () => {
    setError(null);
    setPrefireResult(null);
    try {
      await prefire();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prefire failed");
    }
  }, [prefire]);

  const handleCalculate = useCallback(async () => {
    if (!prefireTime) return;
    setError(null);
    try {
      const result = await calculatePrefire({ desiredStartTime: prefireTime });
      setPrefireResult(result.timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    }
  }, [prefireTime]);

  const handleReset = useCallback(async () => {
    setError(null);
    try {
      await reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }, [reset]);

  if (!open) return null;

  const statusInfo = STATUS_STYLES[status?.status ?? "unlimited"] ?? STATUS_STYLES.unlimited;
  const burnProgress = status?.burnDurationMs && isFinite(status.remainingBurnMs) && status.burnDurationMs > 0
    ? Math.max(0, Math.min(100, ((status.burnDurationMs - status.remainingBurnMs) / status.burnDurationMs) * 100))
    : 0;

  return (
    <div className="integrations-drawer" onClick={handleBackdrop}>
      <div className="integrations-drawer-content" style={{ maxWidth: "420px" }}>
        <div className="integrations-drawer-header">
          <div>
            <h2 className="integrations-drawer-title">Coding Plan</h2>
            <p className="integrations-drawer-subtitle">5-hour quota window management</p>
          </div>
          <button className="integrations-drawer-close" onClick={onClose}>✕</button>
        </div>

        {loading && !status ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
            Loading quota status...
          </div>
        ) : (
          <>
            {!status?.enabled ? (
              <div style={{ padding: "16px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Quota enforcement is <strong style={{ color: "var(--text-primary)" }}>disabled</strong>.
                  Enable it by setting <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: "3px" }}>QUOTA_ENABLED=true</code> in your environment.
                </div>
              </div>
            ) : (
              <>
                <div className="pinyx-section">
                  <div className="pinyx-section-header">
                    <div>
                      <h3 className="pinyx-section-title">Status</h3>
                    </div>
                    <span style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "1px",
                      color: statusInfo.color,
                      background: `${statusInfo.color}15`,
                      padding: "3px 8px",
                      borderRadius: "3px",
                    }}>
                      {statusInfo.label}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                    <MetricBox label="Window Start" value={formatTime(status.windowStart)} />
                    <MetricBox label="Window End" value={formatTime(status.windowEnd)} />
                    <MetricBox label="First LLM Call" value={formatTime(status.firstLLMCallAt)} />
                    <MetricBox label="Burn Expires" value={formatTime(status.burnExpiresAt)} />
                    <MetricBox label="Remaining Burn" value={formatDuration(status.remainingBurnMs)} />
                    <MetricBox label="Window Resets In" value={formatDuration(status.remainingWindowMs)} />
                  </div>

                  {status.firstLLMCallAt && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>
                        Burn: {Math.round(burnProgress)}% used
                      </div>
                      <div style={{
                        height: "4px",
                        background: "var(--border)",
                        borderRadius: "2px",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%",
                          width: `${burnProgress}%`,
                          background: burnProgress > 80 ? "var(--error, #ef4444)" : "var(--accent)",
                          borderRadius: "2px",
                          transition: "width 0.3s",
                        }} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="pinyx-section">
                  <div className="pinyx-section-header">
                    <div>
                      <h3 className="pinyx-section-title">Prefire</h3>
                      <p className="pinyx-section-desc">Start a new 5-hour window now</p>
                    </div>
                  </div>

                  <button
                    onClick={handlePrefire}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: "4px",
                      color: "var(--bg)",
                      cursor: "pointer",
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "8px 16px",
                      width: "100%",
                      marginBottom: "12px",
                    }}
                  >
                    Prefire Now
                  </button>

                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>
                    Calculate optimal prefire time for your desired coding start:
                  </div>

                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={prefireTime}
                      onChange={(e) => setPrefireTime(e.target.value)}
                      style={{
                        flex: 1,
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "11px",
                        padding: "6px 8px",
                      }}
                    />
                    <button
                      onClick={handleCalculate}
                      disabled={!prefireTime}
                      style={{
                        background: prefireTime ? "var(--accent)" : "var(--border)",
                        border: "none",
                        borderRadius: "4px",
                        color: prefireTime ? "var(--bg)" : "var(--text-muted)",
                        cursor: prefireTime ? "pointer" : "default",
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "10px",
                        padding: "6px 12px",
                      }}
                    >
                      Calculate
                    </button>
                  </div>

                  {prefireResult && (
                    <div style={{ marginTop: "12px", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "6px" }}>Timeline:</div>
                      {prefireResult.map((entry, i) => (
                        <div key={i} style={{ display: "flex", gap: "8px", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                            {(() => { try { return formatTime(entry.time); } catch { return entry.time; } })()}
                          </span>
                          <span style={{ color: "var(--text-primary)" }}>{entry.event}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pinyx-section">
                  <div className="pinyx-section-header">
                    <div>
                      <h3 className="pinyx-section-title">Reset</h3>
                      <p className="pinyx-section-desc">Force-start a fresh quota window</p>
                    </div>
                  </div>
                  <button
                    onClick={handleReset}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "10px",
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      padding: "8px 16px",
                      width: "100%",
                    }}
                  >
                    Reset Window
                  </button>
                </div>

                {error && (
                  <div style={{ padding: "8px 12px", background: "var(--error, #ef4444)15", borderRadius: "4px", color: "var(--error, #ef4444)", fontSize: "11px", marginTop: "8px" }}>
                    {error}
                  </div>
                )}

                <button
                  onClick={refresh as unknown as () => void}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "10px",
                    padding: "8px 0",
                    width: "100%",
                    textAlign: "center",
                  }}
                >
                  Refresh
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "var(--bg-elevated)",
      borderRadius: "4px",
      padding: "8px 10px",
    }}>
      <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </div>
      <div style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}
