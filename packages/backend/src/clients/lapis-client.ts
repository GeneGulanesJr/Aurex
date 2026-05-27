// packages/backend/src/clients/lapis-client.ts
import type {
  Mission, MissionConfig, Milestone, MilestoneSpec,
  WorkingUnit, WorkingUnitSpec, WorkerStatus,
  Handoff, HandoffResult, Broadcast, BroadcastLifecycle,
  ResearchFinding, ResearchLifecycle, StandingContext,
  AgentSessionRecord, CostSummary,
  RetryCounter, RescopeEvent, MemoryResult,
  ValidationVerdict,
} from "@aurex/shared";
import type { AgentType, CompressionTrigger } from "@aurex/shared";

export interface LaPisClientConfig {
  lapisEndpoint: string;
}

export interface LaPisClient {
  // Mission state
  createMission(description: string, config: MissionConfig): Promise<Mission>;
  getMission(id: string): Promise<Mission>;
  updateMissionStatus(id: string, status: Mission["status"]): Promise<void>;

  // Milestones
  createMilestone(missionId: string, milestone: MilestoneSpec): Promise<Milestone>;
  updateMilestoneStatus(id: string, status: Milestone["status"]): Promise<void>;

  // Working units
  createWorkingUnit(milestoneId: string, unit: WorkingUnitSpec): Promise<WorkingUnit>;
  getWorkingUnitsForMilestone(milestoneId: string): Promise<WorkingUnit[]>;
  updateWorkingUnitStatus(id: string, status: WorkerStatus): Promise<void>;

  // Handoffs
  writeHandoff(unitId: string, handoff: Handoff): Promise<HandoffResult>;

  // Validation contracts (append-only)
  createContract(milestoneId: string, contract: { content: { criteria: string[]; testCommands: string[]; acceptanceBehavior: string } }): Promise<{ id: string; milestoneId: string; version: number; content: unknown; supersedes: string | null; supersededBy: string | null; rescopeEventId: string | null; createdAt: string }>;
  supersedeContract(oldId: string, newContract: { content: { criteria: string[]; testCommands: string[]; acceptanceBehavior: string } }, rescopeEvent: Omit<RescopeEvent, "id" | "timestamp">): Promise<{ id: string; milestoneId: string; version: number; content: unknown; supersedes: string | null; supersededBy: string | null; rescopeEventId: string | null; createdAt: string }>;
  getContractHistory(milestoneId: string): Promise<unknown[]>;

  // Validation verdicts
  writeVerdict(sessionId: string, verdict: Omit<ValidationVerdict, "id" | "sessionId">): Promise<ValidationVerdict>;
  classifyVerdict(verdictId: string, classification: "patchable" | "blocking"): Promise<ValidationVerdict>;
  getVerdicts(milestoneId: string): Promise<ValidationVerdict[]>;

  // Broadcasts
  writeBroadcast(agentId: string, broadcast: Omit<Broadcast, "id" | "createdAt">): Promise<Broadcast>;
  transitionBroadcast(broadcastId: string, newStatus: BroadcastLifecycle, actorId: string): Promise<Broadcast>;
  getBroadcasts(missionId: string, opts?: { status?: BroadcastLifecycle[] }): Promise<Broadcast[]>;

  // Research findings
  writeFinding(agentId: string, finding: Omit<ResearchFinding, "id" | "createdAt">): Promise<ResearchFinding>;
  transitionFinding(findingId: string, newStatus: ResearchLifecycle, actorId: string, actorContext?: StandingContext): Promise<ResearchFinding>;
  getFindings(missionId: string, status?: ResearchLifecycle): Promise<ResearchFinding[]>;

  // Agent sessions
  registerAgentSession(agentType: AgentType, sessionId: string, missionId: string, milestoneId?: string, unitId?: string): Promise<void>;
  getSessionsForMilestone(milestoneId: string): Promise<AgentSessionRecord[]>;

  // Memory
  searchMemory(query: string, opts?: { limit?: number }): Promise<MemoryResult[]>;

  // Cost tracking
  logCost(entry: { missionId: string; agentSessionId: string; model: string; promptTokens: number; completionTokens: number; cost: number; timestamp: string }): Promise<void>;
  getMissionCost(missionId: string): Promise<CostSummary>;

  // Retry / rescope
  incrementRetry(milestoneId: string): Promise<RetryCounter>;
  logRescope(milestoneId: string, event: Omit<RescopeEvent, "id" | "timestamp">): Promise<void>;

