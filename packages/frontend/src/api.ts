import type { CheckpointDecision, CostSummary, Milestone, Mission, WorkingUnit } from "@aurex/shared";

export interface CurrentMissionPayload {
  mission: Mission;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary;
}

export async function createMission(description: string) {
  const res = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json() as Promise<{ missionId: string; status: string }>;
}

export async function getCurrentMission(): Promise<CurrentMissionPayload | null> {
  const res = await fetch("/api/missions/current");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to hydrate current mission: ${res.status}`);
  return res.json() as Promise<CurrentMissionPayload>;
}

export async function submitCheckpoint(
  missionId: string,
  checkpointId: string,
  decision: CheckpointDecision,
  guidance?: string,
  reason?: string,
) {
  const res = await fetch(`/api/missions/${missionId}/checkpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, decision, guidance, reason }),
  });
  return res.json() as Promise<{ accepted: boolean; duplicate?: boolean }>;
}

export async function getHealth() {
  const res = await fetch("/health");
  return res.json() as Promise<{ status: string; lapis: boolean; pinyx: boolean }>;
}
