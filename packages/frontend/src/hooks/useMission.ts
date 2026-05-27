import { useReducer, useCallback, useEffect } from "react";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";
import { getMission } from "../api";

interface MissionState {
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
  | { type: "RESET" };

const initial: MissionState = {
  mission: null, milestones: [], activeWorkers: [], cost: null, escalation: null,
};

function reducer(state: MissionState, action: Action): MissionState {
  switch (action.type) {
    case "SET_MISSION":
      return { ...state, mission: action.mission, milestones: action.milestones, activeWorkers: action.workers, cost: action.cost };
    case "ESCALATION":
      return { ...state, escalation: action.event };
    case "CLEAR_ESCALATION":
      return { ...state, escalation: null };
    case "COST_UPDATE":
      return { ...state, cost: { totalCost: action.totalCost, totalTokens: action.totalTokens, entries: 0 } };
    case "RESET":
      return initial;
    default:
      return state;
  }
}

export function useMission(missionId: string | null) {
  const [state, dispatch] = useReducer(reducer, initial);

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
      default:
        break;
    }
  }, [missionId]);

  return { state, dispatch, handleWsEvent };
}
