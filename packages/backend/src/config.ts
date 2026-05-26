// packages/backend/src/config.ts

export interface AppConfig {
  // LaPis (shared state) — HTTP only
  lapisEndpoint: string;

  // PiNyx (LLM gateway)
  pinyxEndpoint: string;

  // Agent model hints (passed to PiNyx routing)
  modelHints: {
    orchestrator: string;
    worker: string;
    validator_scrutiny: string;
    validator_user_testing: string;
    research: string;
  };

  // Agent timeouts (ms)
  workerTimeouts: {
    simple: number;
    build: number;
    testHeavy: number;
  };
  validatorTimeout: number;
  researchTimeout: number;

  // Mission limits
  maxValidatorRetries: number;
  maxRescopes: number;
  missionCostCap: number;

  // Git
  repoRoot: string;
  gitMainBranch: string;

  // Server
  port: number;
  wsPort: number;
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
  const required = ["LAPIS_ENDPOINT", "PINYX_ENDPOINT", "REPO_ROOT"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    lapisEndpoint: env("LAPIS_ENDPOINT"),
    pinyxEndpoint: env("PINYX_ENDPOINT"),

    modelHints: {
      orchestrator: env("MODEL_ORCHESTRATOR", "reasoning-strong"),
      worker: env("MODEL_WORKER", "code-fast"),
      validator_scrutiny: env("MODEL_VALIDATOR_SCRUTINY", "reasoning"),
      validator_user_testing: env("MODEL_VALIDATOR_USER_TESTING", "computer-use"),
      research: env("MODEL_RESEARCH", "fast-cheap"),
    },

    workerTimeouts: {
      simple: envInt("WORKER_TIMEOUT_SIMPLE", 120_000),
      build: envInt("WORKER_TIMEOUT_BUILD", 300_000),
      testHeavy: envInt("WORKER_TIMEOUT_TEST_HEAVY", 600_000),
    },
    validatorTimeout: envInt("VALIDATOR_TIMEOUT", 180_000),
    researchTimeout: envInt("RESEARCH_TIMEOUT", 120_000),

    maxValidatorRetries: envInt("MAX_VALIDATOR_RETRIES", 2),
    maxRescopes: envInt("MAX_RESCOPES_PER_MILESTONE", 5),
    missionCostCap: envFloat("MISSION_COST_CAP", 50.0),

    repoRoot: env("REPO_ROOT"),
    gitMainBranch: env("GIT_MAIN_BRANCH", "main"),

    port: envInt("PORT", 3000),
    wsPort: envInt("WS_PORT", 3001),
  };
}