  // State compression (stubbed)
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<void>;

  // Connectivity
  ping(): Promise<void>;
}

export function createLaPisClient(config: LaPisClientConfig): LaPisClient {
  const base = config.lapisEndpoint.replace(/\/$/, "");

  async function request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`LaPis ${res.status}: ${path} — ${text}`);
    }
    return res.json();
  }

  function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  function patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  function get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
  }

  return {
    // Mission state
    createMission(description, config) {
      return post("/missions", { description, config });
    },
    getMission(id) {
      return get(`/missions/${id}`);
    },
    updateMissionStatus(id, status) {
      return patch(`/missions/${id}/status`, { status });
    },

    // Milestones
    createMilestone(missionId, milestone) {
      return post(`/missions/${missionId}/milestones`, milestone);
    },
    updateMilestoneStatus(id, status) {
      return patch(`/milestones/${id}/status`, { status });
    },

    // Working units
    createWorkingUnit(milestoneId, unit) {
      return post(`/milestones/${milestoneId}/units`, unit);
    },
    getWorkingUnitsForMilestone(milestoneId) {
      return get(`/milestones/${milestoneId}/units`);
    },
    updateWorkingUnitStatus(id, status) {
      return patch(`/units/${id}/status`, { status });
    },

    // Handoffs
    writeHandoff(unitId, handoff) {
      return post(`/units/${unitId}/handoff`, handoff);
    },

    // Validation contracts
    createContract(milestoneId, contract) {
      return post(`/milestones/${milestoneId}/contracts`, contract);
    },
    supersedeContract(oldId, newContract, rescopeEvent) {
      return post(`/contracts/${oldId}/supersede`, { newContract, rescopeEvent });
    },
    getContractHistory(milestoneId) {
      return get(`/milestones/${milestoneId}/contracts`);
    },

    // Validation verdicts
    writeVerdict(sessionId, verdict) {
      return post("/verdicts", { sessionId, ...verdict });
    },
    classifyVerdict(verdictId, classification) {
      return patch(`/verdicts/${verdictId}`, { classification });
    },
    getVerdicts(milestoneId) {
      return get(`/milestones/${milestoneId}/verdicts`);
    },

    // Broadcasts
    writeBroadcast(agentId, broadcast) {
      return post("/broadcasts", { agentId, ...broadcast });
    },
    transitionBroadcast(broadcastId, newStatus, actorId) {
      return patch(`/broadcasts/${broadcastId}`, { newStatus, actorId });
    },
    getBroadcasts(missionId, opts) {
      const params = new URLSearchParams();
      if (opts?.status?.length) params.set("status", opts.status.join(","));
      return get(`/missions/${missionId}/broadcasts?${params}`);
    },

    // Research findings
    writeFinding(agentId, finding) {
      return post("/findings", { agentId, ...finding });
    },
    transitionFinding(findingId, newStatus, actorId, actorContext) {
      return patch(`/findings/${findingId}`, { newStatus, actorId, actorContext });
    },
    getFindings(missionId, status) {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      return get(`/missions/${missionId}/findings?${params}`);
    },

    // Agent sessions
    registerAgentSession(agentType, sessionId, missionId, milestoneId, unitId) {
      return post("/sessions", { agentType, sessionId, missionId, milestoneId, unitId });
    },
    getSessionsForMilestone(milestoneId) {
      return get(`/milestones/${milestoneId}/sessions`);
    },

    // Memory
    searchMemory(query, opts) {
      return post("/memory/search", { query, ...opts });
    },

    // Cost tracking
    logCost(entry) {
      return post("/costs", entry);
    },
    getMissionCost(missionId) {
      return get(`/missions/${missionId}/costs`);
    },

    // Retry / rescope
    incrementRetry(milestoneId) {
      return post(`/milestones/${milestoneId}/retry`, {});
    },
    logRescope(milestoneId, event) {
      return post(`/milestones/${milestoneId}/rescope`, event);
    },

    // State compression (stubbed — logs skip, never silent)
    runCompression(missionId, trigger) {
      console.log(`[compression] Skipped — not implemented (trigger: ${trigger}, missionId: ${missionId})`);
      return Promise.resolve();
    },

    // Connectivity
    ping() {
      return get("/health").then(() => {});
    },
  };
}
