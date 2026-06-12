// packages/shared/src/rest.ts
import type { Mission, Milestone, WorkingUnit, CostSummary, BumblebeeScanResult, BumblebeeFinding, ExposureCatalog, QuotaProviderStatus } from "./types.js";

export interface CreateMissionRequest {
  description: string;
}

export interface CreateMissionResponse {
  missionId: string;
  status: Mission["status"];
}

export interface GetMissionResponse {
  mission: Mission;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary;
}

export interface CheckpointRequest {
  checkpointId: string;
  decision: "approve" | "reject";
  /**
   * Optional re-plan request. When present alongside decision: "approve",
   * the orchestrator re-plans the failing milestone via PiNyx before
   * continuing the loop. The string is passed as guidance to the model.
   */
  rescopeGuidance?: string;
  /** Free-form reason, surfaced in the mission log. */
  reason?: string;
}

export interface CheckpointResponse {
  accepted: boolean;
  duplicate?: boolean;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  lapis: boolean;
  pinyx: boolean;
}

export interface AgentLogEntryResponse {
  sessionId: string;
  agentType: string;
  missionId: string;
  milestoneId: string;
  unitId?: string;
  event: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface AgentLogResponse {
  logs: AgentLogEntryResponse[];
}

export interface TriggerScanRequest {
  missionId: string;
  profile?: "baseline" | "project" | "deep";
  ecosystems?: string[];
  exposureCatalogPath?: string;
}

export interface TriggerScanResponse {
  scanId: string;
  status: "running";
}

export interface GetScanResultsResponse {
  scan: BumblebeeScanResult;
  findings: BumblebeeFinding[];
  packageCount: number;
}

export interface ListScansResponse {
  scans: BumblebeeScanResult[];
}

export interface BumblebeeStatusResponse {
  available: boolean;
  version?: string;
  path?: string;
}

export interface ExposureCatalogResponse {
  catalog: ExposureCatalog | null;
}

export interface QuotaStatusResponse {
  enabled: boolean;
  providers: QuotaProviderStatus[];
}

export interface QuotaConfigUpdateRequest {
  enabled?: boolean;
  windowDurationMs?: number;
  burnDurationMs?: number;
  providers?: Array<{ providerId: string; tracked: boolean; windowDurationMs?: number; burnDurationMs?: number }>;
}

export interface PrefireRequest {
  burnDurationMs?: number;
  windowDurationMs?: number;
}

export interface PrefireResponse {
  windowStart: string;
  windowEnd: string;
  burnDurationMs: number;
  prefireAdvice: string;
}

export interface CalculatePrefireRequest {
  desiredStartTime: string;
  burnDurationMs?: number;
  windowDurationMs?: number;
}

export interface CalculatePrefireResponse {
  prefireTime: string;
  desiredStartTime: string;
  burnDurationMs: number;
  windowDurationMs: number;
  timeline: Array<{ time: string; event: string }>;
}

export interface UpdateStatusResponse {
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  behindBy: number;
  lastChecked: string | null;
}
