// packages/shared/src/events.ts
import type { AgentType, AgentStatus, MilestoneStatus } from "./enums.js";
import type { AttemptSummary, EscalationContext, BumblebeeFinding, BumblebeeScanSummary } from "./types.js";

export type AgentOutputEventType =
  | "spawned"
  | "prompt_sent"
  | "tool_call"
  | "cost_update"
  | "completed"
  | "timed_out"
  | "failed"
  | "aborted";

export type WsClientEvent =
  | { type: "agent_status"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string; workerSnapshot?: { declaredPaths: string[]; declaredModules: string[]; taskBranch: string; worktreePath: string; sessionId: string; description: string } }
  | { type: "milestone_progress"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "cost_update"; missionId: string; totalCost: number; totalTokens: number; delta: number }
  | { type: "escalation"; missionId: string; checkpointId: string; trigger: EscalationTrigger; context: EscalationContext }
  | { type: "mission_queued"; missionId: string; queuePosition: number }
  | { type: "mission_started"; missionId: string }
  | { type: "mission_completed"; missionId: string; finalState: string }
  | { type: "mission_log"; missionId: string; phase: string; message: string; data?: Record<string, unknown> }
  | { type: "mission_error"; missionId: string; code: string; message: string; workerId?: string; milestoneId?: string; recoverable: boolean; details?: Record<string, unknown> }
  | { type: "agent_output"; missionId: string; agentId: string; agentType: AgentType; eventType: AgentOutputEventType; message: string; timestamp: string; data?: Record<string, unknown> }
  | { type: "scan_started"; missionId: string; scanId: string; profile: string }
  | { type: "scan_completed"; missionId: string; scanId: string; summary: BumblebeeScanSummary }
  | { type: "scan_finding"; missionId: string; scanId: string; finding: BumblebeeFinding }
  | { type: "quota_update"; providerId: string; status: string; remainingBurnMs: number; remainingWindowMs: number; burnExpiresAt: string | null }
  | { type: "quota_exhausted"; providerId: string; windowResetsAt: string };

export type StreamingChunk = {
  delta: string;
  done: boolean;
};

export type WsEvent = WsClientEvent;

export type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch?: string }
  | { kind: "rescope_limit"; milestoneId: string; attemptHistory?: AttemptSummary[] }
  | { kind: "unclassifiable_error"; milestoneId: string; error?: string; lastAttempt?: string }
  | { kind: "cost_cap_exceeded"; milestoneId: string }
  | { kind: "quota_exhausted"; milestoneId: string; windowResetsAt: string };

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
