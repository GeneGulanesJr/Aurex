import type { CheckpointDecision, MutationReportSummary, MutationRunStatus, UpdateStatusResponse } from "@aurex/shared";
import type { CreateMissionResponse, GetMissionResponse, CheckpointResponse, HealthResponse, AgentLogResponse, TriggerScanResponse, ListScansResponse, QuotaStatusResponse, PrefireRequest, PrefireResponse, CalculatePrefireRequest, CalculatePrefireResponse, QuotaConfigUpdateRequest } from "@aurex/shared";

export type CurrentMissionPayload = GetMissionResponse;

export interface ActiveMission {
  missionId: string;
  state: string;
  queuePosition?: number;
  description?: string;
}

let _getToken: (() => Promise<string>) | null = null;
let _onAuthError: (() => void) | null = null;

export function setTokenGetter(fn: () => Promise<string>): void {
  _getToken = fn;
}

export function setAuthErrorHandler(fn: () => void): void {
  _onAuthError = fn;
}

async function authHeaders(): Promise<HeadersInit> {
  if (!_getToken) return {};
  try {
    const token = await _getToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    _onAuthError?.();
    throw new Error("Authentication required");
  }
}

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const headers = await authHeaders();
  return fetch(url, { ...opts, headers: { ...headers, ...opts?.headers } });
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

export async function getActiveMissions(): Promise<{ missions: ActiveMission[] }> {
  const res = await apiFetch("/api/missions/active?includeHistory=10");
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Failed to abort mission: ${res.status}`);
  }
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
  opts?: { guidance?: string; reason?: string; rescopeGuidance?: string },
): Promise<CheckpointResponse> {
  const res = await apiFetch(`/api/missions/${missionId}/checkpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, decision, ...opts }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Failed to submit checkpoint: ${res.status}`);
  }
  return res.json() as Promise<CheckpointResponse>;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await apiFetch("/health");
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
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

export async function getGitHubConfig(): Promise<GitHubConfigResponse> {
  const res = await apiFetch("/api/github/config");
  if (!res.ok) throw new Error(`Failed to fetch GitHub config: ${res.status}`);
  return res.json() as Promise<GitHubConfigResponse>;
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
  repoName: string;
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

// Repo explore (auto-explore + suggestions)
export interface ExploreRepoResponse {
  repoName: string;
  status: "completed" | "failed";
  summary?: CodeSummaryResponse;
  error?: string;
}

export type SuggestionTier = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

export type SuggestionCategory =
  | "critical_path"
  | "security"
  | "dead_code"
  | "complexity"
  | "coupling"
  | "layer_violation"
  | "test_coverage"
  | "documentation"
  | "performance"
  | "structure"
  | "naming"
  | "style";

export interface RepoSuggestion {
  id: string;
  tier: SuggestionTier;
  category: SuggestionCategory;
  title: string;
  description: string;
  affectedFiles: number;
  detail: string;
  prefill: string;
  confidence?: "high" | "medium" | "low";
  estimatedEffort?: "small" | "medium" | "large";
  estimatedRisk?: "low" | "medium" | "high";
  evidence?: Array<{ type: string; message: string; file?: string }>;
  labels?: string[];
}

export interface RepoSuggestionsResponse {
  suggestions: RepoSuggestion[];
  analysisVersion: string;
  recommended?: { highestImpact?: string; safestFirst?: string };
}

export interface RepoReadinessCommand {
  name: "install" | "test" | "typecheck" | "lint" | "build" | "dev" | "e2e";
  command: string;
  confidence: "high" | "medium" | "low";
  source: string;
  warning?: string;
}

export interface RepoReadinessProfile {
  repoName: string;
  profile: string;
  packageManager: string | null;
  languages: string[];
  frameworks: string[];
  monorepo: boolean;
  lockfiles: string[];
  commands: RepoReadinessCommand[];
  blockers: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
}

export async function exploreRepo(repoName: string): Promise<ExploreRepoResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/explore`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to explore repo: ${res.status}`);
  return res.json() as Promise<ExploreRepoResponse>;
}

export async function getRepoSummary(repoName: string): Promise<CodeSummaryResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/summary`);
  if (!res.ok) throw new Error(`Failed to fetch repo summary: ${res.status}`);
  return res.json() as Promise<CodeSummaryResponse>;
}

