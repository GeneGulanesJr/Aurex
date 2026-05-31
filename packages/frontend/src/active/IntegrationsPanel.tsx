import { useState, useEffect } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { saveGitHubConfig, getPinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";
import { TabBar } from "./TabBar";
import { PinyxConnectionTab } from "./PinyxConnectionTab";
import { PinyxModelsTab } from "./PinyxModelsTab";
import { PinyxKeysTab } from "./PinyxKeysTab";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
}

const PINYX_TABS = [
  { id: "connection", label: "Connection" },
  { id: "models", label: "Models" },
  { id: "keys", label: "Keys" },
];

export function IntegrationsPanel({ open, github, onClose }: IntegrationsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:5173");

  const [pinyxTab, setPinyxTab] = useState("connection");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getPinyxConfig().then(setPinyx).catch(() => setPinyxError("Failed to load PiNyx config"));
  }, [open]);

  useEffect(() => {
    if (open) { setEditing(false); setPinyxTab("connection"); }
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
      window.location.reload();
    } catch {
      // Error surfaces via config state
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    await github.connect();
  }

  const configured = github.config?.configured ?? false;
  const showConfigForm = !configured || editing;

  return (
    <div className="integrations-drawer" onClick={onClose}>
      <section className="integrations-drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="integrations-drawer-header">
          <div>
            <h2 className="integrations-drawer-title">Integrations</h2>
            <p className="integrations-drawer-subtitle">Configure services Aurex can use.</p>
          </div>
          <button className="integrations-drawer-close" onClick={onClose}>×</button>
        </div>

        {/* GitHub Section */}
        <div className="pinyx-section">
          <div className="pinyx-section-header">
            <div>
              <h3 className="pinyx-section-title">GitHub</h3>
              <p className="pinyx-section-desc">
                {showConfigForm
                  ? "Register a GitHub App at github.com/settings/developers"
                  : "Connect via GitHub App OAuth."}
              </p>
            </div>
            <span style={{
              color: github.connected ? "var(--success)" : configured ? "var(--accent)" : "var(--text-muted)",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
            }}>
              {github.connected ? "CONNECTED" : configured ? "CONFIGURED" : "OFFLINE"}
            </span>
          </div>

          {github.connected && github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          {showConfigForm && (
            <>
              <label className="pinyx-label">App ID</label>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456" className="pinyx-input" />

              <label className="pinyx-label">Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Iv1.xxxxx" className="pinyx-input" />

              <label className="pinyx-label">Client Secret</label>
              <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GitHub App client secret" type="password" className="pinyx-input" />

              <label className="pinyx-label">Private Key (.pem)</label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                className="pinyx-input"
                style={{ minHeight: "80px", resize: "vertical" }}
              />

              <label className="pinyx-label">Callback URL</label>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="http://localhost:3000/api/github/callback" className="pinyx-input" />

              <label className="pinyx-label">Frontend URL</label>
              <input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} placeholder="http://localhost:5173" className="pinyx-input" />

              <button
                onClick={() => void handleSaveConfig()}
                disabled={saving || !appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()}
                className="pinyx-btn-primary"
                style={{ marginTop: "8px" }}
              >
                {saving ? "Saving..." : editing ? "Update Configuration" : "Save Configuration"}
              </button>
            </>
          )}

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
                <div className="pinyx-btn-group">
                  <button className="pinyx-btn-outline" onClick={() => setEditing(true)}>Edit</button>
                  <button className="pinyx-btn-primary" onClick={() => void handleConnect()}>Connect</button>
                </div>
              )}
            </>
          )}

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

          {github.connected && (
            <button className="pinyx-btn-danger" style={{ marginTop: "8px" }} onClick={() => void github.disconnect()}>
              Disconnect
            </button>
          )}
        </div>

        {/* PiNyx Section — tabbed */}
        <div style={{ marginTop: "16px" }}>
          <TabBar tabs={PINYX_TABS} active={pinyxTab} onChange={setPinyxTab} />

          {pinyxError && (
            <div className="pinyx-error-bar">
              <span>{pinyxError}</span>
              <button className="pinyx-error-bar-close" onClick={() => setPinyxError(null)}>×</button>
            </div>
          )}

          {pinyx && pinyxTab === "connection" && (
            <PinyxConnectionTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
          {pinyx && pinyxTab === "models" && (
            <PinyxModelsTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
          {pinyx && pinyxTab === "keys" && (
            <PinyxKeysTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
        </div>
      </section>
    </div>
  );
}
