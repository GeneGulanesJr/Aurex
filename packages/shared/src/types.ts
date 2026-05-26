import type {
  MissionStatus,
  MilestoneStatus,
  WorkerStatus,
  NegotiatorVerdict,
  BroadcastCategory,
  BroadcastLifecycle,
  CheckpointTrigger,
  CheckpointDecision,
  ResearchLifecycle,
  ResearchRelevance,
  ResearchSource,
} from './enums.js';

export interface Mission {
  id: string;
  description: string;
  status: MissionStatus;
  planJson: string | null;
  configJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MissionConfig {
  workerTimeoutMs: number;
  validatorTimeoutMs: number;
  researchTimeoutMs: number;
  maxRetryCount: number;
  maxRescopeCount: number;
  maxMilestoneCount: number;
}

export interface Milestone {
  id: string;
  missionId: string;
  seq: number;
  title: string;
  description: string;
  status: MilestoneStatus;
  validationContractsJson: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ValidationContract {
  id: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface WorkingUnit {
  id: string;
  milestoneId: string;
  missionId: string;
  title: string;
  description: string;
  taskSpecJson: string;
  filePathsJson: string;
  modulesJson: string;
  status: WorkerStatus;
  piPid: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Handoff {
  id: string;
  workingUnitId: string;
  missionId: string;
  milestoneId: string;
  workerOutput: string;
  filesModifiedJson: string;
  rationale: string;
  assumptionsJson: string;
  summary: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Broadcast {
  id: string;
  missionId: string;
  milestoneId: string;
  sourceWorkerId: string | null;
  content: string;
  category: BroadcastCategory;
  lifecycle: BroadcastLifecycle;
  supersededBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchFinding {
  id: string;
  missionId: string;
  milestoneId: string;
  prompt: string;
  findings: string;
  source: ResearchSource;
  relevance: ResearchRelevance;
  lifecycle: ResearchLifecycle;
  supersededBy: string | null;
  createdAt: string;
}

export interface RetryCounter {
  id: string;
  missionId: string;
  milestoneId: string;
  workingUnitId: string | null;
  retryType: 'worker_timeout' | 'validation_fail' | 'negotiation_retry';
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RescopeEvent {
  id: string;
  missionId: string;
  milestoneId: string;
  originalSpecJson: string;
  revisedSpecJson: string;
  reason: string;
  triggeredBy: 'negotiator' | 'human' | 'system';
  createdAt: string;
}

export interface CostEntry {
  id: string;
  missionId: string;
  milestoneId: string | null;
  workingUnitId: string | null;
  role: 'planner' | 'worker' | 'validator' | 'negotiator' | 'researcher';
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  provider: string | null;
  createdAt: string;
}

export interface CheckpointEvent {
  missionId: string;
  milestoneId: string;
  trigger: CheckpointTrigger;
  context: {
    milestoneTitle: string;
    milestoneDescription: string;
    validationContracts: ValidationContract[];
    handoffs: Handoff[];
    validatorFindings: ResearchFinding[];
    negotiatorReasoning: string | null;
    retryCount: number;
    rescopeCount: number;
  };
}

export interface CheckpointSubmission {
  decision: CheckpointDecision;
  overrideReason?: string;
  revisedSpec?: string;
}

export interface PlannedMilestone {
  title: string;
  description: string;
  workingUnits: PlannedWorkingUnit[];
  validationContracts: ValidationContract[];
}

export interface PlannedWorkingUnit {
  title: string;
  description: string;
  taskSpec: string;
  filePaths: string[];
  modules: string[];
}

export interface SerializationMap {
  batches: WorkingUnitBatch[];
}

export interface WorkingUnitBatch {
  batchIndex: number;
  unitIds: string[];
  dependsOnBatches: number[];
}

export interface NegotiatorDecision {
  verdict: NegotiatorVerdict;
  reasoning: string;
  rescopedSpec?: string;
  retryUnits?: string[];
}
