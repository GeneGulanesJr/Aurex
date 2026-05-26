import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuid } from 'uuid';
import { kill } from 'node:process';
import type { WorkingUnit, MissionConfig } from '@aurex/shared';
import { getDb } from '../db.js';
import type { AppConfig } from '../config.js';
import { emitEvent } from '../events.js';

export interface SpawnResult {
  success: boolean;
  output: string;
  timedOut: boolean;
  exitCode: number | null;
}

export interface PiProcessManager {
  spawnWorker(
    unit: WorkingUnit,
    config: MissionConfig,
    missionId: string,
    milestoneId: string,
  ): Promise<SpawnResult>;

  spawnValidator(
    role: 'implementation_reviewer' | 'contract_checker',
    prompt: string,
    config: MissionConfig,
    missionId: string,
    milestoneId: string,
  ): Promise<SpawnResult>;

  killProcess(pid: number): void;
}

function runProcess(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    let timedOut = false;

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stdin?.write(input);
    proc.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // process already dead
        }
      }, 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: !timedOut && code === 0,
        output,
        timedOut,
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: err.message,
        timedOut: false,
        exitCode: null,
      });
    });
  });
}

export function createPiProcessManager(config: AppConfig): PiProcessManager {
  return {
    async spawnWorker(unit, missionConfig, missionId, milestoneId) {
      const db = getDb();

      db.prepare(
        `UPDATE working_units SET status = 'running', started_at = datetime('now') WHERE id = ?`,
      ).run(unit.id);

      emitEvent({
        type: 'worker_spawned',
        missionId,
        milestoneId,
        timestamp: new Date().toISOString(),
        data: { workingUnitId: unit.id, title: unit.title, batchIndex: 0 },
      });

      const result = await runProcess(
        config.piBinaryPath,
        ['--task', '-'],
        unit.taskSpecJson,
        missionConfig.workerTimeoutMs,
      );

      if (result.timedOut) {
        db.prepare(
          `UPDATE working_units SET status = 'timed_out', completed_at = datetime('now') WHERE id = ?`,
        ).run(unit.id);

        const retryType = 'worker_timeout';
        const existing = db.prepare(
          `SELECT id, attempt_count FROM retry_counters WHERE mission_id = ? AND working_unit_id = ? AND retry_type = ?`,
        ).get(missionId, unit.id, retryType) as { id: string; attempt_count: number } | undefined;

        if (existing) {
          db.prepare(
            `UPDATE retry_counters SET attempt_count = attempt_count + 1, last_attempt_at = datetime('now') WHERE id = ?`,
          ).run(existing.id);
        } else {
          db.prepare(
            `INSERT INTO retry_counters (id, mission_id, milestone_id, working_unit_id, retry_type, attempt_count, max_attempts) VALUES (?, ?, ?, ?, ?, 1, ?)`,
          ).run(uuid(), missionId, milestoneId, unit.id, retryType, missionConfig.maxRetryCount);
        }

        emitEvent({
          type: 'worker_timeout',
          missionId,
          milestoneId,
          timestamp: new Date().toISOString(),
          data: { workingUnitId: unit.id, title: unit.title },
        });
      } else {
        db.prepare(
          `UPDATE working_units SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
        ).run(unit.id);

        emitEvent({
          type: 'worker_completed',
          missionId,
          milestoneId,
          timestamp: new Date().toISOString(),
          data: { workingUnitId: unit.id, title: unit.title, handoffSummary: result.output.slice(0, 200) },
        });
      }

      return result;
    },

    async spawnValidator(role, prompt, missionConfig, missionId, milestoneId) {
      const timeout = missionConfig.validatorTimeoutMs;
      const result = await runProcess(
        config.piBinaryPath,
        ['--task', '-'],
        prompt,
        timeout,
      );

      if (result.success && result.output) {
        const db = getDb();
        db.prepare(
          `INSERT INTO research_findings (id, mission_id, milestone_id, prompt, findings, source, relevance) VALUES (?, ?, ?, ?, ?, 'validator', 'high')`,
        ).run(uuid(), missionId, milestoneId, prompt.slice(0, 500), result.output);
      }

      return result;
    },

    killProcess(pid: number) {
      try {
        kill(pid, 'SIGTERM');
      } catch {
        // process may already be dead
      }
    },
  };
}
