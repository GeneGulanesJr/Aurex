import type { Milestone } from "@aurex/shared";

interface MilestoneBarProps {
  milestone: Milestone | undefined;
}

export function MilestoneBar({ milestone }: MilestoneBarProps) {
  if (!milestone) {
    return <div className="text-gray-500">No current milestone</div>;
  }

  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Milestone</div>
      <div className="text-lg font-semibold">{milestone.title}</div>
      <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: milestone.status === "completed" ? "100%" : milestone.status === "in_progress" ? "50%" : "0%" }}
        />
      </div>
    </div>
  );
}
