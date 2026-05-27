import type { MissionRunner, MissionRunnerConfig } from "./mission-runner.js";
import { createMissionRunner } from "./mission-runner.js";
import type { EventBus } from "../ws/events.js";

export interface PoolMissionStatus {
  missionId: string;
  state: "queued" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed";
  queuePosition?: number;
}

export interface MissionRunnerPool {
  submit(missionId: string): void;
  abort(missionId: string): void;
  getStatus(missionId: string): PoolMissionStatus | null;
  getActiveMissions(): PoolMissionStatus[];
  waitForCompletion(missionId: string): Promise<void>;
}

export interface MissionRunnerPoolConfig extends MissionRunnerConfig {
  maxConcurrent: number;
  eventBus: EventBus;
}

type RunningEntry = {
  runner: MissionRunner;
  state: PoolMissionStatus["state"];
  completionPromise: Promise<void>;
};

export function createMissionRunnerPool(poolConfig: MissionRunnerPoolConfig): MissionRunnerPool {
  const { maxConcurrent, eventBus: _eventBus, ...baseConfig } = poolConfig;
  const eventBus = _eventBus;
  const running = new Map<string, RunningEntry>();
  const queue: string[] = [];
  const completionWaiters = new Map<string, Array<() => void>>();

  function drainWaiters(missionId: string) {
    const waiters = completionWaiters.get(missionId);
    if (!waiters) return;
    completionWaiters.delete(missionId);
    for (const resolve of waiters) resolve();
  }

  function onMissionDone(missionId: string) {
    const entry = running.get(missionId);
    if (entry) {
      const finalState = entry.runner.getStatus().state;
      entry.state = finalState as PoolMissionStatus["state"];
    }
    running.delete(missionId);
    eventBus.emit({ type: "mission_completed", missionId, finalState: "completed" } as any);
    drainWaiters(missionId);
    startNext();
  }

  function startNext() {
    while (running.size < maxConcurrent && queue.length > 0) {
      const missionId = queue.shift()!;
      startRunner(missionId);
    }
  }

  function startRunner(missionId: string) {
    const runnerConfig: MissionRunnerConfig = { ...baseConfig, eventBus };
    const runner = createMissionRunner(runnerConfig);

    const completionPromise = new Promise<void>((resolve) => {
      runner.waitForCompletion().then(resolve, resolve);
    });

    running.set(missionId, { runner, state: "planning", completionPromise });

    eventBus.emit({ type: "mission_started", missionId } as any);
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
      if (running.has(missionId) || queue.includes(missionId)) {
        return;
      }

      if (running.size < maxConcurrent) {
        startRunner(missionId);
      } else {
        queue.push(missionId);
        eventBus.emit({ type: "mission_queued", missionId, queuePosition: queue.length } as any);
      }
    },

    abort(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        entry.runner.abort();
        return;
      }
      const idx = queue.indexOf(missionId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        drainWaiters(missionId);
      }
    },

    getStatus(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        const runnerState = entry.runner.getStatus().state;
        return { missionId, state: runnerState as PoolMissionStatus["state"] };
      }
      const queueIdx = queue.indexOf(missionId);
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
      for (let i = 0; i < queue.length; i++) {
        results.push({ missionId: queue[i], state: "queued", queuePosition: i + 1 });
      }
      return results;
    },

    waitForCompletion(missionId) {
      const entry = running.get(missionId);
      if (entry) {
        return entry.completionPromise;
      }
      if (!queue.includes(missionId)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const waiters = completionWaiters.get(missionId) || [];
        waiters.push(resolve);
        completionWaiters.set(missionId, waiters);
      });
    },
  };
}
