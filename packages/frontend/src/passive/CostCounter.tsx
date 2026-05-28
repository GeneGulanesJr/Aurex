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
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Cost</div>
      <div ref={valueRef} className="text-3xl font-mono">
        ${cost ? cost.totalCost.toFixed(2) : "0.00"}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {cost ? `${cost.totalTokens.toLocaleString()} tokens` : "—"}
      </div>
    </div>
  );
}
