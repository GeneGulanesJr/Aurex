export type MissionStatus = 'planning' | 'running' | 'paused' | 'complete' | 'failed';

export type MilestoneStatus =
  | 'pending'
  | 'in_progress'
  | 'validating'
  | 'passed'
  | 'failed'
  | 'rescoped';

export type WorkerStatus =
  | 'pending'
  | 'spawned'
  | 'running'
  | 'completed'
  | 'timed_out'
  | 'rejected';

export type NegotiatorVerdict = 'pass' | 'retry' | 'rescope' | 'escalate';

export type BroadcastCategory = 'info' | 'warning' | 'decision' | 'blocker';
export type BroadcastLifecycle = 'active' | 'superseded' | 'resolved' | 'expired';

export type ResearchLifecycle = 'active' | 'superseded' | 'archived';
export type ResearchRelevance = 'high' | 'medium' | 'low';
export type ResearchSource = 'subagent' | 'validator' | 'negotiator';

export type CheckpointTrigger =
  | 'milestone_approval'
  | 'rescope_limit'
  | 'unclassifiable_error'
  | 'timeout';

export type CheckpointDecision = 'approve' | 'reject' | 'override';
