import { useRef, useEffect } from "react";
import { CheckpointPanel } from "./CheckpointPanel";
import { DecisionActions } from "./DecisionActions";
import { enterActive, exitActive } from "../animations/state-transitions";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: CheckpointDecision, guidance?: string, reason?: string) => void;
  onDismiss: () => void;
}

export function EscalationOverlay({ event, onDecision, onDismiss }: EscalationOverlayProps) {
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
    <div ref={overlayRef} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "12px", padding: "32px", maxWidth: "672px", width: "100%", margin: "0 16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
        <CheckpointPanel trigger={event.trigger} />
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
