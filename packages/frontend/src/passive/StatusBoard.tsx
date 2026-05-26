import { AgentGrid } from "./AgentGrid";
import { MilestoneBar } from "./MilestoneBar";
import { CostCounter } from "./CostCounter";
import { StatusFeed } from "./StatusFeed";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";

interface StatusBoardProps {
  mission: Mission | null;
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  blurred: boolean;
}

export function StatusBoard({ mission, milestones, workers, cost, events, blurred }: StatusBoardProps) {
  if (!mission) {
    return <div className="text-gray-500 text-center py-20">No active mission</div>;
  }

  const currentMilestone = milestones.find((m) => m.status === "in_progress") || milestones[0];

  return (
    <div className={`transition-all duration-500 ${blurred ? "blur-sm opacity-50" : ""}`}>
      <div className="grid grid-cols-3 gap-6 p-6">
        <div className="col-span-2">
          <AgentGrid workers={workers} />
        </div>
        <div className="col-span-1">
          <StatusFeed events={events} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 p-6">
        <MilestoneBar milestone={currentMilestone} />
        <CostCounter cost={cost} />
      </div>
    </div>
  );
}
