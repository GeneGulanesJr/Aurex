interface TelemetryBarProps {
  tokens: number;
  cost: number;
  agentCount: number;
  wsConnected: boolean;
  memory?: string;
}

const monoLabel: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "0.5px",
  color: "var(--text-muted)",
};

export function TelemetryBar({ tokens, cost, agentCount, wsConnected, memory }: TelemetryBarProps) {
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: "36px",
        background: "var(--bg-inset)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", gap: "20px" }}>
        <span style={monoLabel}>
          TOKENS <span style={{ color: "var(--text-secondary)" }}>{tokens.toLocaleString()}</span>
        </span>
        <span style={monoLabel}>
          COST <span style={{ color: "var(--accent)", fontWeight: 500 }}>${cost.toFixed(2)}</span>
        </span>
        <span style={monoLabel}>
          AGENTS <span style={{ color: "var(--text-secondary)" }}>{agentCount}</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        <span style={{ ...monoLabel, display: "flex", alignItems: "center", gap: "4px" }}>
          <span
            style={{
              display: "inline-block",
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: wsConnected ? "var(--success)" : "var(--error)",
            }}
          />
          WS
        </span>
        {memory && (
          <span style={monoLabel}>
            MEM <span style={{ color: "var(--text-secondary)" }}>{memory}</span>
          </span>
        )}
      </div>
    </footer>
  );
}
