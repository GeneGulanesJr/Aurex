import { useEffect, useRef } from "react";
import type { Milestone } from "@aurex/shared";
import { animateProgress } from "../animations/counters";

interface MilestoneBarProps {
  milestone: Milestone | undefined;
}

function getProgress(status: string): number {
  if (status === "completed") return 100;
  if (status === "validating") return 75;
  if (status === "in_progress") return 50;
  return 0;
}

export function MilestoneBar({ milestone }: MilestoneBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const prevProgressRef = useRef(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el || !milestone) return;
    const to = getProgress(milestone.status);
    const from = prevProgressRef.current;
    if (from !== to) {
      animateProgress(el, from, to);
      prevProgressRef.current = to;
    }
  }, [milestone?.status]);

  if (!milestone) {
    return <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No current milestone</div>;
  }

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 16px" }}>
      <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>Milestone</div>
      <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>{milestone.title}</div>
      <div style={{ marginTop: "8px", height: "8px", background: "var(--bg-elevated)", borderRadius: "9999px", overflow: "hidden" }}>
        <div ref={barRef} style={{ height: "100%", background: "var(--accent)", width: `${prevProgressRef.current}%` }} />
      </div>
    </div>
  );
}
