// packages/backend/src/clients/lapis-client.ts
import type {
  Mission, MissionConfig, Milestone, MilestoneSpec,
  WorkingUnit, WorkingUnitSpec, WorkerStatus,
  Handoff, HandoffRecord, HandoffResult, Broadcast, BroadcastLifecycle,
  ResearchFinding, ResearchLifecycle, StandingContext,
  AgentSessionRecord, CostSummary,
  RetryCounter, RescopeEvent, MemoryResult,
  ValidationVerdict, CheckpointRecord,
  MissionTodoLedger, MissionTodoLedgerInput,
  MissionTodo, MissionTodoInput, TodoEvent, TodoContextResult,
} from "@aurex/shared";
import type { AgentType, CheckpointDecision, CompressionTrigger } from "@aurex/shared";

export interface LaPisClientConfig {
  lapisEndpoint: string;
}

/**
 * Structured response from LaPis's POST /missions/:missionId/compression endpoint.
 * Mirrors the shape returned by `compressMissionState` in LaPis
 * (src/compression/mission-state.js). Updated from the previous void return
 * so the orchestrator can surface compression results in the dashboard and
 * feed them into downstream planner invocations.
 */
export interface CompressionResult {
  summary: string | null;
  tokensSaved: number;
  error?: string;
}

type RawValidationVerdict = Partial<ValidationVerdict> & {
  milestone_id?: string;
  contract_id?: string;
  validator_type?: ValidationVerdict["validatorType"];
  session_id?: string;
  failed_unit_ids?: string[];
};

type RawAgentSessionRecord = Partial<AgentSessionRecord> & {
  session_id?: string;
  agent_type?: AgentType;
  mission_id?: string;
  milestone_id?: string | null;
  unit_id?: string | null;
  spawned_at?: string;
  terminated_at?: string | null;
};

type RawWorkingUnit = Partial<WorkingUnit> & {
  title?: string;
  name?: string;
  milestone_id?: string;
  declared_paths?: string[];
  declared_modules?: string[];
  task_branch?: string;
  worktree_path?: string;
  session_id?: string;
};

