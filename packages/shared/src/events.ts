// packages/shared/src/events.ts
import type { AgentType, AgentStatus, MilestoneStatus } from "./enums";
import type { AttemptSummary, EscalationContext } from "./types";

export type WsClientEvent =
  | { type: "agent_status"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
  | { type: "milestone_progress"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "cost_update"; missionId: string; totalCost: number; totalTokens: number; delta: number }
  | { type: "escalation"; missionId: string; trigger: EscalationTrigger; context: EscalationContext };

export type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch: string }
  | { kind: "rescope_limit"; milestoneId: string; attemptHistory: AttemptSummary[] }
  | { kind: "unclassifiable_error"; milestoneId: string; error: string; lastAttempt: string };

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
