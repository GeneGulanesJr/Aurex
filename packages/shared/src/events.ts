// packages/shared/src/events.ts
import type { AgentType, AgentStatus, MilestoneStatus } from "./enums.js";
import type { AttemptSummary, EscalationContext } from "./types.js";

export type WsClientEvent =
  | { type: "agent_status"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
  | { type: "milestone_progress"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "cost_update"; missionId: string; totalCost: number; totalTokens: number; delta: number }
  | { type: "escalation"; missionId: string; checkpointId: string; trigger: EscalationTrigger; context: EscalationContext }
  | { type: "mission_queued"; missionId: string; queuePosition: number }
  | { type: "mission_started"; missionId: string }
  | { type: "mission_completed"; missionId: string; finalState: string }
  | { type: "mission_log"; missionId: string; phase: string; message: string };

export type StreamingChunk = {
  delta: string;
  done: boolean;
};

export type WsEvent = WsClientEvent;

export type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch?: string }
  | { kind: "rescope_limit"; milestoneId: string; attemptHistory?: AttemptSummary[] }
  | { kind: "unclassifiable_error"; milestoneId: string; error?: string; lastAttempt?: string }
  | { kind: "cost_cap_exceeded"; milestoneId: string };

export interface WsServerMessage {
  event: WsClientEvent;
}

export interface WsClientMessage {
  event: "subscribe_mission" | "checkpoint_decision";
  missionId: string;
  checkpointId?: string;
  decision?: "approve" | "reject" | "rescope";
  guidance?: string;
  reason?: string;
}
