import { useReducer, useCallback, useEffect, useState } from "react";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent, MilestoneStatus, AgentType, AgentStatus, AgentOutputEventType, CheckpointDecision } from "@aurex/shared";
import { getMission, getAgentLogs } from "../api";

export interface MissionError {
  code: string;
  message: string;
  workerId?: string;
  milestoneId?: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentLogEntry {
  eventType: AgentOutputEventType;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface PendingCheckpoint {
  checkpointId: string;
  decision: CheckpointDecision;
  status: "submitting";
  submittedAt: number;
}

export interface MissionState {
  mission: Mission | null;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary | null;
  escalation: WsClientEvent | null;
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
  /** Set while a checkpoint decision is in flight; cleared on ack/timeout/error. */
  pendingCheckpoint: PendingCheckpoint | null;
  /** Human-readable error from the last failed checkpoint submission. */
  pendingCheckpointError: string | null;
}

type Action =
  | { type: "SET_MISSION"; mission: Mission; milestones: Milestone[]; workers: WorkingUnit[]; cost: CostSummary }
  | { type: "ESCALATION"; event: WsClientEvent }
  | { type: "CLEAR_ESCALATION" }
  | { type: "COST_UPDATE"; totalCost: number; totalTokens: number }
  | { type: "MILESTONE_PROGRESS"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "AGENT_STATUS"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string; workerSnapshot?: { declaredPaths: string[]; declaredModules: string[]; taskBranch: string; worktreePath: string; sessionId: string; description: string } }
  | { type: "MISSION_COMPLETED"; finalState: string }
  | { type: "MISSION_STATUS"; status: string }
  | { type: "MILESTONES_SET"; milestones: import("@aurex/shared").Milestone[] }
  | { type: "MISSION_LOG"; phase: string; message: string; data?: Record<string, unknown> }
  | { type: "MISSION_ERROR"; code: string; message: string; workerId?: string; milestoneId?: string; recoverable: boolean; details?: Record<string, unknown> }
  | { type: "AGENT_OUTPUT"; agentId: string; eventType: AgentOutputEventType; message: string; timestamp: string; data?: Record<string, unknown> }
  | { type: "CLEAR_ERRORS" }
  | { type: "RESET" }
  | { type: "CHECKPOINT_SUBMITTING"; decision: CheckpointDecision }
  | { type: "CHECKPOINT_ACKED"; checkpointId: string; accepted: boolean; error?: string }
  | { type: "CLEAR_PENDING_CHECKPOINT_ERROR" };

export const initialMissionState: MissionState = {
  mission: null, milestones: [], activeWorkers: [], cost: null, escalation: null, logs: [], errors: [], agentLogs: {},
  pendingCheckpoint: null,
  pendingCheckpointError: null,
};

export function missionReducer(state: MissionState, action: Action): MissionState {
  switch (action.type) {
    case "SET_MISSION":
      return { ...state, mission: action.mission, milestones: action.milestones, activeWorkers: action.workers, cost: action.cost, logs: [], errors: [], agentLogs: {}, escalation: null };
    case "ESCALATION":
      return { ...state, escalation: action.event };
    case "CLEAR_ESCALATION":
      return { ...state, escalation: null };
    case "COST_UPDATE":
      return { ...state, cost: { totalCost: action.totalCost, totalTokens: action.totalTokens, entries: (state.cost?.entries ?? 0) + 1 } };
    case "MILESTONE_PROGRESS": {
      const milestones = state.milestones.map((m) =>
        m.id === action.milestoneId ? { ...m, status: action.status as Milestone["status"] } : m,
      );
      return { ...state, milestones };
    }
    case "AGENT_STATUS": {
      const terminalWorkerStatuses = new Set(["completed", "failed", "timed_out", "superseded"]);
      if (terminalWorkerStatuses.has(action.status)) {
        return {
          ...state,
          activeWorkers: state.activeWorkers.filter((w) => w.id !== action.agentId),
        };
      }
      const existing = state.activeWorkers.find((w) => w.id === action.agentId);
      if (existing) {
        const activeWorkers = state.activeWorkers.map((w) =>
          w.id === action.agentId ? { ...w, status: action.status as WorkingUnit["status"] } : w,
        );
        return { ...state, activeWorkers };
      }
      const activeWorkers = [
        ...state.activeWorkers,
        { id: action.agentId, milestoneId: action.milestoneId, description: action.workerSnapshot?.description ?? `${action.agentType} agent`, status: action.status as WorkingUnit["status"], declaredPaths: action.workerSnapshot?.declaredPaths ?? [], declaredModules: action.workerSnapshot?.declaredModules ?? [], taskBranch: action.workerSnapshot?.taskBranch ?? "", worktreePath: action.workerSnapshot?.worktreePath ?? "", sessionId: action.workerSnapshot?.sessionId ?? "" },
      ];
      return { ...state, activeWorkers };
    }
    case "MISSION_COMPLETED": {
      if (!state.mission) return state;
      if (state.mission.status === "aborted") return state;
      const status = action.finalState === "completed"
        ? "completed" as const
        : action.finalState === "aborted"
          ? "aborted" as const
          : "failed" as const;
      return { ...state, mission: { ...state.mission, status }, escalation: null };
    }
    case "MISSION_LOG": {
      const log = { phase: action.phase, message: action.message, timestamp: Date.now(), data: action.data };
      return { ...state, logs: [...state.logs.slice(-49), log] };
    }
    case "MISSION_ERROR": {
      const error: MissionError = { code: action.code, message: action.message, workerId: action.workerId, milestoneId: action.milestoneId, recoverable: action.recoverable, details: action.details, timestamp: Date.now() };
      return { ...state, errors: [...state.errors.slice(-19), error] };
    }
    case "AGENT_OUTPUT": {
      const entry: AgentLogEntry = { eventType: action.eventType, message: action.message, timestamp: action.timestamp, data: action.data };
      const existing = state.agentLogs[action.agentId] ?? [];
      return {
        ...state,
        agentLogs: {
          ...state.agentLogs,
          [action.agentId]: [...existing.slice(-199), entry],
        },
      };
    }
    case "CLEAR_ERRORS":
      return { ...state, errors: [] };
    case "MISSION_STATUS": {
      if (!state.mission) return state;
      return { ...state, mission: { ...state.mission, status: action.status as import("@aurex/shared").Mission["status"] } };
    }
    case "MILESTONES_SET":
      return { ...state, milestones: action.milestones };
    case "RESET":
      return initialMissionState;
    case "CHECKPOINT_SUBMITTING": {
      if (!state.escalation) return state;
      const checkpointId = (state.escalation as any).checkpointId;
      if (!checkpointId) return state;
      return {
        ...state,
        pendingCheckpointError: null,
        pendingCheckpoint: {
          checkpointId,
          decision: action.decision,
          status: "submitting",
          submittedAt: Date.now(),
        },
      };
    }
    case "CHECKPOINT_ACKED": {
      // Ignore acks that don't match the in-flight checkpoint.
      if (!state.pendingCheckpoint || state.pendingCheckpoint.checkpointId !== action.checkpointId) {
        return state;
      }
      if (action.accepted) {
        return { ...state, escalation: null, pendingCheckpoint: null, pendingCheckpointError: null };
      }
      // Rejected: keep the escalation so the user can retry, surface the error.
      return {
        ...state,
        pendingCheckpoint: null,
        pendingCheckpointError: action.error ?? "Checkpoint submission was rejected",
      };
    }
    case "CLEAR_PENDING_CHECKPOINT_ERROR":
      return { ...state, pendingCheckpointError: null };
    default:
      return state;
  }
}

export function useMission(missionId: string | null) {
  const [state, dispatch] = useReducer(missionReducer, initialMissionState);
  const [reloadNonce, setReloadNonce] = useState(0);

  const reloadMission = useCallback(() => {
    setReloadNonce((value) => value + 1);
  }, []);

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
  }, [missionId, reloadNonce]);

