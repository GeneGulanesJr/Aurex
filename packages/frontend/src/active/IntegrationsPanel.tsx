import { useState, useEffect } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { getPinyxConfig } from "../api";
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
  const [patInput, setPatInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  const [pinyxTab, setPinyxTab] = useState("connection");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getPinyxConfig().then(setPinyx).catch(() => setPinyxError("Failed to load PiNyx config"));
  }, [open]);

  useEffect(() => {
    if (open) { setPinyxTab("connection"); setPatInput(""); setPatError(null); }
  }, [open]);

  if (!open) return null;

  async function handleConnect() {
    if (!patInput.trim()) return;
    setConnecting(true);
    setPatError(null);
    try {
      await github.connect(patInput.trim());
      setPatInput("");
    } catch (err) {
      setPatError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

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
                {github.connected
                  ? "Connected to GitHub."
                  : "Paste a Personal Access Token to connect."}
              </p>
            </div>
            <span style={{
              color: github.connected ? "var(--success)" : "var(--text-muted)",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
            }}>
              {github.connected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>

          {github.connected && github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          {!github.connected && (
            <>
              <label className="pinyx-label">Personal Access Token</label>
              <input
                value={patInput}
                onChange={(e) => { setPatInput(e.target.value); setPatError(null); }}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                type="password"
                className="pinyx-input"
                onKeyDown={(e) => { if (e.key === "Enter" && patInput.trim()) void handleConnect(); }}
              />
              <button
                onClick={() => void handleConnect()}
                disabled={connecting || !patInput.trim()}
                className="pinyx-btn-primary"
                style={{ marginTop: "8px" }}
              >
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </>
          )}

          {(patError || github.error) && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{patError ?? github.error}</p>}

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
