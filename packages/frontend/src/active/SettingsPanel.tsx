import { useCallback } from "react";
import type { AurexSettings } from "../hooks/useSettings";

interface SettingsPanelProps {
  open: boolean;
  settings: AurexSettings;
  onSettingsChange: (next: Partial<AurexSettings>) => void;
  onReset: () => void;
  onClose: () => void;
}

export function SettingsPanel({ open, settings, onSettingsChange, onReset, onClose }: SettingsPanelProps) {
  if (!open) return null;

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="integrations-drawer" onClick={handleBackdrop}>
      <div className="integrations-drawer-content" style={{ maxWidth: "400px" }}>
        {/* Header */}
        <div className="integrations-drawer-header">
          <div>
            <h2 className="integrations-drawer-title">Settings</h2>
            <p className="integrations-drawer-subtitle">Configure your experience</p>
          </div>
          <button className="integrations-drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* Display section */}
        <div className="pinyx-section">
          <div className="pinyx-section-header">
            <div>
              <h3 className="pinyx-section-title">Display</h3>
              <p className="pinyx-section-desc">Control how information is shown</p>
            </div>
          </div>

          <ToggleRow
            label="Auto-collapse code context"
            description="Minimize the code context panel when a mission starts"
            checked={settings.autoCollapseContext}
            onChange={(v) => onSettingsChange({ autoCollapseContext: v })}
          />

          <ToggleRow
            label="Sidebar collapsed by default"
            description="Start with the sidebar in collapsed icon-rail mode on desktop"
            checked={settings.defaultSidebarCollapsed}
            onChange={(v) => onSettingsChange({ defaultSidebarCollapsed: v })}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text-primary)" }}>Event stream items</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>Number of events shown in the live feed</div>
            </div>
            <select
              value={settings.eventStreamCount}
              onChange={(e) => onSettingsChange({ eventStreamCount: Number(e.target.value) })}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text-primary)",
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "11px",
                padding: "4px 8px",
              }}
            >
              <option value={4}>4</option>
              <option value={8}>8</option>
              <option value={16}>16</option>
              <option value={32}>32</option>
            </select>
          </div>
        </div>

        {/* Notifications section */}
        <div className="pinyx-section">
          <div className="pinyx-section-header">
            <div>
              <h3 className="pinyx-section-title">Notifications</h3>
              <p className="pinyx-section-desc">Browser notification behavior</p>
            </div>
          </div>

          <ToggleRow
            label="Browser notifications"
            description="Show desktop notifications for escalations and mission completions"
            checked={settings.notificationsEnabled}
            onChange={(v) => onSettingsChange({ notificationsEnabled: v })}
          />
        </div>

        {/* Reset */}
        <button
          onClick={onReset}
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
            marginTop: "12px",
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ flex: 1, marginRight: "12px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-primary)" }}>{label}</div>
        <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: "36px",
          height: "20px",
          borderRadius: "10px",
          border: "none",
          cursor: "pointer",
          background: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: "var(--text-primary)",
          position: "absolute",
          top: "2px",
          left: checked ? "18px" : "2px",
          transition: "left 0.15s",
        }} />
      </button>
    </div>
  );
}
