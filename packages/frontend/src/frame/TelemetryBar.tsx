import { useEffect, useRef } from "react";
import { animateCounter } from "../animations/counters";

interface TelemetryBarProps {
  tokens: number;
  cost: number;
  agentCount: number;
  wsConnected: boolean;
  scanFindings?: number;
  isScanning?: boolean;
}

const monoLabel: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "0.5px",
  color: "var(--text-muted)",
};

export function TelemetryBar({ tokens, cost, agentCount, wsConnected, scanFindings = 0, isScanning = false }: TelemetryBarProps) {
  const costRef = useRef<HTMLSpanElement>(null);
  const tokensRef = useRef<HTMLSpanElement>(null);
  const prevCostRef = useRef(cost);
  const prevTokensRef = useRef(tokens);

  useEffect(() => {
    if (costRef.current && prevCostRef.current !== cost) {
      animateCounter(costRef.current, prevCostRef.current, cost);
      prevCostRef.current = cost;
    }
  }, [cost]);

  useEffect(() => {
    if (tokensRef.current && prevTokensRef.current !== tokens) {
      animateCounter(tokensRef.current, prevTokensRef.current, tokens, "tokens");
      prevTokensRef.current = tokens;
    }
  }, [tokens]);

  return (
    <footer
      className="telemetry-bar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px",
        minHeight: "36px",
        background: "var(--bg-inset)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", gap: "20px", minWidth: 0, overflow: "hidden" }}>
        <span style={monoLabel}>
          TOKENS <span ref={tokensRef} style={{ color: "var(--text-secondary)" }}>{tokens.toLocaleString()}</span>
        </span>
        <span style={monoLabel}>
          COST <span ref={costRef} style={{ color: "var(--accent)", fontWeight: 500 }}>${cost.toFixed(2)}</span>
        </span>
        <span style={monoLabel}>
          AGENTS <span style={{ color: "var(--text-secondary)" }}>{agentCount}</span>
        </span>
        {(isScanning || scanFindings > 0) && (
          <span style={{ ...monoLabel, display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: scanFindings > 0 ? "var(--error)" : "var(--accent)",
                animation: isScanning ? "pulse 1.5s infinite" : "none",
              }}
            />
            {isScanning ? "SCANNING" : `${scanFindings} FINDING${scanFindings !== 1 ? "S" : ""}`}
          </span>
        )}
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
      </div>
    </footer>
  );
}
