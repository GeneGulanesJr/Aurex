// packages/shared/src/events.ts
import type {
  AgentType,
  AgentStatus,
  MilestoneStatus,
  CheckpointDecision,
  PreparedAgentRole,
  ExecutionFailureCode,
  ExecutionJobType,
} from "./enums.js";
import type {
  AttemptSummary,
  EscalationContext,
  BumblebeeFinding,
  BumblebeeScanSummary,
  ReconciliationRunSummary,
} from "./types.js";

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
  | {
      type: "agent_status";
      agentId: string;
      agentType: AgentType;
      status: AgentStatus;
      milestoneId: string;
      workerSnapshot?: {
        declaredPaths: string[];
        declaredModules: string[];
        taskBranch: string;
        worktreePath: string;
        sessionId: string;
        description: string;
      };
    }
  | {
      type: "milestone_progress";
      milestoneId: string;
      status: MilestoneStatus;
      completedUnits: number;
      totalUnits: number;
    }
  | {
      type: "cost_update";
      missionId: string;
      totalCost: number;
      totalTokens: number;
      delta: number;
    }
  | {
      type: "escalation";
      missionId: string;
      checkpointId: string;
      trigger: EscalationTrigger;
      context: EscalationContext;
    }
  | { type: "mission_queued"; missionId: string; queuePosition: number }
  | { type: "mission_started"; missionId: string }
  | { type: "mission_completed"; missionId: string; finalState: string }
  | { type: "mission_status"; missionId: string; status: string }
  | {
      type: "milestones_set";
      missionId: string;
      milestones: Array<{
        id: string;
        missionId: string;
        title: string;
        description: string;
        orderIndex: number;
        status: MilestoneStatus;
        validationContractId: string;
      }>;
    }
  | {
      type: "mission_log";
      missionId: string;
      phase: string;
      message: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "mission_error";
      missionId: string;
      code: string;
      message: string;
      workerId?: string;
      milestoneId?: string;
      recoverable: boolean;
      details?: Record<string, unknown>;
    }
  | {
      type: "agent_output";
      missionId: string;
      agentId: string;
      agentType: AgentType;
      eventType: AgentOutputEventType;
      message: string;
      timestamp: string;
      data?: Record<string, unknown>;
    }
  | { type: "scan_started"; missionId: string; scanId: string; profile: string }
  | {
      type: "scan_completed";
      missionId: string;
      scanId: string;
      summary: BumblebeeScanSummary;
    }
  | {
      type: "scan_finding";
      missionId: string;
      scanId: string;
      finding: BumblebeeFinding;
    }
  | {
      type: "quota_update";
      providerId: string;
      status: string;
      remainingBurnMs: number;
      remainingWindowMs: number;
      burnExpiresAt: string | null;
    }
  | { type: "quota_exhausted"; providerId: string; windowResetsAt: string }
  | { type: "mutation_progress"; runId: string; repoName: string; line: string }
  | {
      type: "agent_session_prepared";
      missionId: string;
      sessionId: string;
      role: PreparedAgentRole;
    }
  | {
      type: "agent_session_queued";
      missionId: string;
      sessionId: string;
      queueJobId: string;
    }
  | { type: "agent_session_started"; missionId: string; sessionId: string }
  | {
      type: "agent_session_heartbeat";
      missionId: string;
      sessionId: string;
      timestamp: string;
    }
  | { type: "agent_session_completed"; missionId: string; sessionId: string }
  | {
      type: "agent_session_failed";
      missionId: string;
      sessionId: string;
      failureCode: ExecutionFailureCode;
      message: string;
    }
  | {
      type: "agent_session_lost";
      missionId: string;
      sessionId: string;
      lastHeartbeatAt: string | null;
    }
  | {
      type: "execution_job_queued";
      missionId: string;
      jobId: string;
      jobType: ExecutionJobType;
    }
  | {
      type: "execution_job_claimed";
      missionId: string;
      jobId: string;
      claimedBy: string;
    }
  | {
      type: "execution_job_requeued";
      missionId: string;
      jobId: string;
      reason: string;
    }
  | {
      type: "execution_job_failed";
      missionId: string;
      jobId: string;
      failureCode: ExecutionFailureCode;
    }
  | {
      type: "stale_reconciliation_completed";
      summary: ReconciliationRunSummary;
    };

export type StreamingChunk = {
  delta: string;
  done: boolean;
};

export type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch?: string }
  | { kind: "validation_failed"; milestoneId: string }
  | {
      kind: "rescope_limit";
      milestoneId: string;
      attemptHistory?: AttemptSummary[];
    }
  | {
      kind: "unclassifiable_error";
      milestoneId: string;
      error?: string;
      lastAttempt?: string;
    }
  | { kind: "cost_cap_exceeded"; milestoneId: string }
  | { kind: "quota_exhausted"; milestoneId: string; windowResetsAt: string };

export interface WsServerMessage {
  event: WsClientEvent;
}

export interface WsClientMessage {
  event: "subscribe_mission" | "checkpoint_decision";
  missionId: string;
  checkpointId?: string;
  decision?: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
}
