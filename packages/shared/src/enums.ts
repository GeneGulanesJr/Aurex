// packages/shared/src/enums.ts

// Mission lifecycle
export type MissionStatus =
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";
export type MilestoneStatus =
  | "planned"
  | "in_progress"
  | "validating"
  | "rescoping"
  | "retrying"
  | "completed"
  | "failed";

// Agent statuses
export type AgentStatus =
  | "spawned"
  | "planning"
  | "working"
  | "reviewing"
  | "researching"
  | "committing"
  | "completed"
  | "timed_out"
  | "failed";
export type WorkerStatus =
  | "planned"
  | "spawned"
  | "working"
  | "committing"
  | "completed"
  | "timed_out"
  | "failed"
  | "superseded";

// Agent types
export type AgentType =
  | "orchestrator"
  | "worker"
  | "validator_scrutiny"
  | "validator_user_testing"
  | "research";

// Negotiation
export type NegotiatorVerdict = "pass" | "retry" | "rescope" | "escalate";

// Research
export type ResearchLifecycle =
  | "unverified"
  | "verified"
  | "superseded"
  | "rejected"
  | "expired";
export type ResearchRelevance = "high" | "medium" | "low";

// Checkpoints
export type CheckpointTrigger =
  | "milestone_complete"
  | "validation_failed"
  | "rescope_limit"
  | "unclassifiable_error"
  | "cost_cap_exceeded"
  | "quota_exhausted";

export type QuotaStatus =
  | "unlimited"
  | "active"
  | "exhausted"
  | "window_expired";
/**
 * User-initiated decision on a checkpoint.
 *
 * To re-plan the failing milestone, the user approves AND provides
 * `rescopeGuidance` in the request body. The previous "rescope" union
 * member was overloaded — it conflated user re-plan requests with the
 * negotiator's internal re-plan verdict, and led to the mission-runner
 * killing missions on user rescope (see #12436).
 */
export type CheckpointDecision = "approve" | "reject";

// Compression
export type CompressionTrigger =
  | "post_milestone"
  | "manual"
  | "budget_threshold";

// Prepared sessions / durable execution queue
// NOTE: only roles that are actually produced by the orchestrator are listed
// here. `researcher` / `merge_manager` / `final_audit` were defined but never
// produced or consumed anywhere — removed during the dead-code audit (#116).
export type PreparedAgentRole =
  | "orchestrator"
  | "worker"
  | "validator_scrutiny"
  | "validator_user_testing";

export type PreparedAgentSessionStatus =
  | "prepared"
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

export type ExecutionJobType =
  | "mission_start"
  | "mission_resume"
  | "mission_abort"
  | "agent_session_start"
  | "agent_session_resume"
  | "agent_session_cancel"
  | "validator_start"
  | "checkpoint_timeout"
  | "stale_reconciliation";

export type ExecutionJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale"
  | "requeued";

// NOTE: only codes that are actually produced by failure sites
// (stale-reconciler / launcher / external-dependency outages) are listed here.
// `MISSION_NO_PROGRESS`, `WORKTREE_PREP_FAILED`, `REPO_PREP_FAILED`,
// `SETUP_COMMAND_FAILED`, `QUOTA_EXHAUSTED`, `VALIDATION_TIMEOUT`, and
// `USER_ABORTED` were defined but never produced or consumed — removed during
// the dead-code audit (#116).
export type ExecutionFailureCode =
  | "CLAIM_EXPIRED"
  | "HEARTBEAT_TIMEOUT"
  | "SESSION_START_TIMEOUT"
  | "SESSION_LOST"
  | "PINYX_UNAVAILABLE"
  | "LAPIS_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "MAX_ATTEMPTS_EXHAUSTED"
  | "MISSION_FAILED"
  | "MISSION_ABORTED"
  | "UNKNOWN";
