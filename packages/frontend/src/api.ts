import type { CheckpointDecision } from "@aurex/shared";

export async function createMission(description: string) {
  const res = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json() as Promise<{ missionId: string; status: string }>;
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
