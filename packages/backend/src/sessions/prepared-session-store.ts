import { randomUUID } from "node:crypto";
import type {
  ExecutionFailureCode,
  PreparedAgentRole,
  PreparedAgentSession,
  PreparedAgentSessionConfig,
  PreparedAgentSessionStatus,
} from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface PrepareSessionInput {
  missionId: string;
  milestoneId?: string | null;
  unitId?: string | null;
  role: PreparedAgentRole;
  config: Partial<PreparedAgentSessionConfig> &
    Pick<PreparedAgentSessionConfig, "model" | "prompt">;
  maxAttempts?: number;
}

export interface PreparedSessionListFilter {
  missionId?: string;
  status?: PreparedAgentSessionStatus;
  unitId?: string;
}

export interface PreparedSessionStore {
  prepare(
    input: PrepareSessionInput,
    now?: Date,
  ): Promise<PreparedAgentSession>;
  get(sessionId: string): Promise<PreparedAgentSession | null>;
  list(filter?: PreparedSessionListFilter): Promise<PreparedAgentSession[]>;
  updateStatus(
    sessionId: string,
    status: PreparedAgentSessionStatus,
    now?: Date,
  ): Promise<PreparedAgentSession>;
  linkQueueJob(
    sessionId: string,
    queueJobId: string,
    now?: Date,
  ): Promise<PreparedAgentSession>;
  heartbeat(sessionId: string, now?: Date): Promise<PreparedAgentSession>;
  fail(
    sessionId: string,
    code: ExecutionFailureCode,
    message: string,
    now?: Date,
  ): Promise<PreparedAgentSession>;
  markLost(
    sessionId: string,
    code: ExecutionFailureCode,
    message: string,
    now?: Date,
  ): Promise<PreparedAgentSession>;
  cancel(sessionId: string, now?: Date): Promise<PreparedAgentSession>;
}

function iso(now: Date): string {
  return now.toISOString();
}

const TERMINAL_SESSION_STATUSES: ReadonlySet<PreparedAgentSessionStatus> =
  new Set(["completed", "failed", "cancelled", "lost"]);

const NON_TERMINAL_SESSION_STATUSES: ReadonlySet<PreparedAgentSessionStatus> =
  new Set(["prepared", "queued", "starting", "running", "waiting_for_input"]);

/** Allowed "from" states for each mutation operation. */
const ALLOWED_SESSION_TRANSITIONS: Record<
  string,
  ReadonlySet<PreparedAgentSessionStatus>
> = {
  linkQueueJob: new Set(["prepared"]),
  heartbeat: new Set(["starting", "running", "waiting_for_input"]),
  fail: NON_TERMINAL_SESSION_STATUSES,
  markLost: new Set(["running"]),
  cancel: NON_TERMINAL_SESSION_STATUSES,
};

function assertSessionTransition(
  operation: string,
  session: PreparedAgentSession,
): void {
  const allowed = ALLOWED_SESSION_TRANSITIONS[operation];
  if (allowed && !allowed.has(session.status)) {
    throw new Error(
      `Prepared agent session ${session.id} cannot ${operation} from status "${session.status}"`,
    );
  }
}

function cloneSession(session: PreparedAgentSession): PreparedAgentSession {
  return {
    ...session,
    config: {
      ...session.config,
      envVars: { ...session.config.envVars },
      secretRefs: [...session.config.secretRefs],
      setupCommands: [...session.config.setupCommands],
      allowedTools: [...session.config.allowedTools],
      mcpServers: { ...session.config.mcpServers },
    },
  };
}

function normalizeConfig(
  input: PrepareSessionInput["config"],
): PreparedAgentSessionConfig {
  return {
    model: input.model,
    provider: input.provider ?? null,
    repoRoot: input.repoRoot ?? null,
    cloneUrl: input.cloneUrl ?? null,
    branch: input.branch ?? null,
    worktreePath: input.worktreePath ?? null,
    prompt: input.prompt,
    systemPromptRef: input.systemPromptRef ?? null,
    envVars: input.envVars ?? {},
    secretRefs: input.secretRefs ?? [],
    setupCommands: input.setupCommands ?? [],
    allowedTools: input.allowedTools ?? [],
    mcpServers: input.mcpServers ?? {},
  };
}

