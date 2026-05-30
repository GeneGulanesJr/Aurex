import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
}

export function IntegrationsPanel({ open, github, onClose }: IntegrationsPanelProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("http://localhost:8080/api/github/callback");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(github.config?.clientId ?? "");
    setCallbackUrl(github.config?.callbackUrl ?? "http://localhost:8080/api/github/callback");
    setClientSecret("");
  }, [open, github.config?.clientId, github.config?.callbackUrl]);

  if (!open) return null;

  const canSave = clientId.trim().length > 0 && clientSecret.trim().length > 0 && callbackUrl.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await github.saveConfig({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        callbackUrl: callbackUrl.trim(),
      });
      setClientSecret("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <section
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "420px",
          height: "100%",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-24px 0 80px rgba(0,0,0,0.35)",
          padding: "16px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase" }}>
              Integrations
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "12px" }}>
              Configure services Aurex can use.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "18px" }}>×</button>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>GitHub</h3>
              <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                OAuth app credentials, repo access, and account connection.
              </p>
            </div>
            <span style={{ color: github.connected ? "var(--success)" : github.configured ? "var(--warning)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
              {github.connected ? "CONNECTED" : github.configured ? "CONFIGURED" : "OFFLINE"}
            </span>
          </div>

          {github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          <label style={labelStyle}>Client ID</label>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="GitHub OAuth Client ID" style={inputStyle} />

          <label style={labelStyle}>Client Secret</label>
          <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={github.config?.hasClientSecret ? "Saved — enter new secret to replace" : "GitHub OAuth Client Secret"} type="password" style={inputStyle} />

          <label style={labelStyle}>Callback URL</label>
          <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} style={inputStyle} />

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px" }}>{github.error}</p>}

          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={handleSave} disabled={!canSave || saving} style={buttonStyle(canSave && !saving)}>
              {saving ? "Saving..." : "Save GitHub App"}
            </button>
            <button onClick={() => void github.connect()} disabled={!github.configured} style={outlineButtonStyle(github.configured)}>
              Connect
            </button>
            {github.connected && (
              <button onClick={() => void github.disconnect()} style={dangerButtonStyle}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  color: "var(--text-muted)",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "1px",
  marginTop: "10px",
  marginBottom: "4px",
  textTransform: "uppercase",
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  padding: "8px",
  fontSize: "12px",
  outline: "none",
};

const buttonStyle = (enabled: boolean): CSSProperties => ({
  background: enabled ? "var(--accent)" : "var(--bg-elevated)",
  color: enabled ? "var(--bg-deep)" : "var(--text-muted)",
  border: "none",
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: enabled ? "pointer" : "default",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
});

const outlineButtonStyle = (enabled: boolean): CSSProperties => ({
  background: "transparent",
  color: enabled ? "var(--accent)" : "var(--text-muted)",
  border: `1px solid ${enabled ? "var(--accent-dim)" : "var(--border)"}`,
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: enabled ? "pointer" : "default",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
});

const dangerButtonStyle: CSSProperties = {
  background: "transparent",
  color: "var(--error)",
  border: "1px solid rgba(239, 68, 68, 0.4)",
  borderRadius: "4px",
  padding: "8px 10px",
  cursor: "pointer",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  textTransform: "uppercase",
};
