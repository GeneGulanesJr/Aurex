import type { CostSummary } from "@aurex/shared";

interface CostCounterProps {
  cost: CostSummary | null;
}

export function CostCounter({ cost }: CostCounterProps) {
  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Cost</div>
      <div className="text-3xl font-mono">
        ${cost ? cost.totalCost.toFixed(2) : "0.00"}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {cost ? `${cost.totalTokens.toLocaleString()} tokens` : "—"}
      </div>
    </div>
  );
}
