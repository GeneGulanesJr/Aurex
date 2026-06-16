import type { AttemptSummary } from "@aurex/shared";

interface AttemptHistoryProps {
  history: AttemptSummary[];
}

export function AttemptHistory({ history }: AttemptHistoryProps) {
  if (!history || history.length === 0) {
    return (
      <div style={{ marginTop: "12px", padding: "10px 12px", background: "var(--bg-inset)", borderRadius: "4px", fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', letterSpacing: "0.5px" }}>
        No attempt details available for this escalation.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      {history.map((attempt, i) => (
        <div key={i} style={{ background: "var(--bg-inset)", borderRadius: "4px", padding: "12px", fontSize: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Attempt {attempt.attemptIndex + 1}</span>
            <span style={{ color: "var(--text-muted)" }}>${attempt.cost.toFixed(2)}</span>
          </div>
          <div style={{ color: "var(--text-primary)", marginTop: "4px" }}>{attempt.outcome}</div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Scope: {attempt.scope}</div>
        </div>
      ))}
    </div>
  );
}
