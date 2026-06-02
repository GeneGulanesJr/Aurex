// packages/shared/src/rest.ts
import type { Mission, Milestone, WorkingUnit, CostSummary } from "./types.js";

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
  decision: "approve" | "reject" | "rescope";
  guidance?: string;
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
