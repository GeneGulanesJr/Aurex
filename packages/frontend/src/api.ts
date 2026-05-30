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

export async function createMission(description: string, cloneUrl?: string): Promise<CreateMissionResponse> {
  const body: Record<string, string> = { description };
  if (cloneUrl) body.cloneUrl = cloneUrl;
  const res = await apiFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create mission: ${res.status}`);
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

export interface GitHubStatusResponse {
  connected: boolean;
  user: { login: string; avatar_url: string; name: string | null } | null;
}

export interface GitHubRepoResponse {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export async function connectGitHub(token: string): Promise<GitHubStatusResponse> {
  const res = await apiFetch("/api/github/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`Failed to connect GitHub: ${res.status}`);
  return res.json() as Promise<GitHubStatusResponse>;
}

export async function getGitHubStatus(): Promise<GitHubStatusResponse> {
  const res = await apiFetch("/api/github/status");
  if (!res.ok) throw new Error(`Failed to fetch GitHub status: ${res.status}`);
  return res.json() as Promise<GitHubStatusResponse>;
}

export async function getGitHubRepos(): Promise<GitHubRepoResponse[]> {
  const res = await apiFetch("/api/github/repos");
  if (!res.ok) throw new Error(`Failed to fetch GitHub repos: ${res.status}`);
  return res.json() as Promise<GitHubRepoResponse[]>;
}

export async function disconnectGitHub(): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/disconnect", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to disconnect GitHub: ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}

export interface PinyxProviderConfigResponse {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey?: boolean;
  apiKey?: string;
}

export interface PinyxConfigResponse {
  endpoint: string;
  modelHints: Record<string, string>;
  providers: PinyxProviderConfigResponse[];
}

export async function getPinyxConfig(): Promise<PinyxConfigResponse> {
  const res = await apiFetch("/api/pinyx/config");
  if (!res.ok) throw new Error(`Failed to fetch PiNyx config: ${res.status}`);
  return res.json() as Promise<PinyxConfigResponse>;
}

export async function savePinyxConfig(config: PinyxConfigResponse): Promise<PinyxConfigResponse> {
  const res = await apiFetch("/api/pinyx/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to save PiNyx config: ${res.status}`);
  return res.json() as Promise<PinyxConfigResponse>;
}

export async function getPinyxModels(): Promise<{ models: Array<{ id?: string; name?: string }> }> {
  const res = await apiFetch("/api/pinyx/models");
  if (!res.ok) throw new Error(`Failed to fetch PiNyx models: ${res.status}`);
  return res.json() as Promise<{ models: Array<{ id?: string; name?: string }> }>;
}
