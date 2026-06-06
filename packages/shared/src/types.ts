// packages/shared/src/types.ts
import type {
  MissionStatus, MilestoneStatus, AgentType, AgentStatus, WorkerStatus,
  BroadcastLifecycle, BroadcastCategory, ResearchLifecycle, ResearchRelevance,
  NegotiatorVerdict, CompressionTrigger, CheckpointDecision, CheckpointTrigger,
  QuotaStatus,
} from "./enums.js";

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
  cloneUrl?: string;
  repoRoot?: string;
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

export interface HandoffRecord extends Handoff {
  id: string;
  missionId: string;
  milestoneId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
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

export interface PlannedWorkingUnit extends WorkingUnitSpec {}

export interface PlannedMilestone {
  title: string;
  description: string;
  units: PlannedWorkingUnit[];
  criteria: string[];
  testCommands: string[];
}

export interface MemoryResult {
  id: number;
  title: string;
  content: string;
  type: string;
  scope: string;
  topicKey: string | null;
}

export type TodoLedgerStatus = "planning" | "ready" | "in_progress" | "blocked" | "validating" | "completed" | "cancelled";
export type TodoStatus = "pending" | "ready" | "in_progress" | "blocked" | "implemented" | "validating" | "needs_changes" | "passed" | "merged" | "cancelled";
export type TodoType = "discovery" | "implementation" | "test" | "refactor" | "validation" | "documentation";
export type TodoPriority = "low" | "medium" | "high";
export type TodoRiskLevel = "low" | "medium" | "high";
export type TodoConfidence = "low" | "medium" | "high";

export interface TodoEvidence {
  branch: string | null;
  commits: string[];
  changedFiles: string[];
  testsRun: Array<{ command: string; exitCode?: number; output?: string } | string>;
  testResults: unknown[];
  validatorVerdict: unknown | null;
  notes: string[];
}

export interface MissionTodo {
  id: string;
  missionId: string;
  title: string;
  status: TodoStatus;
  type: TodoType;
  priority: TodoPriority;
  dependsOn: string[];
  goal: string;
  scope: { in: string[]; out: string[] };
  likelyFiles: string[];
  lapisContextQuery: string;
  acceptanceCriteria: string[];
  validationCriteria: string[];
  testCommands: string[];
  riskLevel: TodoRiskLevel;
  workerInstructions: string[];
  validatorInstructions: string[];
  escalationRules: string[];
  evidence: TodoEvidence;
  confidence: TodoConfidence;
  assignedWorkerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionTodoInput {
  id?: string;
  title: string;
  status?: TodoStatus;
  type?: TodoType;
  priority?: TodoPriority;
  dependsOn?: string[];
  goal?: string;
  scope?: { in: string[]; out: string[] };
  likelyFiles?: string[];
  lapisContextQuery?: string;
  acceptanceCriteria?: string[];
  validationCriteria?: string[];
  testCommands?: string[];
  riskLevel?: TodoRiskLevel;
  workerInstructions?: string[];
  validatorInstructions?: string[];
  escalationRules?: string[];
  evidence?: Partial<TodoEvidence>;
  confidence?: TodoConfidence;
}

export interface MissionTodoLedger {
  missionId: string;
  missionTitle: string;
  status: TodoLedgerStatus;
  sourceMission: string;
  plannerSummary: string;
  acceptanceCriteria: string[];
  constraints: string[];
  assumptions: string[];
  humanQuestions: string[];
  todos: MissionTodo[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionTodoLedgerInput {
  missionId: string;
  missionTitle: string;
  status?: TodoLedgerStatus;
  sourceMission: string;
  plannerSummary: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  assumptions?: string[];
  humanQuestions?: string[];
}

export interface TodoEvent {
  id: string;
  missionId: string;
  todoId: string | null;
  eventType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TodoContextResult {
  todoId: string;
  query: string;
  context: MemoryResult[];
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
  summary?: string;
  [k: string]: unknown;
}

export interface AgentSpec {
  taskId: string;
  instructions: string;
  declaredPaths: string[];
  declaredModules: string[];
}

export interface CheckpointRecord {
  id: string;
  missionId: string;
  trigger: CheckpointTrigger;
  milestoneId: string;
  summary: string;
  status: "pending" | "resolved";
  decision?: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface BumblebeeScanResult {
  id: string;
  missionId: string;
  profile: "baseline" | "project" | "deep";
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  summary?: BumblebeeScanSummary;
  findings?: BumblebeeFinding[];
}

export interface BumblebeeScanSummary {
  totalPackages: number;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  ecosystems: string[];
}

export interface BumblebeePackage {
  id: string;
  scanId: string;
  ecosystem: string;
  packageName: string;
  normalizedName: string;
  version: string;
  projectPath?: string;
  packageManager?: string;
  sourceType: string;
  sourceFile: string;
  confidence: "high" | "medium" | "low";
}

export interface BumblebeeFinding {
  id: string;
  scanId: string;
  missionId: string;
  findingType: string;
  severity: "critical" | "high" | "medium" | "low";
  catalogId: string;
  catalogName: string;
  ecosystem: string;
  packageName: string;
  normalizedName: string;
  version: string;
  sourceType: string;
  sourceFile: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface ExposureCatalog {
  schema_version: string;
  entries: ExposureCatalogEntry[];
}

export interface ExposureCatalogEntry {
  id: string;
  name: string;
  ecosystem: string;
  package: string;
  versions: string[];
  severity: "critical" | "high" | "medium" | "low";
}

export interface QuotaWindow {
  windowStart: string;
  windowDurationMs: number;
  burnDurationMs: number;
  firstLLMCallAt: string | null;
  isActive: boolean;
  lastActiveAt: string | null;
}

export interface QuotaProviderQuotaConfig {
  providerId: string;
  tracked: boolean;
  windowDurationMs?: number;
  burnDurationMs?: number;
}

export interface QuotaConfig {
  enabled: boolean;
  windowDurationMs: number;
  burnDurationMs: number;
  providers: QuotaProviderQuotaConfig[];
}

export interface QuotaProviderStatus {
  providerId: string;
  tracked: boolean;
  enabled: boolean;
  status: QuotaStatus;
  windowStart: string | null;
  windowEnd: string | null;
  burnDurationMs: number;
  windowDurationMs: number;
  firstLLMCallAt: string | null;
  burnExpiresAt: string | null;
  remainingBurnMs: number;
  remainingWindowMs: number;
}
