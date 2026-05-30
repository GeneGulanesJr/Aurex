import { useEffect, useRef } from "react";
import type { WorkingUnit } from "@aurex/shared";
import { createPulse, createSpin, createIdle } from "../animations/agent-animations";

interface AgentNodeProps {
  worker: WorkingUnit;
}

const statusColor: Record<string, string> = {
  spawned: "var(--warning)",
  working: "var(--accent)",
  committing: "var(--info)",
  completed: "var(--success)",
  timed_out: "var(--warning)",
  failed: "var(--error)",
};

export function AgentNode({ worker }: AgentNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    let anim: ReturnType<typeof createPulse> | undefined;
    if (worker.status === "working") {
      anim = createPulse(el);
    } else if (worker.status === "spawned") {
      anim = createSpin(el);
    } else {
      createIdle(el);
    }
    return () => { anim?.pause(); };
  }, [worker.status]);

  return (
    <div ref={nodeRef} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
      <div className="status-dot" style={{ width: "12px", height: "12px", borderRadius: "50%", background: statusColor[worker.status] || "var(--text-muted)", flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{worker.description}</div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{worker.status}</div>
      </div>
    </div>
  );
}
