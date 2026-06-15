import { useRef, useEffect } from "react";
import { CheckpointPanel } from "./CheckpointPanel";
import { DecisionActions } from "./DecisionActions";
import { enterActive, exitActive } from "../animations/state-transitions";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: CheckpointDecision, opts?: { guidance?: string; reason?: string; rescopeGuidance?: string }) => void;
  onDismiss: () => void;
  submitting?: boolean;
  submitError?: string | null;
  onDismissSubmitError?: () => void;
}

export function EscalationOverlay({ event, onDecision, onDismiss, submitting, submitError, onDismissSubmitError }: EscalationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    enterActive(el);
  }, []);

  if (event.type !== "escalation") return null;

  const handleDismiss = () => {
    const el = overlayRef.current;
    if (el) {
      exitActive(el).then(onDismiss);
    } else {
      onDismiss();
    }
  };

  return (
    <div ref={overlayRef} style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--bg-inset) 85%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "6px", padding: "32px", maxWidth: "672px", width: "100%", margin: "0 16px", boxShadow: "0 25px 50px -12px var(--accent-glow)", border: "1px solid var(--border)" }}>
        <CheckpointPanel trigger={event.trigger} />
        {submitError && (
          <div style={{ marginTop: "12px", padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--error)", borderRadius: "4px", color: "var(--error)", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <span>Decision failed: {submitError}</span>
            <button onClick={onDismissSubmitError} style={{ background: "transparent", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "14px" }}>×</button>
          </div>
        )}
        {submitting && (
          <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', letterSpacing: "1px" }}>
            SUBMITTING DECISION…
          </div>
        )}
        <DecisionActions onDecision={onDecision} trigger={event.trigger} />
        <button
          onClick={handleDismiss}
          style={{ marginTop: "16px", color: "var(--text-muted)", fontSize: "13px", background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >Dismiss</button>
      </div>
    </div>
  );
}
