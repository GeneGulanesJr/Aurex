import { useState } from "react";
import type { EscalationTrigger, CheckpointDecision } from "@aurex/shared";

interface DecisionActionsProps {
  onDecision: (decision: CheckpointDecision, guidance?: string, reason?: string) => void;
  trigger: EscalationTrigger;
}

const btnBase: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "4px",
  fontWeight: 500,
  fontSize: "14px",
  border: "none",
  cursor: "pointer",
  fontFamily: '"Inter", sans-serif',
};

export function DecisionActions({ onDecision, trigger }: DecisionActionsProps) {
  const [guidance, setGuidance] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);

  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
      {trigger.kind === "milestone_complete" && (
        <>
          <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--success)", color: "var(--bg-deep)" }}>Approve</button>
          <button onClick={() => onDecision("reject", undefined, "abandon")} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Reject</button>
        </>
      )}

      {(trigger.kind === "rescope_limit" || trigger.kind === "unclassifiable_error") && (
        <>
          <button onClick={() => onDecision("rescope", guidance || undefined)} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)" }}>Review & Rescope</button>
          <button onClick={() => onDecision("reject", undefined, "abort")} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
          {trigger.kind === "unclassifiable_error" && (
            <button onClick={() => setShowGuidance(!showGuidance)} style={{ ...btnBase, background: "var(--bg-elevated)", color: "var(--text-primary)" }}>Provide Guidance</button>
          )}
        </>
      )}

      {trigger.kind === "cost_cap_exceeded" && (
        <>
          <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--warning)", color: "var(--bg-deep)" }}>Approve Over Budget</button>
          <button onClick={() => onDecision("reject", undefined, "cost_exceeded")} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
        </>
      )}

      {trigger.kind === "quota_exhausted" && (
        <>
          <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--accent)", color: "var(--bg-deep)" }}>Resume After Reset</button>
          <button onClick={() => onDecision("reject", undefined, "quota_exhausted")} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
        </>
      )}

      {showGuidance && (
        <div style={{ width: "100%", marginTop: "12px" }}>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Enter guidance for the Orchestrator..."
            style={{
              width: "100%",
              background: "var(--bg-inset)",
              color: "var(--text-primary)",
              borderRadius: "4px",
              padding: "12px",
              border: "1px solid var(--border)",
              outline: "none",
              resize: "none",
              fontFamily: '"Inter", sans-serif',
              fontSize: "14px",
            }}
            rows={3}
          />
          <button onClick={() => onDecision("rescope", guidance)} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)", marginTop: "8px" }}>Submit Guidance</button>
        </div>
      )}
    </div>
  );
}
