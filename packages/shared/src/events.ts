import type {
  MissionStatus,
  MilestoneStatus,
  WorkerStatus,
  NegotiatorVerdict,
  BroadcastCategory,
  CheckpointTrigger,
} from './enums.js';
import type { ValidationContract, Handoff, ResearchFinding, CostEntry } from './types.js';

export type WsEventType =
  | 'mission_started'
  | 'milestone_started'
  | 'worker_spawned'
  | 'worker_progress'
  | 'worker_completed'
  | 'worker_timeout'
  | 'worker_rejected'
  | 'broadcast_written'
  | 'validator_started'
  | 'validator_verdict'
  | 'negotiator_decision'
  | 'checkpoint_required'
  | 'milestone_completed'
  | 'milestone_failed'
  | 'mission_completed'
  | 'mission_failed'
  | 'cost_update';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  missionId: string;
  milestoneId?: string;
  timestamp: string;
  data: T;
}

export interface MissionStartedData {
  description: string;
  milestoneCount: number;
}

export interface MilestoneStartedData {
  seq: number;
  title: string;
  workingUnitCount: number;
}

export interface WorkerSpawnedData {
  workingUnitId: string;
  title: string;
  batchIndex: number;
}

export interface WorkerProgressData {
  workingUnitId: string;
  message: string;
}

export interface WorkerCompletedData {
  workingUnitId: string;
  title: string;
  handoffSummary: string;
}

export interface WorkerTimeoutData {
  workingUnitId: string;
  title: string;
}

export interface WorkerRejectedData {
  workingUnitId: string;
  title: string;
  rejectionReason: string;
}

export interface BroadcastWrittenData {
  broadcastId: string;
  category: BroadcastCategory;
  content: string;
}

export interface ValidatorStartedData {
  validatorAId: string;
  validatorBId: string;
}

export interface ValidatorVerdictData {
  validatorRole: 'implementation_reviewer' | 'contract_checker';
  verdict: 'pass' | 'fail';
  findings: string;
}

export interface NegotiatorDecisionData {
  verdict: NegotiatorVerdict;
  reasoning: string;
}

export interface CheckpointRequiredData {
  milestoneId: string;
  trigger: CheckpointTrigger;
  milestoneTitle: string;
  validationContracts: ValidationContract[];
  handoffs: Handoff[];
  validatorFindings: ResearchFinding[];
  retryCount: number;
  rescopeCount: number;
}

export interface MilestoneCompletedData {
  seq: number;
  title: string;
}

export interface MilestoneFailedData {
  seq: number;
  title: string;
  reason: string;
}

export interface MissionCompletedData {
  totalCost: number;
  durationMs: number;
}

export interface MissionFailedData {
  reason: string;
}

export interface CostUpdateData {
  costEntry: CostEntry;
  runningTotal: number;
}
