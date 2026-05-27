// packages/shared/src/enums.ts

// Mission lifecycle
export type MissionStatus = "planning" | "running" | "paused" | "completed" | "failed" | "aborted";
export type MilestoneStatus = "planned" | "in_progress" | "validating" | "completed" | "failed";

// Agent statuses
export type AgentStatus = "spawned" | "planning" | "working" | "reviewing" | "researching" | "committing" | "completed" | "timed_out" | "failed";
export type WorkerStatus = "planned" | "spawned" | "working" | "committing" | "completed" | "timed_out" | "failed";

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
export type CheckpointTrigger = "milestone_complete" | "rescope_limit" | "unclassifiable_error" | "cost_cap_exceeded";
export type CheckpointDecision = "approve" | "reject" | "rescope";

// Compression
export type CompressionTrigger = "post_milestone" | "manual" | "budget_threshold";
