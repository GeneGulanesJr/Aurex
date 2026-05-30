import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { saveGitHubConfig } from "../api";
import { getPinyxConfig, getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
}

export function IntegrationsPanel({ open, github, onClose }: IntegrationsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:5173");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxModels, setPinyxModels] = useState<Array<{ id?: string; name?: string }>>([]);
  const [pinyxSaving, setPinyxSaving] = useState(false);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getPinyxConfig().then(setPinyx).catch(() => setPinyxError("Failed to load PiNyx config"));
    getPinyxModels().then((res) => setPinyxModels(res.models)).catch(() => setPinyxModels([]));
  }, [open]);

  // Reset editing state when panel opens
  useEffect(() => {
    if (open) setEditing(false);
  }, [open]);

  if (!open) return null;

  async function handleSaveConfig() {
    if (!appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()) return;
    setSaving(true);
    try {
      await saveGitHubConfig({
        appId: appId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        privateKey: privateKey.trim(),
        callbackUrl: callbackUrl.trim(),
        frontendUrl: frontendUrl.trim(),
      });
      setEditing(false);
      // Trigger status refresh by reloading page state
      window.location.reload();
    } catch {
      // Error will surface via config state
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    await github.connect();
  }

  async function handleSavePinyx() {
    if (!pinyx) return;
    setPinyxSaving(true);
    setPinyxError(null);
    try {
      const saved = await savePinyxConfig(pinyx);
      setPinyx(saved);
      const models = await getPinyxModels().catch(() => ({ models: [] }));
      setPinyxModels(models.models);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save PiNyx config";
      setPinyxError(msg.includes("502") || msg.includes("Failed") ? "PiNyx endpoint is unreachable" : msg);
    } finally {
      setPinyxSaving(false);
    }
  }

  function setHint(key: string, value: string) {
    if (!pinyx) return;
    setPinyx({ ...pinyx, modelHints: { ...pinyx.modelHints, [key]: value } });
  }

  function setProviderField(index: number, field: "id" | "name" | "baseUrl" | "apiKey", value: string) {
    if (!pinyx) return;
    const providers = [...pinyx.providers];
    providers[index] = { ...providers[index], [field]: value };
    setPinyx({ ...pinyx, providers });
  }

  function addProvider() {
    if (!pinyx) return;
    setPinyx({ ...pinyx, providers: [...pinyx.providers, { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "" }] });
  }

  // Derive GitHub section state
  const configured = github.config?.configured ?? false;
  const showConfigForm = !configured || editing;

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

        {/* GitHub Section */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>GitHub</h3>
              <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                {showConfigForm
                  ? "Register a GitHub App at github.com/settings/developers"
                  : "Connect via GitHub App OAuth."}
              </p>
            </div>
            <span style={{ color: github.connected ? "var(--success)" : configured ? "var(--accent)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
              {github.connected ? "CONNECTED" : configured ? "CONFIGURED" : "OFFLINE"}
            </span>
          </div>

          {/* Connected: show user */}
          {github.connected && github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          {/* Config form (unconfigured or editing) */}
          {showConfigForm && (
            <>
              <label style={labelStyle}>App ID</label>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456" style={inputStyle} />

              <label style={labelStyle}>Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Iv1.xxxxx" style={inputStyle} />

              <label style={labelStyle}>Client Secret</label>
              <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GitHub App client secret" type="password" style={inputStyle} />

              <label style={labelStyle}>Private Key (.pem)</label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}
              />

              <label style={labelStyle}>Callback URL</label>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="http://localhost:3000/api/github/callback" style={inputStyle} />

              <label style={labelStyle}>Frontend URL</label>
              <input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} placeholder="http://localhost:5173" style={inputStyle} />

              <button
                onClick={() => void handleSaveConfig()}
                disabled={saving || !appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()}
                style={buttonStyle(!!appId.trim() && !!clientId.trim() && !!clientSecret.trim() && !!callbackUrl.trim() && !!frontendUrl.trim() && !saving)}
              >
                {saving ? "Saving..." : editing ? "Update Configuration" : "Save Configuration"}
              </button>
            </>
          )}

          {/* Configured but not editing: show summary + actions */}
          {configured && !showConfigForm && (
            <>
              <div style={{ padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px", marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Client ID</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.client_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Callback</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.callback_url}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Secrets</span>
                  <span style={{ color: "var(--success)", fontSize: "11px" }}>✓ Saved</span>
                </div>
              </div>

              {!github.connected && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setEditing(true)} style={outlineButtonStyle(true)}>Edit</button>
                  <button onClick={() => void handleConnect()} style={buttonStyle(true)}>Connect</button>
                </div>
              )}
            </>
          )}

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

          {github.connected && (
            <button onClick={() => void github.disconnect()} style={dangerButtonStyle}>
              Disconnect
            </button>
          )}
        </div>

        {/* PiNyx Section — unchanged */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "12px", background: "var(--bg-inset)", marginTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", letterSpacing: "1px" }}>PiNyx</h3>
              <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                Configure gateway endpoint, model routing, and provider keys.
              </p>
            </div>
            <span style={{ color: pinyx ? "var(--success)" : "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" }}>
              {pinyx ? "CONFIGURED" : "LOADING"}
            </span>
          </div>

          {pinyx && (
            <>
              <label style={labelStyle}>PiNyx Endpoint</label>
              <input value={pinyx.endpoint} onChange={(e) => setPinyx({ ...pinyx, endpoint: e.target.value })} style={inputStyle} />

              <label style={labelStyle}>Model Routing</label>
              {Object.entries(pinyx.modelHints).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>{key}</span>
                  <input list="pinyx-models" value={value} onChange={(e) => setHint(key, e.target.value)} style={inputStyle} />
                </div>
              ))}
              <datalist id="pinyx-models">
                {pinyxModels.map((model, index) => (
                  <option key={`${model.id ?? model.name ?? index}`} value={model.id ?? model.name ?? ""} />
                ))}
              </datalist>

              <label style={labelStyle}>Providers</label>
              {pinyx.providers.map((provider, index) => (
                <div key={`${provider.id}-${index}`} style={{ border: "1px solid var(--border)", borderRadius: "4px", padding: "8px", marginBottom: "8px", background: "var(--bg-surface)" }}>
                  <input value={provider.id} onChange={(e) => setProviderField(index, "id", e.target.value)} placeholder="provider id" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.name} onChange={(e) => setProviderField(index, "name", e.target.value)} placeholder="display name" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.baseUrl} onChange={(e) => setProviderField(index, "baseUrl", e.target.value)} placeholder="base URL" style={{ ...inputStyle, marginBottom: "6px" }} />
                  <input value={provider.apiKey ?? ""} onChange={(e) => setProviderField(index, "apiKey", e.target.value)} placeholder={provider.hasApiKey ? "Saved — enter new key to replace" : "API key"} type="password" style={inputStyle} />
                </div>
              ))}
              <button onClick={addProvider} style={outlineButtonStyle(true)}>+ Add Provider</button>

              {pinyxError && <p style={{ color: "var(--error)", fontSize: "12px" }}>{pinyxError}</p>}
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button onClick={handleSavePinyx} disabled={pinyxSaving} style={buttonStyle(!pinyxSaving)}>
                  {pinyxSaving ? "Saving..." : "Save PiNyx"}
                </button>
                <button onClick={() => getPinyxModels().then((res) => setPinyxModels(res.models)).catch(() => setPinyxError("Failed to fetch models"))} style={outlineButtonStyle(true)}>
                  Refresh Models
                </button>
              </div>
            </>
          )}
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
  boxSizing: "border-box",
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
  marginTop: "8px",
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
  marginTop: "8px",
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
  marginTop: "8px",
};
