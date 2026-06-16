import { useState } from "react";
import type { EscalationTrigger, CheckpointDecision } from "@aurex/shared";

interface DecisionActionsProps {
  onDecision: (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => void;
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
          <button onClick={() => onDecision("reject", { reason: "abandon" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Reject</button>
        </>
      )}

      {trigger.kind === "validation_failed" && (
        <>
          <button onClick={() => onDecision("approve", { guidance: guidance || "Continue with the current milestone scope and retry the failed work." })} style={{ ...btnBase, background: "var(--success)", color: "var(--bg-deep)" }}>Continue Work</button>
          <button onClick={() => onDecision("approve", { rescopeGuidance: guidance || "Re-plan this milestone to address the failure." })} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)" }}>Rescope</button>
          <button onClick={() => onDecision("reject", { reason: "abort" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
          <button onClick={() => setShowGuidance(!showGuidance)} style={{ ...btnBase, background: "var(--bg-elevated)", color: "var(--text-primary)" }}>Add Guidance</button>
        </>
      )}

      {trigger.kind === "rescope_limit" && (
        <>
          <button onClick={() => onDecision("approve", { guidance: guidance || "Continue with the current milestone scope and retry the failed work." })} style={{ ...btnBase, background: "var(--success)", color: "var(--bg-deep)" }}>Continue Work</button>
          <button onClick={() => onDecision("approve", { rescopeGuidance: guidance || "Re-plan this milestone to address the failure." })} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)" }}>Rescope</button>
          <button onClick={() => onDecision("reject", { reason: "abort" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
          <button onClick={() => setShowGuidance(!showGuidance)} style={{ ...btnBase, background: "var(--bg-elevated)", color: "var(--text-primary)" }}>Add Guidance</button>
        </>
      )}

      {trigger.kind === "unclassifiable_error" && (
        <>
          <button onClick={() => onDecision("approve", { rescopeGuidance: guidance || "Re-plan this milestone to address the runtime failure." })} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)" }}>Rescope</button>
          <button onClick={() => onDecision("reject", { reason: "abort" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
          <button onClick={() => setShowGuidance(!showGuidance)} style={{ ...btnBase, background: "var(--bg-elevated)", color: "var(--text-primary)" }}>Add Guidance</button>
        </>
      )}

      {trigger.kind === "cost_cap_exceeded" && (
        <>
          <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--warning)", color: "var(--bg-deep)" }}>Approve Over Budget</button>
          <button onClick={() => onDecision("reject", { reason: "cost_exceeded" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
        </>
      )}

      {trigger.kind === "quota_exhausted" && (
        <>
          <button onClick={() => onDecision("approve")} style={{ ...btnBase, background: "var(--accent)", color: "var(--bg-deep)" }}>Resume After Reset</button>
          <button onClick={() => onDecision("reject", { reason: "quota_exhausted" })} style={{ ...btnBase, background: "var(--error)", color: "#fff" }}>Abort Mission</button>
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
          <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
            <button onClick={() => onDecision("approve", { guidance: guidance || "Continue with the current milestone scope and retry the failed work." })} style={{ ...btnBase, background: "var(--success)", color: "var(--bg-deep)" }}>Continue With Guidance</button>
            <button onClick={() => onDecision("approve", { rescopeGuidance: guidance || "Re-plan this milestone to address the failure." })} style={{ ...btnBase, background: "var(--info)", color: "var(--bg-deep)" }}>Rescope With Guidance</button>
          </div>
        </div>
      )}
    </div>
  );
}
