// packages/shared/src/types.ts
import type {
  MissionStatus, MilestoneStatus, AgentType, AgentStatus, WorkerStatus,
  BroadcastLifecycle, BroadcastCategory, ResearchLifecycle, ResearchRelevance,
  NegotiatorVerdict, CompressionTrigger,
} from "./enums";

export interface Mission {
  id: string;
  description: string;
  status: MissionStatus;
  configJson: MissionConfig;
  createdAt: string;
}

export interface MissionConfig {
  modelHints: Record<AgentType, string>;
  workerTimeouts: { simple: number; build: number; testHeavy: number };
  costCap: number;
  maxValidatorRetries: number;
  maxRescopes: number;
}

export interface Milestone {
  id: string;
  missionId: string;
  title: string;
  description: string;
  orderIndex: number;
  status: MilestoneStatus;
  validationContractId: string;
}

export interface WorkingUnit {
  id: string;
  milestoneId: string;
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
  status: WorkerStatus;
  taskBranch: string;
  worktreePath: string;
  sessionId: string;
}

export interface ValidationContract {
  id: string;
  milestoneId: string;
  version: number;
  content: ValidationContractContent;
  supersedes: string | null;
  supersededBy: string | null;
  rescopeEventId: string | null;
  createdAt: string;
}

export interface ValidationContractContent {
  criteria: string[];
  testCommands: string[];
  acceptanceBehavior: string;
}

export interface Handoff {
  unitId: string;
  featureName: string;
  description: string;
  implemented: string;
  remaining: string;
  rationale: string;
  assumptions: string;
  unresolvedUncertainties: string;
  errorsEncountered: string;
  commandsRun: { command: string; exitCode: number }[];
  gitCommitHash: string;
}

export interface HandoffResult {
  accepted: boolean;
  errors: string[];
}

export interface Broadcast {
  id: string;
  missionId: string;
  authorId: string;
  authorType: AgentType;
  category: BroadcastCategory;
  title: string;
  content: string;
  status: BroadcastLifecycle;
  ttl: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ResearchFinding {
  id: string;
  missionId: string;
  authorId: string;
  domain: string[];
  title: string;
  content: string;
  relevance: ResearchRelevance;
  status: ResearchLifecycle;
  verifiedTaskId: string | null;
  ttl: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AgentSessionRecord {
  sessionId: string;
  agentType: AgentType;
  missionId: string;
  milestoneId: string | null;
  unitId: string | null;
  spawnedAt: string;
  terminatedAt: string | null;
}

export interface CostEntry {
  id: string;
  missionId: string;
  agentSessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  entries: number;
}

export interface RescopeEvent {
  id: string;
  milestoneId: string;
  contractId: string;
  reason: string;
  previousScope: string;
  newScope: string;
  timestamp: string;
}

export interface ValidationVerdict {
  id: string;
  milestoneId: string;
  contractId: string;
  validatorType: "validator_scrutiny" | "validator_user_testing";
  sessionId: string;
  verdict: "pass" | "fail";
  classification?: "patchable" | "blocking";
  findings: string;
  failedUnitIds: string[];
  timestamp: string;
}

export interface RetryCounter {
  milestoneId: string;
  retries: number;
  rescopes: number;
}

export interface WorkingUnitSpec {
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
}

export interface MilestoneSpec {
  title: string;
  description: string;
  orderIndex: number;
}

export interface MemoryResult {
  id: number;
  title: string;
  content: string;
  type: string;
  scope: string;
  topicKey: string | null;
}

export interface StandingContext {
  taskId: string;
  workerSessionId: string;
}

export interface AttemptSummary {
  milestoneId: string;
  attemptIndex: number;
  scope: string;
  outcome: string;
  cost: number;
}

export interface EscalationContext {
  trigger: "milestone_complete" | "rescope_limit" | "unclassifiable_error";
  milestoneId: string;
  summary: string;
}

export interface AgentSpec {
  taskId: string;
  instructions: string;
  declaredPaths: string[];
  declaredModules: string[];
}
