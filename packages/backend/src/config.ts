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

  /** Per-unit retry budget for the v1 sequential milestone loop. Default 2. */
  maxPerUnitRetries: number;
  /** Cheap per-unit smoke-check commands (test/typecheck/lint). */
  smokeCheckCommands: { test?: string; typecheck?: string; lint?: string };

  repoRoot: string;
  aurexRoot: string;
  gitMainBranch: string;

  port: number;

  authDisabled: boolean;
  auth0Domain: string;
  auth0Audience: string;

  maxConcurrentMissions: number;

  /** Soft token budget for the affected-code scaffold injected into worker context. */
  affectedCodeTokenBudget: number;

  quotaEnabled: boolean;
  quotaWindowDurationMs: number;
  quotaBurnDurationMs: number;

  // Durable execution control plane
  durableQueueEnabled: boolean;
  preparedSessionsEnabled: boolean;
  staleReconcilerEnabled: boolean;
  staleReconcilerDryRun: boolean;
  queueWorkerPollMs: number;
  queueWorkerId: string;
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

  // Auth0 credentials are required when auth is enabled. When
  // AUTH_DISABLED=true (local dev), they default to empty strings so the
  // app boots without an Auth0 tenant. Fail fast here rather than at the
  // first authenticated request (where empty values produce opaque
  // `new URL()` errors inside verifyJwt).
  const authDisabled = process.env.AUTH_DISABLED === "true";
  if (!authDisabled) {
    for (const key of ["AUTH0_DOMAIN", "AUTH0_AUDIENCE"]) {
      if (!process.env[key]) {
        throw new Error(`Missing required env var: ${key}`);
      }
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

    maxPerUnitRetries: envInt("MAX_PER_UNIT_RETRIES", 2),
    smokeCheckCommands: {
      test: process.env.SMOKE_CHECK_TEST || undefined,
      typecheck: process.env.SMOKE_CHECK_TYPECHECK || undefined,
      lint: process.env.SMOKE_CHECK_LINT || undefined,
    },

    repoRoot: env("REPO_ROOT"),
    aurexRoot: env("AUREX_ROOT", env("REPO_ROOT")),
    gitMainBranch: env("GIT_MAIN_BRANCH", "main"),

    port: envInt("PORT", 3000),
    authDisabled,
    auth0Domain: env("AUTH0_DOMAIN", ""),
    auth0Audience: env("AUTH0_AUDIENCE", ""),
    maxConcurrentMissions: envInt("MAX_CONCURRENT_MISSIONS", 3),

    affectedCodeTokenBudget: Math.max(0, envInt("AFFECTED_CODE_TOKEN_BUDGET", 1200)),

    quotaEnabled: process.env.QUOTA_ENABLED === "true",
    quotaWindowDurationMs: envInt("QUOTA_WINDOW_HOURS", 5) * 60 * 60 * 1000,
    quotaBurnDurationMs: envInt("QUOTA_BURN_HOURS", 1) * 60 * 60 * 1000,

    durableQueueEnabled: process.env.AUREX_DURABLE_QUEUE_ENABLED !== "false",
    preparedSessionsEnabled:
      process.env.AUREX_PREPARED_SESSIONS_ENABLED === "true",
    staleReconcilerEnabled:
      process.env.AUREX_STALE_RECONCILER_ENABLED === "true",
    staleReconcilerDryRun:
      process.env.AUREX_STALE_RECONCILER_DRY_RUN !== "false",
    queueWorkerPollMs: envInt("AUREX_QUEUE_WORKER_POLL_MS", 1000),
    queueWorkerId: env(
      "AUREX_QUEUE_WORKER_ID",
      `${process.env.HOSTNAME ?? "local"}:${process.pid}`,
    ),
  };
}