export function createInMemoryPreparedSessionStore(
  initialSessions: PreparedAgentSession[] = [],
): PreparedSessionStore {
  const sessions = new Map<string, PreparedAgentSession>(
    initialSessions.map((session) => [session.id, cloneSession(session)]),
  );

  async function write(
    session: PreparedAgentSession,
  ): Promise<PreparedAgentSession> {
    sessions.set(session.id, cloneSession(session));
    return cloneSession(session);
  }

  async function requireSession(
    sessionId: string,
  ): Promise<PreparedAgentSession> {
    const session = sessions.get(sessionId);
    if (!session)
      throw new Error(`Prepared agent session ${sessionId} not found`);
    return session;
  }

  return {
    async prepare(input, now = new Date()) {
      const timestamp = iso(now);
      const session: PreparedAgentSession = {
        id: randomUUID(),
        missionId: input.missionId,
        milestoneId: input.milestoneId ?? null,
        unitId: input.unitId ?? null,
        role: input.role,
        status: "prepared",
        config: normalizeConfig(input.config),
        queueJobId: null,
        createdAt: timestamp,
        preparedAt: timestamp,
        queuedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 3,
      };
      return write(session);
    },
    async get(sessionId) {
      const session = sessions.get(sessionId);
      return session ? cloneSession(session) : null;
    },
    async list(filter = {}) {
      return Array.from(sessions.values())
        .filter(
          (session) =>
            !filter.missionId || session.missionId === filter.missionId,
        )
        .filter((session) => !filter.status || session.status === filter.status)
        .filter((session) => !filter.unitId || session.unitId === filter.unitId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(cloneSession);
    },
    async updateStatus(sessionId, status, now = new Date()) {
      const session = await requireSession(sessionId);
      const timestamp = iso(now);
      return write({
        ...session,
        status,
        startedAt:
          status === "running"
            ? (session.startedAt ?? timestamp)
            : session.startedAt,
        lastHeartbeatAt:
          status === "running" ? timestamp : session.lastHeartbeatAt,
        completedAt: TERMINAL_SESSION_STATUSES.has(status)
          ? timestamp
          : session.completedAt,
      });
    },
    async linkQueueJob(sessionId, queueJobId, now = new Date()) {
      const session = await requireSession(sessionId);
      assertSessionTransition("linkQueueJob", session);
      return write({
        ...session,
        status: "queued",
        queueJobId,
        queuedAt: iso(now),
      });
    },
    async heartbeat(sessionId, now = new Date()) {
      const session = await requireSession(sessionId);
      assertSessionTransition("heartbeat", session);
      return write({ ...session, lastHeartbeatAt: iso(now) });
    },
    async fail(sessionId, code, message, now = new Date()) {
      const session = await requireSession(sessionId);
      assertSessionTransition("fail", session);
      return write({
        ...session,
        status: "failed",
        failureCode: code,
        failureMessage: message,
        completedAt: iso(now),
      });
    },
    async markLost(sessionId, code, message, now = new Date()) {
      const session = await requireSession(sessionId);
      assertSessionTransition("markLost", session);
      return write({
        ...session,
        status: "lost",
        failureCode: code,
        failureMessage: message,
        completedAt: iso(now),
      });
    },
    async cancel(sessionId, now = new Date()) {
      const session = await requireSession(sessionId);
      assertSessionTransition("cancel", session);
      return write({ ...session, status: "cancelled", completedAt: iso(now) });
    },
  };
}

interface SessionState {
  sessions: PreparedAgentSession[];
}

export function createSettingsPreparedSessionStore(
  lapis: Pick<LaPisClient, "getSetting" | "setSetting">,
  key = "aurex:prepared_agent_sessions:v1",
): PreparedSessionStore {
  let memory = createInMemoryPreparedSessionStore();

  // Serialize write operations so concurrent mutations don't overwrite
  // each other's hydrate-modify-persist cycles.
  let writeChain: Promise<void> = Promise.resolve();

  async function hydrate(): Promise<void> {
    const state = await lapis.getSetting<SessionState>(key);
    memory = createInMemoryPreparedSessionStore(state?.sessions ?? []);
  }

  async function persist(): Promise<void> {
    await lapis.setSetting(key, {
      sessions: await memory.list(),
    } satisfies SessionState);
  }

  async function withPersistence<T>(fn: () => Promise<T>): Promise<T> {
    const prev = writeChain;
    let release: () => void;
    writeChain = new Promise((resolve) => { release = resolve; });
    try {
      await prev;
      await hydrate();
      const result = await fn();
      await persist();
      return result;
    } finally {
      release!();
    }
  }

  return {
    prepare: (input, now) => withPersistence(() => memory.prepare(input, now)),
    get: async (sessionId) => {
      await hydrate();
      return memory.get(sessionId);
    },
    list: async (filter) => {
      await hydrate();
      return memory.list(filter);
    },
    updateStatus: (sessionId, status, now) =>
      withPersistence(() => memory.updateStatus(sessionId, status, now)),
    linkQueueJob: (sessionId, queueJobId, now) =>
      withPersistence(() => memory.linkQueueJob(sessionId, queueJobId, now)),
    heartbeat: (sessionId, now) =>
      withPersistence(() => memory.heartbeat(sessionId, now)),
    fail: (sessionId, code, message, now) =>
      withPersistence(() => memory.fail(sessionId, code, message, now)),
    markLost: (sessionId, code, message, now) =>
      withPersistence(() => memory.markLost(sessionId, code, message, now)),
    cancel: (sessionId, now) =>
      withPersistence(() => memory.cancel(sessionId, now)),
  };
}
