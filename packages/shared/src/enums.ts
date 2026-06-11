// packages/shared/src/enums.ts

// Mission lifecycle
export type MissionStatus = "planning" | "running" | "paused" | "completed" | "failed" | "aborted";
export type MilestoneStatus = "planned" | "in_progress" | "validating" | "rescoping" | "retrying" | "completed" | "failed";

// Agent statuses
export type AgentStatus = "spawned" | "planning" | "working" | "reviewing" | "researching" | "committing" | "completed" | "timed_out" | "failed";
export type WorkerStatus = "planned" | "spawned" | "working" | "committing" | "completed" | "timed_out" | "failed" | "superseded";

// Agent types
export type AgentType = "orchestrator" | "worker" | "validator_scrutiny" | "validator_user_testing" | "research";

// Negotiation
export type NegotiatorVerdict = "pass" | "retry" | "rescope" | "escalate";

// Broadcasts
export type BroadcastLifecycle = "active" | "superseded" | "archived" | "expired";
export type BroadcastCategory = "info" | "warning" | "decision" | "constraint";

// Research
export type ResearchLifecycle = "unverified" | "verified" | "superseded" | "rejected" | "expired";
export type ResearchRelevance = "high" | "medium" | "low";

// Checkpoints
export type CheckpointTrigger = "milestone_complete" | "validation_failed" | "rescope_limit" | "unclassifiable_error" | "cost_cap_exceeded" | "quota_exhausted";

export type QuotaStatus = "unlimited" | "active" | "exhausted" | "window_expired";
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
export type CompressionTrigger = "post_milestone" | "manual" | "budget_threshold";