export async function getRepoHotspots(repoName: string): Promise<CodeHotspotsResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/hotspots`);
  if (!res.ok) throw new Error(`Failed to fetch repo hotspots: ${res.status}`);
  return res.json() as Promise<CodeHotspotsResponse>;
}

export async function getRepoSuggestions(repoName: string): Promise<RepoSuggestionsResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/suggestions`);
  if (!res.ok) throw new Error(`Failed to fetch repo suggestions: ${res.status}`);
  return res.json() as Promise<RepoSuggestionsResponse>;
}

export async function getRepoReadiness(repoName: string): Promise<RepoReadinessProfile> {
  const res = await apiFetch(`/api/repos/${repoName}/readiness`);
  if (!res.ok) throw new Error(`Failed to fetch repo readiness: ${res.status}`);
  return res.json() as Promise<RepoReadinessProfile>;
}

export async function listRepoScans(repoName: string): Promise<ListScansResponse> {
  const res = await apiFetch(`/api/repos/${repoName}/scans`);
  if (!res.ok) throw new Error(`Failed to list repo scans: ${res.status}`);
  return res.json() as Promise<ListScansResponse>;
}

// Bumblebee supply-chain scanner
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

export async function getQuotaStatus(): Promise<QuotaStatusResponse> {
  const res = await apiFetch("/api/quota");
  if (!res.ok) throw new Error(`Failed to fetch quota status: ${res.status}`);
  return res.json() as Promise<QuotaStatusResponse>;
}

export async function updateQuotaConfig(update: QuotaConfigUpdateRequest): Promise<{ ok: boolean }> {
  const res = await apiFetch("/api/quota/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`Failed to update quota config: ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
}

export async function prefireQuota(opts?: PrefireRequest & { providerId?: string }): Promise<PrefireResponse> {
  const res = await apiFetch("/api/quota/prefire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error(`Failed to prefire quota: ${res.status}`);
  return res.json() as Promise<PrefireResponse>;
}

export async function resetQuota(providerId?: string): Promise<QuotaStatusResponse> {
  const res = await apiFetch("/api/quota/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(providerId ? { providerId } : {}),
  });
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

// --- Mutation testing (Stryker on scanned repos) ---

export async function getMutationSummary(repoName: string): Promise<MutationReportSummary> {
  const res = await apiFetch(`/api/repos/${repoName}/mutation`);
  if (!res.ok) throw new Error(`Failed to get mutation summary: ${res.status}`);
  return res.json() as Promise<MutationReportSummary>;
}

export async function runMutationTests(repoName: string): Promise<{ runId: string; status: string; startedAt: string }> {
  const res = await apiFetch(`/api/repos/${repoName}/mutation/run`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start mutation run: ${res.status}`);
  return res.json() as Promise<{ runId: string; status: string; startedAt: string }>;
}

export async function getMutationRunStatus(repoName: string, runId: string): Promise<MutationRunStatus> {
  const res = await apiFetch(`/api/repos/${repoName}/mutation/${runId}`);
  if (!res.ok) throw new Error(`Failed to get mutation run status: ${res.status}`);
  return res.json() as Promise<MutationRunStatus>;
}

export async function getUpdateStatus(): Promise<UpdateStatusResponse> {
  const res = await apiFetch("/api/update/status");
  if (!res.ok) throw new Error(`Failed to fetch update status: ${res.status}`);
  return res.json() as Promise<UpdateStatusResponse>;
}

export async function checkForUpdates(): Promise<UpdateStatusResponse> {
  const res = await apiFetch("/api/update/check", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to check for updates: ${res.status}`);
  return res.json() as Promise<UpdateStatusResponse>;
}

export async function applyUpdate(): Promise<{ started: boolean }> {
  const res = await apiFetch("/api/update/apply", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to apply update: ${res.status}`);
  return res.json() as Promise<{ started: boolean }>;
}
