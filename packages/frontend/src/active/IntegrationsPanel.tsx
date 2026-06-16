import { useEffect, useState } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { getPinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";
import { TabBar } from "./TabBar";
import { PinyxConnectionTab } from "./PinyxConnectionTab";
import { PinyxModelsTab } from "./PinyxModelsTab";
import { PinyxKeysTab } from "./PinyxKeysTab";
import { setSessionState } from "../lib/sessionState";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
  onPinyxConfigUpdate?: () => void;
  initialPinyxTab?: string;
}

const PINYX_TABS = [
  { id: "connection", label: "Connection" },
  { id: "models", label: "Models" },
  { id: "keys", label: "Keys" },
];

export function IntegrationsPanel({ open, github, onClose, onPinyxConfigUpdate, initialPinyxTab }: IntegrationsPanelProps) {
  const [connecting, setConnecting] = useState(false);
  const [pinyxTab, setPinyxTab] = useState(initialPinyxTab ?? "connection");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxLoading, setPinyxLoading] = useState(false);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPinyxLoading(true);
    setPinyxError(null);
    getPinyxConfig()
      .then(setPinyx)
      .catch(() => setPinyxError("Failed to load PiNyx config"))
      .finally(() => setPinyxLoading(false));
  }, [open]);

  useEffect(() => {
    if (open) setPinyxTab(initialPinyxTab ?? "connection");
  }, [open, initialPinyxTab]);

  if (!open) return null;

  function handlePinyxConfigUpdate(config: PinyxConfigResponse) {
    setPinyx(config);
    onPinyxConfigUpdate?.();
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      setSessionState("integrations_return", { open: true, pinyxTab });
      await github.connect();
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
              <p className="pinyx-section-desc">Sign in with the Aurex GitHub App.</p>
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
            <button
              className="pinyx-btn-primary"
              onClick={() => void handleConnect()}
              disabled={connecting}
            >
              {connecting ? "Opening GitHub..." : "Login with GitHub"}
            </button>
          )}

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

          {github.config && !github.config.has_client_secret && (
            <p style={{ color: "var(--warning)", fontSize: "12px", marginTop: "8px" }}>
              Server needs GITHUB_CLIENT_SECRET set for the Aurex GitHub App.
            </p>
          )}

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

          {pinyxLoading && !pinyx && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: "8px" }}>↻</span>
              Loading PiNyx config...
            </div>
          )}

          {pinyx && (
            // Keep all three tabs mounted and toggle visibility via CSS so that
            // unsaved edits (draft keys, model overrides, gateway test results)
            // are not discarded when the user switches tabs. Previously each
            // tab unmounted on switch, wiping local component state.
            <>
              <div style={{ display: pinyxTab === "connection" ? "block" : "none" }}>
                <PinyxConnectionTab config={pinyx} onConfigUpdate={handlePinyxConfigUpdate} />
              </div>
              <div style={{ display: pinyxTab === "models" ? "block" : "none" }}>
                <PinyxModelsTab config={pinyx} onConfigUpdate={handlePinyxConfigUpdate} />
              </div>
              <div style={{ display: pinyxTab === "keys" ? "block" : "none" }}>
                <PinyxKeysTab config={pinyx} onConfigUpdate={handlePinyxConfigUpdate} />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
