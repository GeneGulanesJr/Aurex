import type { AttemptSummary } from "@aurex/shared";

interface AttemptHistoryProps {
  history: AttemptSummary[];
}

export function AttemptHistory({ history }: AttemptHistoryProps) {
  if (!history || history.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {history.map((attempt, i) => (
        <div key={i} className="bg-gray-900 rounded p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Attempt {attempt.attemptIndex + 1}</span>
            <span className="text-gray-500">${attempt.cost.toFixed(2)}</span>
          </div>
          <div className="text-gray-300 mt-1">{attempt.outcome}</div>
          <div className="text-xs text-gray-500 mt-1">Scope: {attempt.scope}</div>
        </div>
      ))}
    </div>
  );
}
