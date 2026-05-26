import type { PlannedMilestone, ValidationContract, PlannedWorkingUnit } from './types.js';

export interface CreateMissionRequest {
  description: string;
}

export interface CreateMissionResponse {
  missionId: string;
  plan: {
    milestones: PlannedMilestone[];
  };
}

export interface GetMissionResponse {
  id: string;
  description: string;
  status: string;
  currentMilestone: string | null;
  milestones: MilestoneSummary[];
  activeWorkers: ActiveWorker[];
  recentBroadcasts: BroadcastSummary[];
  costTotal: number;
  retryCount: number;
  rescopeCount: number;
}

export interface MilestoneSummary {
  id: string;
  seq: number;
  title: string;
  status: string;
}

export interface ActiveWorker {
  id: string;
  title: string;
  status: string;
  elapsedMs: number;
}

export interface BroadcastSummary {
  id: string;
  category: string;
  content: string;
  createdAt: string;
}

export interface ListMissionsResponse {
  missions: MissionListItem[];
  total: number;
}

export interface MissionListItem {
  id: string;
  description: string;
  status: string;
  createdAt: string;
}

export interface CheckpointResponse {
  accepted: boolean;
}