  // Rehydrate agent logs on mount so the event timeline isn't empty
  // after a page refresh. Converts backend log entries into the same
  // MISSION_LOG / AGENT_OUTPUT actions that WS events produce.
  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    getAgentLogs(missionId)
      .then((response) => {
        if (cancelled) return;
        for (const entry of response.logs) {
          if (entry.event === "tool_call" || entry.event === "spawned" || entry.event === "completed" || entry.event === "failed" || entry.event === "timed_out" || entry.event === "prompt_sent") {
            dispatch({
              type: "MISSION_LOG",
              phase: entry.agentType ?? "worker",
              message: entry.message,
              data: { rehydrated: true, ...entry.data },
            });
          }
          dispatch({
            type: "AGENT_OUTPUT",
            agentId: entry.sessionId,
            eventType: entry.event as AgentOutputEventType,
            message: entry.message,
            timestamp: entry.timestamp,
            data: entry.data,
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
        dispatch({ type: "AGENT_STATUS", agentId: event.agentId, agentType: event.agentType, status: event.status, milestoneId: event.milestoneId, workerSnapshot: event.workerSnapshot });
        break;
      case "mission_completed":
        dispatch({ type: "MISSION_COMPLETED", finalState: event.finalState });
        break;
      case "mission_status":
        dispatch({ type: "MISSION_STATUS", status: event.status });
        break;
      case "milestones_set":
        dispatch({ type: "MILESTONES_SET", milestones: event.milestones });
        break;
      case "mission_log":
        dispatch({ type: "MISSION_LOG", phase: event.phase, message: event.message, data: event.data });
        break;
      case "mission_error":
        dispatch({ type: "MISSION_ERROR", code: event.code, message: event.message, workerId: event.workerId, milestoneId: event.milestoneId, recoverable: event.recoverable, details: event.details });
        break;
      case "agent_output":
        dispatch({ type: "AGENT_OUTPUT", agentId: event.agentId, eventType: event.eventType, message: event.message, timestamp: event.timestamp, data: event.data });
        break;
      default:
        break;
    }
  }, [missionId]);

  return { state, dispatch, handleWsEvent, reloadMission };
}
