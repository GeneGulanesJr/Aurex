import { useRef, useEffect } from "react";
import { CheckpointPanel } from "./CheckpointPanel";
import { DecisionActions } from "./DecisionActions";
import type { WsClientEvent, CheckpointDecision } from "@aurex/shared";

interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: CheckpointDecision, guidance?: string, reason?: string) => void;
  onDismiss: () => void;
}

export function EscalationOverlay({ event, onDecision, onDismiss }: EscalationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.style.opacity = "1";
    }
  }, []);

  if (event.type !== "escalation") return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" ref={overlayRef} style={{ opacity: 0 }}>
      <div className="bg-gray-800 rounded-xl p-8 max-w-2xl w-full mx-4 shadow-2xl">
        <CheckpointPanel trigger={event.trigger} />
        <DecisionActions onDecision={onDecision} trigger={event.trigger} />
        <button onClick={onDismiss} className="mt-4 text-gray-500 text-sm hover:text-gray-300">Dismiss</button>
      </div>
    </div>
  );
}
