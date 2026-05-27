import { useReducer, useCallback, useEffect } from "react";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";
import { getCurrentMission } from "../api";

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
  | { type: "COST_UPDATE"; totalCost: number; totalTokens: number };

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
    default:
      return state;
  }
}

export function useMission() {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let cancelled = false;
    getCurrentMission()
      .then((payload) => {
        if (!cancelled && payload) {
          dispatch({
            type: "SET_MISSION",
            mission: payload.mission,
            milestones: payload.milestones,
            workers: payload.activeWorkers,
            cost: payload.cost,
          });
        }
      })
      .catch(() => {
        // The dashboard can still receive state through websocket events later.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleWsEvent = useCallback((event: WsClientEvent) => {
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
  }, []);

  return { state, dispatch, handleWsEvent };
}
