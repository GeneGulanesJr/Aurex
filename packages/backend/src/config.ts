import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MissionConfig } from '@aurex/shared';

export interface AppConfig {
  port: number;
  host: string;
  lapisDbPath: string;
  pinyxEndpoint: string;
  workspacePath: string;
  lapisCliPath: string;
  piBinaryPath: string;
  defaultConfig: MissionConfig;
}

let _config: AppConfig | null = null;

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export function loadConfig(): AppConfig {
  if (_config) return _config;

  try {
    const envPath = resolve(process.cwd(), '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env file is optional
  }

  _config = {
    port: envInt('PORT', 3000),
    host: env('HOST', '0.0.0.0'),
    lapisDbPath: env('LAPIS_DB_PATH', '/data/lapis/memory.db'),
    pinyxEndpoint: env('PINYX_ENDPOINT', 'http://localhost:7331'),
    workspacePath: env('WORKSPACE_PATH', '/workspace'),
    lapisCliPath: env('LAPIS_CLI_PATH', ''),
    piBinaryPath: env('PI_BINARY_PATH', 'pi'),
    defaultConfig: {
      workerTimeoutMs: envInt('DEFAULT_WORKER_TIMEOUT_MS', 300000),
      validatorTimeoutMs: envInt('DEFAULT_VALIDATOR_TIMEOUT_MS', 120000),
      researchTimeoutMs: envInt('DEFAULT_RESEARCH_TIMEOUT_MS', 180000),
      maxRetryCount: envInt('MAX_RETRY_COUNT', 3),
      maxRescopeCount: envInt('MAX_RESCOPE_COUNT', 2),
      maxMilestoneCount: envInt('MAX_MILESTONE_COUNT', 10),
    },
  };

  return _config;
}
