import { useReducer, useCallback, useEffect } from "react";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent, MilestoneStatus, AgentType, AgentStatus } from "@aurex/shared";
import { getMission } from "../api";

export interface MissionState {
  mission: Mission | null;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary | null;
  escalation: WsClientEvent | null;
}

type Action =
  | { type: "SET_MISSION"; mission: Mission; milestones: Milestone[]; workers: WorkingUnit[]; cost: CostSummary }
  | { type: "ESCALATION"; event: WsClientEvent }
  | { type: "CLEAR_ESCALATION" }
  | { type: "COST_UPDATE"; totalCost: number; totalTokens: number }
  | { type: "MILESTONE_PROGRESS"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "AGENT_STATUS"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
  | { type: "MISSION_COMPLETED"; finalState: string }
  | { type: "RESET" };

export const initialMissionState: MissionState = {
  mission: null, milestones: [], activeWorkers: [], cost: null, escalation: null,
};

export function missionReducer(state: MissionState, action: Action): MissionState {
  switch (action.type) {
    case "SET_MISSION":
      return { ...state, mission: action.mission, milestones: action.milestones, activeWorkers: action.workers, cost: action.cost };
    case "ESCALATION":
      return { ...state, escalation: action.event };
    case "CLEAR_ESCALATION":
      return { ...state, escalation: null };
    case "COST_UPDATE":
      return { ...state, cost: { totalCost: action.totalCost, totalTokens: action.totalTokens, entries: 0 } };
    case "MILESTONE_PROGRESS": {
      const milestones = state.milestones.map((m) =>
        m.id === action.milestoneId ? { ...m, status: action.status as Milestone["status"] } : m,
      );
      return { ...state, milestones };
    }
    case "AGENT_STATUS": {
      // Upsert a lightweight worker display record keyed by agentId
      const existing = state.activeWorkers.find(
        (w) => w.id === action.agentId,
      );
      if (existing) {
        const activeWorkers = state.activeWorkers.map((w) =>
          w.id === action.agentId
            ? { ...w, status: action.status as WorkingUnit["status"] }
            : w,
        );
        return { ...state, activeWorkers };
      }
      const activeWorkers = [
        ...state.activeWorkers,
        { id: action.agentId, milestoneId: action.milestoneId, description: `${action.agentType} agent`, status: action.status as WorkingUnit["status"], declaredPaths: [], declaredModules: [] } satisfies WorkingUnit,
      ];
      return { ...state, activeWorkers };
    }
    case "MISSION_COMPLETED": {
      if (!state.mission) return state;
      const status = action.finalState === "completed" ? "completed" as const : "failed" as const;
      return { ...state, mission: { ...state.mission, status } };
    }
    case "RESET":
      return initialMissionState;
    default:
      return state;
  }
}

export function useMission(missionId: string | null) {
  const [state, dispatch] = useReducer(missionReducer, initialMissionState);

  useEffect(() => {
    if (!missionId) {
      dispatch({ type: "RESET" });
      return;
    }
    let cancelled = false;
    getMission(missionId)
      .then((payload) => {
        if (!cancelled) {
          dispatch({
            type: "SET_MISSION",
            mission: payload.mission,
            milestones: payload.milestones,
            workers: payload.activeWorkers,
            cost: payload.cost,
          });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [missionId]);

  const handleWsEvent = useCallback((event: WsClientEvent) => {
    if (missionId && "missionId" in event && event.missionId !== missionId) return;
    switch (event.type) {
      case "escalation":
        dispatch({ type: "ESCALATION", event });
        break;
      case "cost_update":
        dispatch({ type: "COST_UPDATE", totalCost: event.totalCost, totalTokens: event.totalTokens });
        break;
      case "milestone_progress":
        dispatch({ type: "MILESTONE_PROGRESS", milestoneId: event.milestoneId, status: event.status, completedUnits: event.completedUnits, totalUnits: event.totalUnits });
        break;
      case "agent_status":
        dispatch({ type: "AGENT_STATUS", agentId: event.agentId, agentType: event.agentType, status: event.status, milestoneId: event.milestoneId });
        break;
      case "mission_completed":
        dispatch({ type: "MISSION_COMPLETED", finalState: event.finalState });
        break;
      default:
        break;
    }
  }, [missionId]);

  return { state, dispatch, handleWsEvent };
}
