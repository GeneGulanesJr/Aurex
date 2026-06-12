import { randomUUID } from "node:crypto";
import type {
  ExecutionFailureCode,
  ExecutionJobStatus,
  ExecutionJobType,
  ExecutionQueueJob,
} from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface EnqueueExecutionJobInput {
  type: ExecutionJobType;
  missionId: string;
  milestoneId?: string | null;
  unitId?: string | null;
  sessionId?: string | null;
  priority?: number;
  runAfter?: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

export interface ExecutionQueueClaim {
  job: ExecutionQueueJob;
  claimToken: string;
}

export interface ExecutionQueueListFilter {
  status?: ExecutionJobStatus;
  missionId?: string;
  sessionId?: string;
}

export interface ExecutionQueueStore {
  enqueue(
    input: EnqueueExecutionJobInput,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  list(filter?: ExecutionQueueListFilter): Promise<ExecutionQueueJob[]>;
  get(jobId: string): Promise<ExecutionQueueJob | null>;
  claimNext(workerId: string, now?: Date): Promise<ExecutionQueueClaim | null>;
  markRunning(
    jobId: string,
    claimToken: string,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  heartbeat(
    jobId: string,
    claimToken: string,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  complete(
    jobId: string,
    claimToken: string,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  fail(
    jobId: string,
    claimToken: string | null,
    code: ExecutionFailureCode,
    message: string,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  requeue(
    jobId: string,
    code: ExecutionFailureCode,
    message: string,
    now?: Date,
  ): Promise<ExecutionQueueJob>;
  cancel(jobId: string, now?: Date): Promise<ExecutionQueueJob>;
}

function iso(now: Date): string {
  return now.toISOString();
}

function cloneJob(job: ExecutionQueueJob): ExecutionQueueJob {
  return { ...job, payload: { ...job.payload } };
}

function assertClaim(job: ExecutionQueueJob, claimToken: string): void {
  if (job.claimToken !== claimToken) {
    throw new Error(`Execution job ${job.id} claim token mismatch`);
  }
}

/** Allowed "from" states for each mutation operation. */
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<ExecutionJobStatus>> = {
  markRunning: new Set(["claimed"]),
  heartbeat: new Set(["claimed", "running"]),
  complete: new Set(["running"]),
  fail: new Set(["queued", "claimed", "running"]),
  requeue: new Set(["claimed", "running", "stale"]),
  cancel: new Set(["queued", "claimed", "running"]),
};

function assertTransition(
  operation: string,
  job: ExecutionQueueJob,
): void {
  const allowed = ALLOWED_TRANSITIONS[operation];
  if (allowed && !allowed.has(job.status)) {
    throw new Error(
      `Execution job ${job.id} cannot ${operation} from status "${job.status}"`,
    );
  }
}

export function createInMemoryExecutionQueueStore(
  initialJobs: ExecutionQueueJob[] = [],
): ExecutionQueueStore {
  const jobs = new Map<string, ExecutionQueueJob>(
    initialJobs.map((job) => [job.id, cloneJob(job)]),
  );

  async function write(job: ExecutionQueueJob): Promise<ExecutionQueueJob> {
    jobs.set(job.id, cloneJob(job));
    return cloneJob(job);
  }

  return {
    async enqueue(input, now = new Date()) {
      const timestamp = iso(now);
      const job: ExecutionQueueJob = {
        id: randomUUID(),
        type: input.type,
        status: "queued",
        missionId: input.missionId,
        milestoneId: input.milestoneId ?? null,
        unitId: input.unitId ?? null,
        sessionId: input.sessionId ?? null,
        priority: input.priority ?? 0,
        runAfter: input.runAfter ?? timestamp,
        claimToken: null,
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 3,
        failureCode: null,
        failureMessage: null,
        payload: input.payload ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      return write(job);
    },
    async list(filter = {}) {
      return Array.from(jobs.values())
        .filter((job) => !filter.status || job.status === filter.status)
        .filter(
          (job) => !filter.missionId || job.missionId === filter.missionId,
        )
        .filter(
          (job) => !filter.sessionId || job.sessionId === filter.sessionId,
        )
        .sort(
          (a, b) =>
            b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
        )
        .map(cloneJob);
    },
    async get(jobId) {
      const job = jobs.get(jobId);
      return job ? cloneJob(job) : null;
    },
    async claimNext(workerId, now = new Date()) {
      const dueAt = iso(now);
      const due = Array.from(jobs.values())
        .filter(
          (job) =>
            job.status === "queued" &&
            job.runAfter <= dueAt &&
            job.attempt < job.maxAttempts,
        )
        .sort(
          (a, b) =>
            b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
        )[0];
      if (!due) return null;
      const claimToken = randomUUID();
      const claimed = await write({
        ...due,
        status: "claimed",
        claimToken,
        claimedBy: workerId,
        claimedAt: dueAt,
        heartbeatAt: dueAt,
        attempt: due.attempt + 1,
        updatedAt: dueAt,
      });
      return { job: claimed, claimToken };
    },
    async markRunning(jobId, claimToken, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("markRunning", job);
      assertClaim(job, claimToken);
      return write({
        ...job,
        status: "running",
        heartbeatAt: iso(now),
        updatedAt: iso(now),
      });
    },
    async heartbeat(jobId, claimToken, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("heartbeat", job);
      assertClaim(job, claimToken);
      return write({ ...job, heartbeatAt: iso(now), updatedAt: iso(now) });
    },
    async complete(jobId, claimToken, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("complete", job);
      assertClaim(job, claimToken);
      return write({
        ...job,
        status: "succeeded",
        completedAt: iso(now),
        updatedAt: iso(now),
      });
    },
    async fail(jobId, claimToken, code, message, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("fail", job);
      if (claimToken !== null) assertClaim(job, claimToken);
      return write({
        ...job,
        status: "failed",
        failureCode: code,
        failureMessage: message,
        completedAt: iso(now),
        updatedAt: iso(now),
      });
    },
    async requeue(jobId, code, message, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("requeue", job);
      return write({
        ...job,
        status: "queued",
        claimToken: null,
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        failureCode: code,
        failureMessage: message,
        runAfter: iso(now),
        updatedAt: iso(now),
      });
    },
    async cancel(jobId, now = new Date()) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Execution job ${jobId} not found`);
      assertTransition("cancel", job);
      return write({
        ...job,
        status: "cancelled",
        completedAt: iso(now),
        updatedAt: iso(now),
      });
    },
  };
}

interface QueueState {
  jobs: ExecutionQueueJob[];
}

export function createSettingsExecutionQueueStore(
  lapis: Pick<LaPisClient, "getSetting" | "setSetting">,
  key = "aurex:execution_queue:v1",
): ExecutionQueueStore {
  let memory = createInMemoryExecutionQueueStore();

  // Serialize write operations so concurrent enqueue/claim/fail calls
  // don't overwrite each other's hydrate-modify-persist cycles.
  let writeChain: Promise<void> = Promise.resolve();

  async function hydrate(): Promise<void> {
    const state = await lapis.getSetting<QueueState>(key);
    memory = createInMemoryExecutionQueueStore(state?.jobs ?? []);
  }

  async function persist(): Promise<void> {
    await lapis.setSetting(key, {
      jobs: await memory.list(),
    } satisfies QueueState);
  }

  async function withPersistence<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the write chain so only one hydrate-modify-persist
    // cycle runs at a time. Read-only operations (list, get) can run
    // concurrently outside the chain.
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
    enqueue: (input, now) => withPersistence(() => memory.enqueue(input, now)),
    list: async (filter) => {
      await hydrate();
      return memory.list(filter);
    },
    get: async (jobId) => {
      await hydrate();
      return memory.get(jobId);
    },
    claimNext: (workerId, now) =>
      withPersistence(() => memory.claimNext(workerId, now)),
    markRunning: (jobId, claimToken, now) =>
      withPersistence(() => memory.markRunning(jobId, claimToken, now)),
    heartbeat: (jobId, claimToken, now) =>
      withPersistence(() => memory.heartbeat(jobId, claimToken, now)),
    complete: (jobId, claimToken, now) =>
      withPersistence(() => memory.complete(jobId, claimToken, now)),
    fail: (jobId, claimToken, code, message, now) =>
      withPersistence(() => memory.fail(jobId, claimToken, code, message, now)),
    requeue: (jobId, code, message, now) =>
      withPersistence(() => memory.requeue(jobId, code, message, now)),
    cancel: (jobId, now) => withPersistence(() => memory.cancel(jobId, now)),
  };
}
