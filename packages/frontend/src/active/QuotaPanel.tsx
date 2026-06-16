import { useState, useCallback } from "react";
import type { QuotaState } from "../hooks/useQuota";
import { calculatePrefire } from "../api";
import type { QuotaProviderStatus } from "@aurex/shared";

interface QuotaPanelProps {
  open: boolean;
  onClose: () => void;
  quota: QuotaState;
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

export function QuotaPanel({ open, onClose, quota }: QuotaPanelProps) {
  const { status, loading, error: quotaError, prefire, reset, updateConfig, refresh } = quota;
  const [prefireTime, setPrefireTime] = useState("");
  const [prefireResult, setPrefireResult] = useState<Array<{ time: string; event: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleToggleEnabled = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await updateConfig({ enabled: !status?.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }, [status?.enabled, updateConfig]);

  const handleToggleProvider = useCallback(async (providerId: string, currentlyTracked: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const existingProviders = (status?.providers ?? [])
        .filter((p) => p.providerId !== "default")
        .map((p) => ({
          providerId: p.providerId,
          tracked: p.tracked,
          windowDurationMs: p.windowDurationMs || undefined,
          burnDurationMs: p.burnDurationMs || undefined,
        }));
      const idx = existingProviders.findIndex((p) => p.providerId === providerId);
      if (idx >= 0) {
        existingProviders[idx].tracked = !currentlyTracked;
      } else {
        existingProviders.push({ providerId, tracked: !currentlyTracked, windowDurationMs: undefined, burnDurationMs: undefined });
      }
      await updateConfig({ providers: existingProviders });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }, [status?.providers, updateConfig]);

  const handlePrefire = useCallback(async (providerId?: string) => {
    setError(null);
    setPrefireResult(null);
    setBusy(true);
    try {
      await prefire(providerId ? { providerId } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prefire failed");
    } finally {
      setBusy(false);
    }
  }, [prefire]);

  const handleCalculate = useCallback(async () => {
    if (!prefireTime) return;
    setError(null);
    setBusy(true);
    try {
      const result = await calculatePrefire({ desiredStartTime: prefireTime });
      setPrefireResult(result.timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    } finally {
      setBusy(false);
    }
  }, [prefireTime]);

  const handleReset = useCallback(async (providerId?: string) => {
    setError(null);
    setBusy(true);
    try {
      await reset(providerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }, [reset]);

  if (!open) return null;

  const providers = status?.providers ?? [];

  return (
    <div className="integrations-drawer" onClick={handleBackdrop}>
      <div className="integrations-drawer-content" style={{ maxWidth: "480px" }}>
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
        ) : quotaError && !status ? (
          <div style={{ padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "var(--error, #ef4444)", marginBottom: "12px" }}>{quotaError}</div>
            <button onClick={refresh} style={{ fontSize: "10px", color: "var(--accent)", background: "none", border: "1px solid var(--accent-dim)", borderRadius: "3px", cursor: "pointer", padding: "4px 12px", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "1px" }}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="pinyx-section">
              <div className="pinyx-section-header">
                <div>
                  <h3 className="pinyx-section-title">Global Toggle</h3>
                  <p className="pinyx-section-desc">Enable or disable quota enforcement</p>
                </div>
                <button
                  onClick={handleToggleEnabled}
                  disabled={busy}
                  style={{
                    background: status?.enabled ? "var(--accent)" : "var(--border)",
                    border: "none",
                    borderRadius: "4px",
                    color: status?.enabled ? "var(--bg)" : "var(--text-muted)",
                    cursor: busy ? "wait" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "10px",
                    fontWeight: 600,
                    padding: "6px 14px",
                    letterSpacing: "1px",
                  }}
                >
                  {busy ? "..." : status?.enabled ? "ENABLED" : "DISABLED"}
                </button>
              </div>
            </div>

            {!status?.enabled ? (
              <div style={{ padding: "0 16px 16px", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                Quota enforcement is <strong style={{ color: "var(--text-primary)" }}>disabled</strong>. Enable it above to manage per-provider quotas.
              </div>
            ) : (
              <>
                {providers.map((provider) => (
                  <ProviderCard
                    key={provider.providerId}
                    provider={provider}
                    busy={busy}
                    onToggle={() => handleToggleProvider(provider.providerId, provider.tracked)}
                    onPrefire={() => handlePrefire(provider.providerId)}
                    onReset={() => handleReset(provider.providerId)}
                  />
                ))}

                {providers.length === 0 && (
                  <div style={{ padding: "16px", fontSize: "12px", color: "var(--text-muted)" }}>
                    No providers configured yet. Configure PiNyx providers in the Integrations panel.
                  </div>
                )}
              </>
            )}

            <div className="pinyx-section">
              <div className="pinyx-section-header">
                <div>
                  <h3 className="pinyx-section-title">Prefire Calculator</h3>
                  <p className="pinyx-section-desc">Calculate optimal prefire time</p>
                </div>
              </div>

              <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>
                Calculate when to start your window for a desired coding time:
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

            {error && (
              <div style={{ padding: "8px 12px", background: "var(--error, #ef4444)15", borderRadius: "4px", color: "var(--error, #ef4444)", fontSize: "11px", marginTop: "8px" }}>
                {error}
              </div>
            )}

            <button
              onClick={refresh}
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
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onToggle,
  onPrefire,
  onReset,
}: {
  provider: QuotaProviderStatus;
  busy?: boolean;
  onToggle: () => void;
  onPrefire: () => void;
  onReset: () => void;
}) {
  const statusInfo = STATUS_STYLES[provider.status] ?? STATUS_STYLES.unlimited;
  const burnProgress = provider.burnDurationMs > 0 && isFinite(provider.remainingBurnMs)
    ? Math.max(0, Math.min(100, ((provider.burnDurationMs - provider.remainingBurnMs) / provider.burnDurationMs) * 100))
    : 0;

  return (
    <div className="pinyx-section">
      <div className="pinyx-section-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3 className="pinyx-section-title" style={{ marginBottom: 0 }}>
            {provider.providerId}
          </h3>
          <span style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "1px",
            color: statusInfo.color,
            background: `${statusInfo.color}15`,
            padding: "2px 6px",
            borderRadius: "3px",
          }}>
            {statusInfo.label}
          </span>
        </div>
        <button
          onClick={onToggle}
          disabled={busy}
          style={{
            background: provider.tracked ? "var(--accent)" : "var(--border)",
            border: "none",
            borderRadius: "4px",
            color: provider.tracked ? "var(--bg)" : "var(--text-muted)",
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.6 : 1,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            fontWeight: 600,
            padding: "4px 10px",
            letterSpacing: "0.5px",
          }}
        >
          {busy ? "..." : provider.tracked ? "TRACKED" : "UNTRACKED"}
        </button>
      </div>

      {provider.tracked && provider.enabled && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
            <MetricBox label="Window Start" value={formatTime(provider.windowStart)} />
            <MetricBox label="Window End" value={formatTime(provider.windowEnd)} />
            <MetricBox label="First LLM Call" value={formatTime(provider.firstLLMCallAt)} />
            <MetricBox label="Burn Expires" value={formatTime(provider.burnExpiresAt)} />
            <MetricBox label="Remaining Burn" value={formatDuration(provider.remainingBurnMs)} />
            <MetricBox label="Window Resets In" value={formatDuration(provider.remainingWindowMs)} />
          </div>

          {provider.firstLLMCallAt && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>
                Burn: {Math.round(burnProgress)}% used
              </div>
              <div style={{ height: "4px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
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

          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button
              onClick={onPrefire}
              disabled={busy}
              style={{
                flex: 1,
                background: "var(--accent)",
                border: "none",
                borderRadius: "4px",
                color: "var(--bg)",
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "10px",
                fontWeight: 600,
                padding: "6px 12px",
              }}
            >
              {busy ? "..." : "Prefire"}
            </button>
            <button
              onClick={onReset}
              disabled={busy}
              style={{
                flex: 1,
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text-muted)",
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "10px",
                padding: "6px 12px",
              }}
            >
              {busy ? "..." : "Reset"}
            </button>
          </div>
        </>
      )}

      {!provider.tracked && (
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
          This provider bypasses quota enforcement. Click TRACKED to enable.
        </div>
      )}
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
