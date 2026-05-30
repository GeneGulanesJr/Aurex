import { useEffect, useRef } from "react";
import type { CostSummary } from "@aurex/shared";
import { animateCounter } from "../animations/counters";

interface CostCounterProps {
  cost: CostSummary | null;
}

export function CostCounter({ cost }: CostCounterProps) {
  const valueRef = useRef<HTMLDivElement>(null);
  const prevCostRef = useRef(0);

  useEffect(() => {
    const el = valueRef.current;
    if (!el || !cost) return;
    const from = prevCostRef.current;
    const to = cost.totalCost;
    if (from !== to) {
      animateCounter(el, from, to);
      prevCostRef.current = to;
    }
  }, [cost?.totalCost]);

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 16px" }}>
      <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>Cost</div>
      <div ref={valueRef} style={{ fontSize: "28px", fontFamily: '"JetBrains Mono", monospace', color: "var(--text-primary)" }}>
        ${cost ? cost.totalCost.toFixed(2) : "0.00"}
      </div>
      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
        {cost ? `${cost.totalTokens.toLocaleString()} tokens` : "—"}
      </div>
    </div>
  );
}
