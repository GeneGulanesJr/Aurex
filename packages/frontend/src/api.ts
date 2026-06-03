import type { CheckpointDecision, CostSummary, Milestone, Mission, WorkingUnit, MissionStatus, BumblebeeScanResult, BumblebeeFinding, ExposureCatalog, QuotaStatus } from "@aurex/shared";
import type { CreateMissionResponse, GetMissionResponse, CheckpointResponse, HealthResponse, AgentLogResponse, TriggerScanResponse, ListScansResponse, GetScanResultsResponse, BumblebeeStatusResponse, QuotaStatusResponse, PrefireRequest, PrefireResponse, CalculatePrefireRequest, CalculatePrefireResponse } from "@aurex/shared";

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

export async function restartMission(missionId: string): Promise<{ restarted: boolean; missionId: string; status: string }> {
  const res = await apiFetch(`/api/missions/${missionId}/restart`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to restart mission: ${res.status}`);
  return res.json() as Promise<{ restarted: boolean; missionId: string; status: string }>;
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

export async function getAgentLogs(missionId: string): Promise<AgentLogResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/agent-logs`);
  if (!res.ok) throw new Error(`Failed to fetch agent logs: ${res.status}`);
  return res.json() as Promise<AgentLogResponse>;
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

export interface GitHubConfigResponse {
  configured: boolean;
  client_id: string | null;
  callback_url: string | null;
  has_client_secret: boolean;
  has_private_key: boolean;
}

export interface GitHubConfigPayload {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  callbackUrl: string;
  frontendUrl: string;
}

export async function getGitHubConfig(): Promise<GitHubConfigResponse> {
  const res = await apiFetch("/api/github/config");
  if (!res.ok) throw new Error(`Failed to fetch GitHub config: ${res.status}`);
  return res.json() as Promise<GitHubConfigResponse>;
}

export async function saveGitHubConfig(payload: GitHubConfigPayload): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save GitHub config: ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}

export async function getGitHubConnectUrl(): Promise<{ url: string }> {
  const res = await apiFetch("/api/github/connect");
  if (!res.ok) throw new Error(`Failed to start GitHub OAuth: ${res.status}`);
  return res.json() as Promise<{ url: string }>;
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

export interface PrepareGitHubRepoResponse {
  fullName: string;
  repoPath: string;
  repoStatus: "cloned" | "updated";
  indexed: boolean;
  indexingStatus: "completed" | "unavailable" | "failed";
}

export async function prepareGitHubRepo(cloneUrl: string): Promise<PrepareGitHubRepoResponse> {
  const res = await apiFetch("/api/github/repos/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cloneUrl }),
  });
  if (!res.ok) throw new Error(`Failed to prepare GitHub repo: ${res.status}`);
  return res.json() as Promise<PrepareGitHubRepoResponse>;
}

export async function disconnectGitHub(): Promise<{ success: boolean }> {
  const res = await apiFetch("/api/github/disconnect", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to disconnect GitHub: ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}

export interface PinyxStatusResponse {
  configured: boolean;
  endpoint: string | null;
}

export async function getPinyxStatus(): Promise<PinyxStatusResponse> {
  const res = await apiFetch("/api/pinyx/status");
  if (!res.ok) throw new Error(`Failed to fetch PiNyx status: ${res.status}`);
  return res.json() as Promise<PinyxStatusResponse>;
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

// Code Context
export interface CodeSummaryResponse {
  files: number;
  symbols: number;
  edges: number;
  modules: Array<{ name: string; fileCount: number }>;
  entryPoints: string[];
  cycles: { count: number; paths: string[][] };
}

export interface CodeGraphResponse {
  nodes: Array<{ id: string; module: string; symbols: number; importance: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  cycles: string[][];
}

export interface CodeHotspotsResponse {
  files: Array<{ path: string; module: string; complexity: number; symbols: number }>;
}

export async function getCodeSummary(missionId: string): Promise<CodeSummaryResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/code/summary`);
  if (!res.ok) throw new Error(`Failed to fetch code summary: ${res.status}`);
  return res.json() as Promise<CodeSummaryResponse>;
}

export async function getCodeGraph(missionId: string): Promise<CodeGraphResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/code/graph`);
  if (!res.ok) throw new Error(`Failed to fetch code graph: ${res.status}`);
  return res.json() as Promise<CodeGraphResponse>;
}

export async function getCodeHotspots(missionId: string): Promise<CodeHotspotsResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/code/hotspots`);
  if (!res.ok) throw new Error(`Failed to fetch code hotspots: ${res.status}`);
  return res.json() as Promise<CodeHotspotsResponse>;
}

// Bumblebee supply-chain scanner
export async function getBumblebeeStatus(): Promise<BumblebeeStatusResponse> {
  const res = await apiFetch("/api/bumblebee/status");
  if (!res.ok) throw new Error(`Failed to fetch bumblebee status: ${res.status}`);
  return res.json() as Promise<BumblebeeStatusResponse>;
}

export async function triggerScan(
  missionId: string,
  options?: { profile?: "baseline" | "project" | "deep"; ecosystems?: string[] },
): Promise<TriggerScanResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {}),
  });
  if (!res.ok) throw new Error(`Failed to trigger scan: ${res.status}`);
  return res.json() as Promise<TriggerScanResponse>;
}

export async function listScans(missionId: string): Promise<ListScansResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/scans`);
  if (!res.ok) throw new Error(`Failed to list scans: ${res.status}`);
  return res.json() as Promise<ListScansResponse>;
}

export async function getScanResults(missionId: string, scanId: string): Promise<GetScanResultsResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/scans/${scanId}`);
  if (!res.ok) throw new Error(`Failed to get scan results: ${res.status}`);
  return res.json() as Promise<GetScanResultsResponse>;
}

export async function getExposureCatalog(): Promise<{ catalog: ExposureCatalog | null }> {
  const res = await apiFetch("/api/bumblebee/catalog");
  if (!res.ok) throw new Error(`Failed to fetch exposure catalog: ${res.status}`);
  return res.json() as Promise<{ catalog: ExposureCatalog | null }>;
}

export async function saveExposureCatalog(catalog: ExposureCatalog): Promise<{ saved: boolean }> {
  const res = await apiFetch("/api/bumblebee/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(catalog),
  });
  if (!res.ok) throw new Error(`Failed to save exposure catalog: ${res.status}`);
  return res.json() as Promise<{ saved: boolean }>;
}

export async function getQuotaStatus(): Promise<QuotaStatusResponse> {
  const res = await apiFetch("/api/quota");
  if (!res.ok) throw new Error(`Failed to fetch quota status: ${res.status}`);
  return res.json() as Promise<QuotaStatusResponse>;
}

export async function prefireQuota(opts?: PrefireRequest): Promise<PrefireResponse> {
  const res = await apiFetch("/api/quota/prefire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error(`Failed to prefire quota: ${res.status}`);
  return res.json() as Promise<PrefireResponse>;
}

export async function resetQuota(): Promise<QuotaStatusResponse> {
  const res = await apiFetch("/api/quota/reset", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to reset quota: ${res.status}`);
  return res.json() as Promise<QuotaStatusResponse>;
}

export async function calculatePrefire(opts: CalculatePrefireRequest): Promise<CalculatePrefireResponse> {
  const res = await apiFetch("/api/quota/calculate-prefire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Failed to calculate prefire: ${res.status}`);
  return res.json() as Promise<CalculatePrefireResponse>;
}
