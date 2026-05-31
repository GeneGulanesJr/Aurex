import { useEffect, useRef } from "react";
import { MissionPipeline } from "./MissionPipeline";
import { EmptyState } from "../frame/EmptyState";
import { dimPassive, restorePassive } from "../animations/state-transitions";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";

interface StatusBoardProps {
  mission: Mission | null;
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  logs: Array<{ phase: string; message: string; timestamp: number }>;
  blurred: boolean;
}

export function StatusBoard({ mission, milestones, workers, cost, events, logs, blurred }: StatusBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    if (blurred) {
      dimPassive(el);
    } else {
      restorePassive(el);
    }
  }, [blurred]);

  if (!mission) {
    return (
      <div style={{ display: "flex", height: "100%" }}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div ref={boardRef} style={{ height: "100%", overflowY: "auto" }}>
      <MissionPipeline
        mission={mission}
        milestones={milestones}
        workers={workers}
        cost={cost}
        events={events}
        logs={logs}
      />
    </div>
  );
}