type RawHandoffRecord = Partial<HandoffRecord> & {
  mission_id?: string;
  milestone_id?: string;
  unit_id?: string;
  feature_name?: string;
  unresolved_uncertainties?: string;
  errors_encountered?: string;
  commands_run?: unknown;
  git_commit_hash?: string;
  created_at?: string;
  updated_at?: string;
};

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
  updateWorkingUnit(
    id: string,
    patch: Partial<Pick<WorkingUnit, "taskBranch" | "worktreePath" | "sessionId">>,
  ): Promise<void>;

  // Handoffs
  writeHandoff(unitId: string, handoff: Handoff): Promise<HandoffResult>;
  getHandoffsForMilestone(milestoneId: string): Promise<HandoffRecord[]>;
  getHandoffForUnit(unitId: string): Promise<HandoffRecord | null>;

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
  /**
   * Transitions a finding to a new lifecycle status.
   *
   * `opts.reason` persists the rationale for a rejection so future workers can
   * see why a finding was dismissed. `opts.expectedCurrentStatus` is an
   * optimistic-concurrency guard: when supplied, the LaPis endpoint should
   * reject the transition if the finding's status no longer matches, which
   * closes the stale-read race where two workers transition the same finding
   * concurrently.
   */
  transitionFinding(
    findingId: string,
    newStatus: ResearchLifecycle,
    actorId: string,
    actorContext?: StandingContext,
    opts?: { reason?: string; expectedCurrentStatus?: ResearchLifecycle },
  ): Promise<ResearchFinding>;
  getFindings(missionId: string, status?: ResearchLifecycle): Promise<ResearchFinding[]>;

  // Agent sessions
  registerAgentSession(agentType: AgentType, sessionId: string, missionId: string, milestoneId?: string, unitId?: string): Promise<void>;
  getSessionsForMilestone(milestoneId: string): Promise<AgentSessionRecord[]>;

  // Memory
  searchMemory(query: string, opts?: { limit?: number }): Promise<MemoryResult[]>;

  // Todo ledgers
  createMissionLedger(input: MissionTodoLedgerInput): Promise<MissionTodoLedger>;
  getMissionLedger(missionId: string): Promise<MissionTodoLedger>;
  listMissionLedgers(opts?: { status?: string }): Promise<MissionTodoLedger[]>;
  updateMissionLedger(missionId: string, patch: Partial<MissionTodoLedgerInput>): Promise<MissionTodoLedger>;
  setMissionLedgerStatus(missionId: string, status: MissionTodoLedger["status"]): Promise<MissionTodoLedger>;
  recordMissionTodoEvent(missionId: string, event: { eventType: string; actorId?: string | null; payload?: Record<string, unknown> }): Promise<TodoEvent>;
  listMissionTodoEvents(missionId: string): Promise<TodoEvent[]>;

  // Todo items
  createTodo(missionId: string, todo: MissionTodoInput): Promise<MissionTodo>;
  createTodos(missionId: string, todos: MissionTodoInput[]): Promise<MissionTodo[]>;
  getTodo(todoId: string): Promise<MissionTodo>;
  listTodos(opts?: { missionId?: string; status?: string; type?: string }): Promise<MissionTodo[]>;
  listTodosByMission(missionId: string): Promise<MissionTodo[]>;
  searchTodos(query: string, opts?: { missionId?: string }): Promise<MissionTodo[]>;
  updateTodo(todoId: string, patch: Partial<MissionTodoInput>): Promise<MissionTodo>;
  setTodoStatus(todoId: string, status: MissionTodo["status"]): Promise<MissionTodo>;
  addTodoEvidence(todoId: string, evidence: Partial<MissionTodo["evidence"]>): Promise<MissionTodo>;
  addTodoNote(todoId: string, note: string): Promise<MissionTodo>;
  assignTodo(todoId: string, workerId: string | null): Promise<MissionTodo>;
  claimNextReadyTodo(missionId: string, workerId: string | null): Promise<MissionTodo>;
  getTodoContextQuery(todoId: string): Promise<{ todoId: string; lapisContextQuery: string }>;
  getContextForTodo(todoId: string, opts?: { limit?: number }): Promise<TodoContextResult>;
  recordTodoEvent(todoId: string, event: { eventType: string; actorId?: string | null; payload?: Record<string, unknown> }): Promise<TodoEvent>;
  listTodoEvents(todoId: string): Promise<TodoEvent[]>;

  // Cost tracking
  logCost(entry: { missionId: string; agentSessionId: string; model: string; promptTokens: number; completionTokens: number; cost: number; timestamp: string }): Promise<void>;
  getMissionCost(missionId: string): Promise<CostSummary>;

  // Retry / rescope
  getRetryCounter(milestoneId: string): Promise<RetryCounter>;
  incrementRetry(milestoneId: string): Promise<RetryCounter>;
  logRescope(milestoneId: string, event: Omit<RescopeEvent, "id" | "timestamp">): Promise<void>;

  // State compression
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<CompressionResult>;

  // Checkpoints
  createCheckpoint(checkpoint: Omit<CheckpointRecord, "id" | "status" | "createdAt" | "resolvedAt">): Promise<CheckpointRecord>;
  getCheckpoint(id: string): Promise<CheckpointRecord>;
  resolveCheckpoint(id: string, decision: CheckpointDecision, guidance?: string, reason?: string, rescopeGuidance?: string): Promise<CheckpointRecord>;
  getPendingCheckpoints(missionId: string): Promise<CheckpointRecord[]>;

  // Milestones for mission (hydration)
  getMilestonesForMission(missionId: string): Promise<Milestone[]>;

  // Mission listing
  listMissions(opts?: { status?: string }): Promise<Mission[]>;

  // Settings KV
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  deleteSetting(key: string): Promise<void>;

  /**
   * Look up the local filesystem path for a previously-prepared repo.
   * Returns null if the repo has not been prepared.
   * Setting key convention: "repo:<repoName>:path" (matches the writer at
   * github.ts:253: `lapis.setSetting(\`repo:${repoName}:path\`, prepared.repoPath)`).
   */
  getRepoPath(repoName: string): Promise<string | null>;

  // Code indexing
  indexRepo(repoPath: string, repoName?: string): Promise<Record<string, unknown>>;

  // Code context
  getCodeSummary(repo: string): Promise<{ files: number; symbols: number; edges: number; modules: Array<{ name: string; fileCount: number }>; entryPoints: string[]; cycles: { count: number; paths: string[][] } }>;
  getCodeGraph(repo: string): Promise<{ nodes: Array<{ id: string; module: string; symbols: number; importance: number }>; edges: Array<{ from: string; to: string; kind: string }>; cycles: string[][] }>;
  getCodeHotspots(repo: string): Promise<{ files: Array<{ path: string; module: string; complexity: number; symbols: number }> }>;

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
    return res.json() as Promise<T>;
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

  function put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  }

  async function del(path: string): Promise<void> {
    const res = await fetch(`${base}${path}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`LaPis ${res.status}: ${path} — ${text}`);
    }
  }

  function normalizeVerdict(raw: RawValidationVerdict): ValidationVerdict {
    return {
      ...raw,
      id: raw.id ?? "",
      milestoneId: raw.milestoneId ?? raw.milestone_id ?? "",
      contractId: raw.contractId ?? raw.contract_id ?? "",
      validatorType: raw.validatorType ?? raw.validator_type ?? "validator_scrutiny",
      sessionId: raw.sessionId ?? raw.session_id ?? "",
      verdict: raw.verdict ?? "fail",
      classification: raw.classification,
      findings: raw.findings ?? "",
      failedUnitIds: normalizeStringArray(raw.failedUnitIds ?? raw.failed_unit_ids),
      timestamp: raw.timestamp ?? "",
    };
  }

  function normalizeAgentSession(raw: RawAgentSessionRecord): AgentSessionRecord {
    return {
      ...raw,
      sessionId: raw.sessionId ?? raw.session_id ?? "",
      agentType: raw.agentType ?? raw.agent_type ?? "worker",
      missionId: raw.missionId ?? raw.mission_id ?? "",
      milestoneId: raw.milestoneId ?? raw.milestone_id ?? null,
      unitId: raw.unitId ?? raw.unit_id ?? null,
      spawnedAt: raw.spawnedAt ?? raw.spawned_at ?? "",
      terminatedAt: raw.terminatedAt ?? raw.terminated_at ?? null,
    };
  }

  function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    // SQLite stores arrays as JSON-encoded strings (e.g. '["a","b"]').
    // LaPis's HTTP layer returns the column value verbatim, so a stored
    // array arrives as a string like '["wu-1","wu-2"]'. Parse it back;
    // otherwise array fields (failedUnitIds, declaredPaths, commandsRun, ...)
    // silently collapse to [] and downstream logic loses the data.
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === "string");
          }
        } catch {
          // Not valid JSON — fall through to empty.
        }
      }
    }
    return [];
  }

  function normalizeWorkingUnit(raw: RawWorkingUnit): WorkingUnit {
    return {
      ...raw,
      id: raw.id ?? "",
      milestoneId: raw.milestoneId ?? raw.milestone_id ?? "",
      description: raw.description ?? raw.title ?? raw.name ?? "",
      declaredPaths: normalizeStringArray(raw.declaredPaths ?? raw.declared_paths),
      declaredModules: normalizeStringArray(raw.declaredModules ?? raw.declared_modules),
      status: raw.status ?? "planned",
      taskBranch: raw.taskBranch ?? raw.task_branch ?? "",
      worktreePath: raw.worktreePath ?? raw.worktree_path ?? "",
      sessionId: raw.sessionId ?? raw.session_id ?? "",
    };
  }

  function normalizeCommandRuns(value: unknown): { command: string; exitCode: number }[] {
    const parsed = typeof value === "string" ? safeJsonParse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const record = item as { command?: unknown; exitCode?: unknown; exit_code?: unknown };
        const command = typeof record.command === "string" ? record.command : "";
        const exitCode = typeof record.exitCode === "number"
          ? record.exitCode
          : typeof record.exit_code === "number"
            ? record.exit_code
            : Number(record.exitCode ?? record.exit_code);
        return { command, exitCode };
      })
      .filter((item) => item.command.trim().length > 0 && Number.isFinite(item.exitCode));
  }

  function safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }

  function normalizeHandoffRecord(raw: RawHandoffRecord): HandoffRecord {
    return {
      ...raw,
      id: raw.id ?? "",
      missionId: raw.missionId ?? raw.mission_id ?? "",
      milestoneId: raw.milestoneId ?? raw.milestone_id ?? "",
      unitId: raw.unitId ?? raw.unit_id ?? "",
      status: raw.status ?? "pending",
      featureName: raw.featureName ?? raw.feature_name ?? "",
      description: raw.description ?? "",
      implemented: raw.implemented ?? "",
      remaining: raw.remaining ?? "",
      rationale: raw.rationale ?? "",
      assumptions: raw.assumptions ?? "",
      unresolvedUncertainties: raw.unresolvedUncertainties ?? raw.unresolved_uncertainties ?? "",
      errorsEncountered: raw.errorsEncountered ?? raw.errors_encountered ?? "",
      commandsRun: normalizeCommandRuns(raw.commandsRun ?? raw.commands_run),
      gitCommitHash: raw.gitCommitHash ?? raw.git_commit_hash ?? "",
      createdAt: raw.createdAt ?? raw.created_at ?? "",
      updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
    };
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
    async createWorkingUnit(milestoneId, unit) {
      const created = await post<RawWorkingUnit>(`/milestones/${milestoneId}/units`, unit);
      return normalizeWorkingUnit(created);
    },
    async getWorkingUnitsForMilestone(milestoneId) {
      const units = await get<RawWorkingUnit[]>(`/milestones/${milestoneId}/units`);
      return units.map(normalizeWorkingUnit);
    },
    updateWorkingUnitStatus(id, status) {
      return patch(`/units/${id}/status`, { status });
    },
    updateWorkingUnit(id, fields) {
      return patch(`/units/${id}`, {
        ...(fields.taskBranch !== undefined ? { task_branch: fields.taskBranch } : {}),
        ...(fields.worktreePath !== undefined ? { worktree_path: fields.worktreePath } : {}),
        ...(fields.sessionId !== undefined ? { session_id: fields.sessionId } : {}),
      });
    },

    // Handoffs
    writeHandoff(unitId, handoff) {
      return post(`/units/${unitId}/handoff`, handoff);
    },
    async getHandoffsForMilestone(milestoneId) {
      const handoffs = await get<RawHandoffRecord[]>(`/milestones/${milestoneId}/handoffs`);
      return handoffs.map(normalizeHandoffRecord);
    },
    async getHandoffForUnit(unitId) {
      const handoffs = await get<RawHandoffRecord[]>(`/units/${unitId}/handoff`);
      const records = handoffs.map(normalizeHandoffRecord);
      return records[0] ?? null;
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
    async writeVerdict(sessionId, verdict) {
      const written = await post<RawValidationVerdict>("/verdicts", { sessionId, ...verdict });
      return normalizeVerdict(written);
    },
    async classifyVerdict(verdictId, classification) {
      const verdict = await patch<RawValidationVerdict>(`/verdicts/${verdictId}`, { classification });
      return normalizeVerdict(verdict);
    },
    async getVerdicts(milestoneId) {
      const verdicts = await get<RawValidationVerdict[]>(`/milestones/${milestoneId}/verdicts`);
      return verdicts.map(normalizeVerdict);
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
    transitionFinding(findingId, newStatus, actorId, actorContext, opts) {
      return patch(`/findings/${findingId}`, {
        newStatus,
        actorId,
        actorContext,
        reason: opts?.reason,
        expectedCurrentStatus: opts?.expectedCurrentStatus,
      });
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
    async getSessionsForMilestone(milestoneId) {
      const sessions = await get<RawAgentSessionRecord[]>(`/milestones/${milestoneId}/sessions`);
      return sessions.map(normalizeAgentSession);
    },

    // Memory
    searchMemory(query, opts) {
      return post("/memory/search", { query, ...opts });
    },

    // Todo ledgers
    createMissionLedger(input) {
      return post("/todo-ledgers", input);
    },
    getMissionLedger(missionId) {
      return get(`/missions/${missionId}/todo-ledger`);
    },
    listMissionLedgers(opts) {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      const qs = params.toString();
      return get(`/todo-ledgers${qs ? `?${qs}` : ""}`);
    },
    updateMissionLedger(missionId, patchBody) {
      return patch(`/missions/${missionId}/todo-ledger`, patchBody);
    },
    setMissionLedgerStatus(missionId, status) {
      return patch(`/missions/${missionId}/todo-ledger/status`, { status });
    },
    recordMissionTodoEvent(missionId, event) {
      return post(`/missions/${missionId}/todo-events`, event);
    },
    listMissionTodoEvents(missionId) {
      return get(`/missions/${missionId}/todo-events`);
    },

    // Todo items
    createTodo(missionId, todo) {
      return post(`/missions/${missionId}/todos`, todo);
    },
    createTodos(missionId, todos) {
      return post(`/missions/${missionId}/todos/bulk`, { todos });
    },
    getTodo(todoId) {
      return get(`/todos/${todoId}`);
    },
    listTodos(opts) {
      const params = new URLSearchParams();
      if (opts?.missionId) params.set("missionId", opts.missionId);
      if (opts?.status) params.set("status", opts.status);
      if (opts?.type) params.set("type", opts.type);
      const qs = params.toString();
      return get(`/todos${qs ? `?${qs}` : ""}`);
    },
    listTodosByMission(missionId) {
      return get(`/missions/${missionId}/todos`);
    },
    searchTodos(query, opts) {
      return post("/todos/search", { query, ...opts });
    },
    updateTodo(todoId, patchBody) {
      return patch(`/todos/${todoId}`, patchBody);
    },
    setTodoStatus(todoId, status) {
      return patch(`/todos/${todoId}/status`, { status });
    },
    addTodoEvidence(todoId, evidence) {
      return post(`/todos/${todoId}/evidence`, evidence);
    },
    addTodoNote(todoId, note) {
      return post(`/todos/${todoId}/notes`, { note });
    },
    assignTodo(todoId, workerId) {
      return patch(`/todos/${todoId}/assignment`, { workerId });
    },
    claimNextReadyTodo(missionId, workerId) {
      return post(`/missions/${missionId}/todos/claim-next`, { workerId });
    },
    getTodoContextQuery(todoId) {
      return get(`/todos/${todoId}/context-query`);
    },
    getContextForTodo(todoId, opts) {
      const params = new URLSearchParams();
      if (opts?.limit) params.set("limit", String(opts.limit));
      const qs = params.toString();
      return get(`/todos/${todoId}/context${qs ? `?${qs}` : ""}`);
    },
    recordTodoEvent(todoId, event) {
      return post(`/todos/${todoId}/events`, event);
    },
    listTodoEvents(todoId) {
      return get(`/todos/${todoId}/events`);
    },

    // Cost tracking
    logCost(entry) {
      return post("/costs", entry);
    },
    getMissionCost(missionId) {
      return get(`/missions/${missionId}/costs`);
    },

    // Retry / rescope
    getRetryCounter(milestoneId) {
      return get<RetryCounter>(`/milestones/${milestoneId}/retry`);
    },
    incrementRetry(milestoneId) {
      return post(`/milestones/${milestoneId}/retry`, {});
    },
    logRescope(milestoneId, event) {
      return post(`/milestones/${milestoneId}/rescope`, event);
    },

    // State compression delegated to LaPis.
    // Note: route is /compression (with the 'n') — not /compress. The previous
    // URL was silently 404'ing. LaPis's actual route is registered in
    // src/http/server.js as POST /missions/:missionId/compression.
    runCompression(missionId, trigger) {
      return post(`/missions/${missionId}/compression`, { trigger }) as Promise<CompressionResult>;
    },

    // Checkpoints
    createCheckpoint(checkpoint) {
      return post("/checkpoints", checkpoint);
    },
    getCheckpoint(id) {
      return get(`/checkpoints/${id}`);
    },
    resolveCheckpoint(id, decision, guidance, reason, rescopeGuidance) {
      return patch(`/checkpoints/${id}`, { decision, guidance, reason, rescopeGuidance });
    },
    getPendingCheckpoints(missionId) {
      return get(`/missions/${missionId}/checkpoints?status=pending`);
    },

    // Milestones for mission (hydration)
    getMilestonesForMission(missionId) {
      return get(`/missions/${missionId}/milestones`);
    },

    // Mission listing
    listMissions(opts) {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      const qs = params.toString();
      return get(`/missions${qs ? `?${qs}` : ""}`);
    },

    // Settings KV
    getSetting<T = unknown>(key: string): Promise<T | null> {
      return get<{ key: string; value: T }>(`/settings/${encodeURIComponent(key)}`)
        .then((res) => res.value)
        .catch((err) => {
          if (err instanceof Error && err.message.includes("LaPis 404")) return null;
          throw err;
        });
    },
    setSetting(key, value) {
      return put(`/settings/${encodeURIComponent(key)}`, { value }).then(() => {});
    },
    deleteSetting(key) {
      return del(`/settings/${encodeURIComponent(key)}`);
    },
    async getRepoPath(repoName: string): Promise<string | null> {
      return this.getSetting<string>(`repo:${repoName}:path`);
    },

    // Code indexing
    indexRepo(repoPath, repoName) {
      return post("/code/index", { path: repoPath, name: repoName });
    },

    // Code context
    getCodeSummary(repo) {
      return get(`/code/summary/${encodeURIComponent(repo)}`);
    },
    getCodeGraph(repo) {
      return get(`/code/graph/${encodeURIComponent(repo)}`);
    },
    getCodeHotspots(repo) {
      return get(`/code/hotspots/${encodeURIComponent(repo)}`);
    },

    // Connectivity
    ping() {
      return get("/health").then(() => {});
    },
  };
}
