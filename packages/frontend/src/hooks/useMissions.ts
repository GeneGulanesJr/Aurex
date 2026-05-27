import { useReducer, useCallback, useEffect } from "react";
import type { WsClientEvent } from "@aurex/shared";
import { getActiveMissions } from "../api";

export interface MissionListItem {
  missionId: string;
  state: string;
  queuePosition?: number;
  description?: string;
}

interface MissionsState {
  missions: MissionListItem[];
  selectedMissionId: string | null;
}

type Action =
  | { type: "SET_MISSIONS"; missions: MissionListItem[] }
  | { type: "SELECT"; missionId: string }
  | { type: "WS_MISSION_QUEUED"; missionId: string; queuePosition: number }
  | { type: "WS_MISSION_STARTED"; missionId: string }
  | { type: "WS_MISSION_COMPLETED"; missionId: string; finalState: string }
  | { type: "REMOVE"; missionId: string };

const initial: MissionsState = {
  missions: [],
  selectedMissionId: null,
};

function reducer(state: MissionsState, action: Action): MissionsState {
  switch (action.type) {
    case "SET_MISSIONS": {
      const missions = action.missions;
      const selectedMissionId = state.selectedMissionId ?? missions.find((m) => m.state !== "queued" && m.state !== "completed" && m.state !== "failed")?.missionId ?? missions[0]?.missionId ?? null;
      return { ...state, missions, selectedMissionId };
    }
    case "SELECT":
      return { ...state, selectedMissionId: action.missionId };
    case "WS_MISSION_QUEUED": {
      const exists = state.missions.some((m) => m.missionId === action.missionId);
      if (exists) {
        return {
          ...state,
          missions: state.missions.map((m) =>
            m.missionId === action.missionId ? { ...m, state: "queued", queuePosition: action.queuePosition } : m,
          ),
        };
      }
      const newMissions = [...state.missions, { missionId: action.missionId, state: "queued" as const, queuePosition: action.queuePosition as number }];
      const selectedMissionId = state.selectedMissionId ?? action.missionId;
      return { ...state, missions: newMissions, selectedMissionId };
    }
    case "WS_MISSION_STARTED": {
      return {
        ...state,
        missions: state.missions.map((m) =>
          m.missionId === action.missionId ? { ...m, state: "planning", queuePosition: undefined } : m,
        ),
        selectedMissionId: state.selectedMissionId ?? action.missionId,
      };
    }
    case "WS_MISSION_COMPLETED": {
      return {
        ...state,
        missions: state.missions.map((m) =>
          m.missionId === action.missionId ? { ...m, state: action.finalState, queuePosition: undefined } : m,
        ),
      };
    }
    case "REMOVE": {
      const missions = state.missions.filter((m) => m.missionId !== action.missionId);
      const selectedMissionId = state.selectedMissionId === action.missionId
        ? (missions.find((m) => m.state !== "queued" && m.state !== "completed" && m.state !== "failed")?.missionId ?? missions[0]?.missionId ?? null)
        : state.selectedMissionId;
      return { ...state, missions, selectedMissionId };
    }
    default:
      return state;
  }
}

export function useMissions() {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let cancelled = false;
    getActiveMissions()
      .then(({ missions }) => {
        if (!cancelled) {
          dispatch({ type: "SET_MISSIONS", missions });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const handleWsEvent = useCallback((event: WsClientEvent) => {
    switch (event.type) {
      case "mission_queued":
        dispatch({ type: "WS_MISSION_QUEUED", missionId: event.missionId, queuePosition: event.queuePosition });
        break;
      case "mission_started":
        dispatch({ type: "WS_MISSION_STARTED", missionId: event.missionId });
        break;
      case "mission_completed":
        dispatch({ type: "WS_MISSION_COMPLETED", missionId: event.missionId, finalState: event.finalState });
        break;
    }
  }, []);

  const selectMission = useCallback((missionId: string) => {
    dispatch({ type: "SELECT", missionId });
  }, []);

  const removeMission = useCallback((missionId: string) => {
    dispatch({ type: "REMOVE", missionId });
  }, []);

  return { state, selectMission, removeMission, handleWsEvent };
}
