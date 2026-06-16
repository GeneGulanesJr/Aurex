import { ThemePicker } from "./ThemePicker";
import type { ThemeId } from "../hooks/useTheme";
import type { UpdateStatus } from "../hooks/useUpdateStatus";

interface TopBarProps {
  connected: boolean;
  missionCount: number;
  uptime: string;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  githubUser?: { login: string; avatar_url: string } | null;
  pinyxConfigured?: boolean;
  systemReady?: boolean;
  onOpenIntegrations?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onOpenQuota?: () => void;
  quotaStatus?: string | null;
  updateStatus?: UpdateStatus | null;
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );
}

function StatusItem({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: "11px",
        textTransform: "uppercase" as const,
        letterSpacing: "1px",
        color: "var(--text-secondary)",
      }}
    >
      <StatusDot color={color} />
      {label}
    </span>
  );
}

export function TopBar({ connected, missionCount, uptime, theme, onThemeChange, githubUser, pinyxConfigured, systemReady, onOpenIntegrations, sidebarCollapsed, onToggleSidebar, onOpenSettings, onOpenQuota, quotaStatus, updateStatus }: TopBarProps) {
  const dotColor = connected ? "var(--success)" : "var(--error)";
  return (
    <header
      className="top-bar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px",
        minHeight: "48px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        gap: "14px",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 10px 30px rgba(0,0,0,0.16)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              padding: 0,
              flexShrink: 0,
            }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? "»" : "☰"}
          </button>
        )}
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 700,
            fontSize: "14px",
            letterSpacing: "3px",
            color: "var(--accent)",
            textShadow: "0 0 20px var(--accent-glow)",
          }}
        >
          AUREX
        </span>
        <span
          className="hide-on-mobile"
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          v0.1.0
        </span>
      </div>

      <div className="top-bar-status hide-on-mobile" style={{ display: "flex", gap: "20px" }}>
        <StatusItem color={connected ? "var(--success)" : "var(--error)"} label="LAPIS CONNECTED" />
        <button
          onClick={onOpenIntegrations}
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
          title="Open PiNyx settings"
        >
          <StatusItem color={pinyxConfigured ? "var(--success)" : "var(--warning)"} label={pinyxConfigured ? "PINYX CONNECTED" : "PINYX OFFLINE"} />
        </button>
        <StatusItem color={systemReady ? "var(--success)" : connected ? "var(--warning)" : "var(--error)"} label={systemReady ? "SYSTEMS NOMINAL" : connected ? "SYSTEMS DEGRADED" : "OFFLINE"} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        <span className="hide-on-mobile">UPTIME <span style={{ color: "var(--accent)", fontWeight: 500 }}>{uptime}</span></span>
        <span className="hide-on-tablet">MISSIONS <span style={{ color: "var(--accent)", fontWeight: 500 }}>{missionCount}</span> ACTIVE</span>
        <button
          onClick={onOpenIntegrations}
          className="hide-on-mobile"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: githubUser ? "var(--text-secondary)" : "var(--text-muted)",
            cursor: "pointer",
            padding: "3px 6px",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "11px",
          }}
          title="Open integrations"
        >
          {githubUser ? (
            <>
              <img
                src={githubUser.avatar_url}
                alt={githubUser.login}
                style={{ width: "18px", height: "18px", borderRadius: "50%" }}
              />
              <span>{githubUser.login}</span>
            </>
          ) : (
            <span>GITHUB —</span>
          )}
        </button>
        {onOpenQuota && (
          <button
            onClick={onOpenQuota}
            className="hide-on-mobile"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: quotaStatus === "exhausted" ? "var(--error, #ef4444)" : quotaStatus === "active" ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "3px 8px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "0.5px",
            }}
            title="Coding Plan"
          >
            <span style={{ fontSize: "8px", letterSpacing: "1px" }}>QUOTA</span>
            {quotaStatus === "exhausted" && <StatusDot color="var(--error, #ef4444)" />}
            {quotaStatus === "active" && <StatusDot color="var(--accent)" />}
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-muted)",
              cursor: "pointer",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              padding: 0,
              flexShrink: 0,
            }}
            title="Settings"
          >
            ⚙
          </button>
        )}
        {updateStatus && (updateStatus.updateAvailable || updateStatus.applying) && (
          <button
            onClick={updateStatus.applying ? undefined : updateStatus.apply}
            className="hide-on-mobile"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: updateStatus.applying ? "var(--text-muted)" : "var(--success)",
              cursor: updateStatus.applying ? "wait" : "pointer",
              padding: "3px 8px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "0.5px",
            }}
            title={updateStatus.applying ? "Updating..." : `${updateStatus.behindBy} commit(s) behind`}
          >
            {updateStatus.applying ? (
              <>
                <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span>
                <span style={{ fontSize: "8px", letterSpacing: "1px" }}>UPDATING</span>
              </>
            ) : (
              <>
                <span style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "var(--success)",
                  boxShadow: "0 0 6px var(--success)",
                  animation: "pulse-dot 2s ease-in-out infinite",
                }} />
                <span style={{ fontSize: "8px", letterSpacing: "1px" }}>UPDATE</span>
              </>
            )}
          </button>
        )}
        <ThemePicker current={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}
