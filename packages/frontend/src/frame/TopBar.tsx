import { ThemePicker } from "./ThemePicker";
import type { ThemeId } from "../hooks/useTheme";

interface TopBarProps {
  connected: boolean;
  missionCount: number;
  uptime: string;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  githubUser?: { login: string; avatar_url: string } | null;
  pinyxConfigured?: boolean;
  onOpenIntegrations?: () => void;
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

export function TopBar({ connected, missionCount, uptime, theme, onThemeChange, githubUser, pinyxConfigured, onOpenIntegrations }: TopBarProps) {
  const dotColor = connected ? "var(--success)" : "var(--error)";
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: "44px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
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
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          v0.1.0
        </span>
      </div>

      {/* Center: Connection status */}
      <div style={{ display: "flex", gap: "20px" }}>
        <StatusItem color={connected ? "var(--success)" : "var(--error)"} label="LAPIS CONNECTED" />
        <button
          onClick={onOpenIntegrations}
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
          title="Open PiNyx settings"
        >
          <StatusItem color={pinyxConfigured ? "var(--success)" : "var(--warning)"} label={pinyxConfigured ? "PINYX CONNECTED" : "PINYX OFFLINE"} />
        </button>
        <StatusItem color={connected ? "var(--success)" : "var(--warning)"} label="SYSTEMS NOMINAL" />
      </div>

      {/* Right: Uptime + theme picker */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        <span>UPTIME <span style={{ color: "var(--accent)", fontWeight: 500 }}>{uptime}</span></span>
        <span>MISSIONS <span style={{ color: "var(--accent)", fontWeight: 500 }}>{missionCount}</span> ACTIVE</span>
        <button
          onClick={onOpenIntegrations}
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
        <ThemePicker current={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}
