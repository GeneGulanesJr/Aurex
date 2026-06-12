// packages/backend/src/config.ts

export interface AppConfig {
  lapisEndpoint: string;

  workerTimeouts: {
    simple: number;
    build: number;
    testHeavy: number;
  };
  validatorTimeout: number;
  researchTimeout: number;

  maxValidatorRetries: number;
  maxRescopes: number;
  validatorToolCallCap: number;
  missionCostCap: number;

  repoRoot: string;
  aurexRoot: string;
  gitMainBranch: string;

  port: number;

  auth0Domain: string;
  auth0Audience: string;

  maxConcurrentMissions: number;

  quotaEnabled: boolean;
  quotaWindowDurationMs: number;
  quotaBurnDurationMs: number;
}

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

function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseFloat(val) : fallback;
}

export function loadConfig(): AppConfig {
  const required = ["LAPIS_ENDPOINT", "REPO_ROOT"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    lapisEndpoint: env("LAPIS_ENDPOINT"),

    workerTimeouts: {
      simple: envInt("WORKER_TIMEOUT_SIMPLE", 180_000),
      build: envInt("WORKER_TIMEOUT_BUILD", 300_000),
      testHeavy: envInt("WORKER_TIMEOUT_TEST_HEAVY", 600_000),
    },
    validatorTimeout: envInt("VALIDATOR_TIMEOUT", 180_000),
    researchTimeout: envInt("RESEARCH_TIMEOUT", 120_000),

    maxValidatorRetries: envInt("MAX_VALIDATOR_RETRIES", 2),
    maxRescopes: envInt("MAX_RESCOPES_PER_MILESTONE", 2),
    validatorToolCallCap: Math.max(0, envInt("VALIDATOR_TOOL_CALL_CAP", 0)),
    missionCostCap: envFloat("MISSION_COST_CAP", 50.0),

    repoRoot: env("REPO_ROOT"),
    aurexRoot: env("AUREX_ROOT", env("REPO_ROOT")),
    gitMainBranch: env("GIT_MAIN_BRANCH", "main"),

    port: envInt("PORT", 3000),
    auth0Domain: env("AUTH0_DOMAIN"),
    auth0Audience: env("AUTH0_AUDIENCE"),
    maxConcurrentMissions: envInt("MAX_CONCURRENT_MISSIONS", 3),

    quotaEnabled: process.env.QUOTA_ENABLED === "true",
    quotaWindowDurationMs: envInt("QUOTA_WINDOW_HOURS", 5) * 60 * 60 * 1000,
    quotaBurnDurationMs: envInt("QUOTA_BURN_HOURS", 1) * 60 * 60 * 1000,
  };
}
