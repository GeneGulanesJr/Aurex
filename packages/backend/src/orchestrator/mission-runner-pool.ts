import type { MissionRunner, MissionRunnerConfig } from "./mission-runner.js";
import { createMissionRunner } from "./mission-runner.js";
import type { EventBus } from "../ws/events.js";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";

export interface PoolMissionStatus {
  missionId: string;
  state: "queued" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed" | "aborted";
  queuePosition?: number;
}

export interface MissionRunnerPool {
  submit(missionId: string): void;
  abort(missionId: string): void;
  getStatus(missionId: string): PoolMissionStatus | null;
  getActiveMissions(): PoolMissionStatus[];
  waitForCompletion(missionId: string): Promise<void>;
  drain(): Promise<void>;
}

export interface MissionRunnerPoolConfig extends Omit<MissionRunnerConfig, "eventBus"> {
  maxConcurrent: number;
  eventBus: EventBus;
  /**
   * When provided, each runner mirrors a durable execution-queue job's
   * lifetime (heartbeat → complete/fail). The pool enqueues + claims the job
   * itself so the generic execution worker never picks it up.
   */
  queue?: ExecutionQueueStore;
}

type RunningEntry = {
  runner: MissionRunner;
  state: PoolMissionStatus["state"];
  completionPromise: Promise<void>;
};

const POOL_WORKER_ID = "mission-pool";

export function createMissionRunnerPool(poolConfig: MissionRunnerPoolConfig): MissionRunnerPool {
  const { maxConcurrent, eventBus: _eventBus, queue: executionQueue, ...baseConfig } = poolConfig;
  const eventBus = _eventBus;
  const running = new Map<string, RunningEntry>();
  const pending: string[] = [];
  const completionWaiters = new Map<string, Array<() => void>>();

  function drainWaiters(missionId: string) {
    const waiters = completionWaiters.get(missionId);
    if (!waiters) return;
    completionWaiters.delete(missionId);
    for (const resolve of waiters) resolve();
  }

  function onMissionDone(missionId: string) {
    const entry = running.get(missionId);
    let finalState: PoolMissionStatus["state"] = "failed";
    if (entry) {
      const runnerState = entry.runner.getStatus().state;
      entry.state = runnerState as PoolMissionStatus["state"];
      finalState = entry.state;
    }
    running.delete(missionId);
    eventBus.emit({ type: "mission_completed", missionId, finalState });
    drainWaiters(missionId);
    startNext();
  }

  function startNext() {
    while (running.size < maxConcurrent && pending.length > 0) {
      const missionId = pending.shift()!;
      void startRunner(missionId);
    }
  }

  async function startRunner(missionId: string) {
    let runnerConfig: MissionRunnerConfig = { ...baseConfig, eventBus };

    // When a durable queue is configured, enqueue + claim a mission lifecycle
    // job so the runner owns it. The claim is by-id (not claimNext) so the
    // generic execution worker can't grab it. On any queue error, fall back
    // to non-durable behavior — the mission still runs, just without
    // queue-backed durability for this invocation.
    if (executionQueue) {
      try {
        const job = await executionQueue.enqueue({
          type: "mission_start",
          missionId,
          maxAttempts: 1,
        });
        const claim = await executionQueue.claimById(job.id, POOL_WORKER_ID);
        if (claim) {
          await executionQueue.markRunning(claim.job.id, claim.claimToken);
          runnerConfig = { ...runnerConfig, queue: executionQueue, job: { jobId: claim.job.id, claimToken: claim.claimToken } };
        }
      } catch (err) {
        console.warn(`[pool] durable job setup failed for mission ${missionId}:`, err instanceof Error ? err.message : err);
      }
    }

    const runner = createMissionRunner(runnerConfig);

    const completionPromise = new Promise<void>((resolve) => {
      runner.waitForCompletion().then(resolve, resolve);
    });

    running.set(missionId, { runner, state: "planning", completionPromise });

    eventBus.emit({ type: "mission_started", missionId });
    runner.start(missionId);

    void completionPromise.then(() => {
      const entry = running.get(missionId);
      if (entry) {
        entry.state = runner.getStatus().state as PoolMissionStatus["state"];
      }
      onMissionDone(missionId);
    });
  }

  return {
    submit(missionId) {
      if (running.has(missionId) || pending.includes(missionId)) {
        return;
      }

      if (running.size < maxConcurrent) {
        void startRunner(missionId);
      } else {
        pending.push(missionId);
        eventBus.emit({ type: "mission_queued", missionId, queuePosition: pending.length });
      }
    },

    abort(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        entry.runner.abort();
        return;
      }
      const idx = pending.indexOf(missionId);
      if (idx !== -1) {
        pending.splice(idx, 1);
        drainWaiters(missionId);
      }
    },

    getStatus(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        const runnerState = entry.runner.getStatus().state;
        return { missionId, state: runnerState as PoolMissionStatus["state"] };
      }
      const queueIdx = pending.indexOf(missionId);
      if (queueIdx !== -1) {
        return { missionId, state: "queued", queuePosition: queueIdx + 1 };
      }
      return null;
    },

    getActiveMissions() {
      const results: PoolMissionStatus[] = [];
      for (const [missionId, entry] of running) {
        const runnerState = entry.runner.getStatus().state;
        results.push({ missionId, state: runnerState as PoolMissionStatus["state"] });
      }
      for (let i = 0; i < pending.length; i++) {
        results.push({ missionId: pending[i], state: "queued", queuePosition: i + 1 });
      }
      return results;
    },

    waitForCompletion(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        return entry.completionPromise;
      }
      if (!pending.includes(missionId)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const waiters = completionWaiters.get(missionId) || [];
        waiters.push(resolve);
        completionWaiters.set(missionId, waiters);
      });
    },

    async drain() {
      pending.length = 0;
      for (const [, entry] of running) {
        entry.runner.abort();
      }
      const promises = [...running.values()].map((e) => e.completionPromise);
      await Promise.allSettled(promises);
    },
  };
}
