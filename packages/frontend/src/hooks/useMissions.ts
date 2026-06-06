import { useReducer, useCallback, useEffect, useRef } from "react";
import type { WsClientEvent } from "@aurex/shared";
import { getActiveMissions } from "../api";

const SELECTED_MISSION_STORAGE_KEY = "aurex:selectedMissionId";

function readPersistedSelection(): string | null {
  try {
    return localStorage.getItem(SELECTED_MISSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

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
  | { type: "MISSION_CREATED"; missionId: string; description: string }
  | { type: "WS_MISSION_QUEUED"; missionId: string; queuePosition: number }
  | { type: "WS_MISSION_STARTED"; missionId: string }
  | { type: "WS_MISSION_COMPLETED"; missionId: string; finalState: string }
  | { type: "WS_MISSION_STATUS"; missionId: string; status: string }
  | { type: "MISSION_RESTARTED"; missionId: string }
  | { type: "REMOVE"; missionId: string };

export const initialMissionsState: MissionsState = {
  missions: [],
  selectedMissionId: readPersistedSelection(),
};

export function missionsReducer(state: MissionsState, action: Action): MissionsState {
  switch (action.type) {
    case "SET_MISSIONS": {
      const missions = action.missions;
      const selectedMissionId = state.selectedMissionId ?? missions.find((m) => m.state !== "queued" && m.state !== "completed" && m.state !== "failed")?.missionId ?? missions[0]?.missionId ?? null;
      return { ...state, missions, selectedMissionId };
    }
    case "SELECT":
      return { ...state, selectedMissionId: action.missionId };
    case "MISSION_CREATED": {
      const exists = state.missions.some((m) => m.missionId === action.missionId);
      if (exists) return state;
      const newMissions = [...state.missions, { missionId: action.missionId, state: "planning" as const, description: action.description }];
      const selectedMissionId = state.selectedMissionId ?? action.missionId;
      return { ...state, missions: newMissions, selectedMissionId };
    }
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
    case "WS_MISSION_STATUS": {
      return {
        ...state,
        missions: state.missions.map((m) =>
          m.missionId === action.missionId ? { ...m, state: action.status } : m,
        ),
      };
    }
    case "MISSION_RESTARTED": {
      return {
        ...state,
        missions: state.missions.map((m) =>
          m.missionId === action.missionId ? { ...m, state: "planning", queuePosition: undefined } : m,
        ),
        selectedMissionId: action.missionId,
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
  const [state, dispatch] = useReducer(missionsReducer, initialMissionsState);
  // Keep the last dispatched selection in a ref so we can persist on every change
  // without re-running effects (and without bouncing through localStorage in render).
  const selectedIdRef = useRef<string | null>(state.selectedMissionId);

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

  // Persist selection to localStorage so a refresh returns to the same mission.
  useEffect(() => {
    if (state.selectedMissionId === selectedIdRef.current) return;
    selectedIdRef.current = state.selectedMissionId;
    try {
      if (state.selectedMissionId) {
        localStorage.setItem(SELECTED_MISSION_STORAGE_KEY, state.selectedMissionId);
      } else {
        localStorage.removeItem(SELECTED_MISSION_STORAGE_KEY);
      }
    } catch {
      // localStorage may be unavailable (private mode, SSR, etc.) — silently ignore
    }
  }, [state.selectedMissionId]);

  // Clear the persisted selection if the chosen mission is no longer in the
  // rehydrated list (e.g. LaPis evicted it, server-side cleanup).
  useEffect(() => {
    if (!state.selectedMissionId) return;
    if (state.missions.length === 0) return; // still loading
    const exists = state.missions.some((m) => m.missionId === state.selectedMissionId);
    if (!exists) {
      dispatch({ type: "SELECT", missionId: state.missions[0]?.missionId ?? null });
    }
  }, [state.missions, state.selectedMissionId]);

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
      case "mission_status":
        dispatch({ type: "WS_MISSION_STATUS", missionId: event.missionId, status: event.status });
        break;
    }
  }, []);

  const selectMission = useCallback((missionId: string) => {
    dispatch({ type: "SELECT", missionId });
  }, []);

  const removeMission = useCallback((missionId: string) => {
    dispatch({ type: "REMOVE", missionId });
  }, []);

  const addOptimisticMission = useCallback((missionId: string, description: string) => {
    dispatch({ type: "MISSION_CREATED", missionId, description });
  }, []);

  const markMissionRestarted = useCallback((missionId: string) => {
    dispatch({ type: "MISSION_RESTARTED", missionId });
  }, []);

  return { state, selectMission, removeMission, addOptimisticMission, markMissionRestarted, handleWsEvent };
}
