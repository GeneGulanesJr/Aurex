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
    return <div className="text-gray-500">No current milestone</div>;
  }

  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Milestone</div>
      <div className="text-lg font-semibold">{milestone.title}</div>
      <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div ref={barRef} className="h-full bg-accent" style={{ width: `${prevProgressRef.current}%` }} />
      </div>
    </div>
  );
}
