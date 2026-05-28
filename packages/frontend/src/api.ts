import type { CheckpointDecision, CostSummary, Milestone, Mission, WorkingUnit, MissionStatus } from "@aurex/shared";
import type { CreateMissionResponse, GetMissionResponse, CheckpointResponse, HealthResponse } from "@aurex/shared";

export type CurrentMissionPayload = GetMissionResponse;

export interface ActiveMission {
  missionId: string;
  state: string;
  queuePosition?: number;
}

function authHeaders(): HeadersInit {
  const token = import.meta.env.VITE_AUREX_API_KEY;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, { ...opts, headers: { ...authHeaders(), ...opts?.headers } });
}

export async function createMission(description: string): Promise<CreateMissionResponse> {
  const res = await apiFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json() as Promise<CreateMissionResponse>;
}

export async function getCurrentMission(): Promise<CurrentMissionPayload | null> {
  const res = await apiFetch("/api/missions/current");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to hydrate current mission: ${res.status}`);
  return res.json() as Promise<CurrentMissionPayload>;
}

export async function getActiveMissions(): Promise<{ missions: ActiveMission[] }> {
  const res = await apiFetch("/api/missions/active");
  if (!res.ok) throw new Error(`Failed to fetch active missions: ${res.status}`);
  return res.json() as Promise<{ missions: ActiveMission[] }>;
}

export async function getMission(id: string): Promise<CurrentMissionPayload> {
  const res = await apiFetch(`/api/missions/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch mission: ${res.status}`);
  return res.json() as Promise<CurrentMissionPayload>;
}

export async function abortMission(missionId: string) {
  const res = await apiFetch(`/api/missions/${missionId}/abort`, { method: "POST" });
  return res.json() as Promise<{ aborted: boolean }>;
}

export async function submitCheckpoint(
  missionId: string,
  checkpointId: string,
  decision: CheckpointDecision,
  guidance?: string,
  reason?: string,
): Promise<CheckpointResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/checkpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, decision, guidance, reason }),
  });
  return res.json() as Promise<CheckpointResponse>;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await apiFetch("/health");
  return res.json() as Promise<HealthResponse>;
}
