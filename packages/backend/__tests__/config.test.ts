import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    // Reset env for each test
    delete process.env.LAPIS_ENDPOINT;
    delete process.env.REPO_ROOT;
    delete process.env.PORT;
    delete process.env.WS_PORT;
    delete process.env.MISSION_COST_CAP;
    delete process.env.WORKER_TIMEOUT_SIMPLE;
    delete process.env.WORKER_TIMEOUT_BUILD;
    delete process.env.WORKER_TIMEOUT_TEST_HEAVY;
    delete process.env.VALIDATOR_TIMEOUT;
    delete process.env.VALIDATOR_TOOL_CALL_CAP;
    delete process.env.RESEARCH_TIMEOUT;
    delete process.env.MAX_VALIDATOR_RETRIES;
    delete process.env.MAX_RESCOPES_PER_MILESTONE;
    delete process.env.GIT_MAIN_BRANCH;
    delete process.env.API_KEY;
    delete process.env.AUREX_ROOT;
    delete process.env.MAX_CONCURRENT_MISSIONS;
    delete process.env.QUOTA_ENABLED;
    delete process.env.QUOTA_WINDOW_HOURS;
    delete process.env.QUOTA_BURN_HOURS;
  });

  it("reads LAPIS_ENDPOINT", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.lapisEndpoint).toBe("http://localhost:9100");
    expect((config as Record<string, unknown>).lapisDbPath).toBeUndefined();
    expect((config as Record<string, unknown>).lapisCliPath).toBeUndefined();
  });

  it("does not require PINYX_ENDPOINT — PiNyx is configured via UI", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect((config as Record<string, unknown>).pinyxEndpoint).toBeUndefined();
    expect((config as Record<string, unknown>).modelHints).toBeUndefined();
  });

  it("provides timeout defaults", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(180_000);
  });

  it("throws on missing required env vars", () => {
    expect(() => loadConfig()).toThrow("Missing required env var");
  });

  it("defaults gitMainBranch to main", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.gitMainBranch).toBe("main");
  });

  it("reads PORT from env", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.PORT = "8080";
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it("defaults PORT to 3000", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.port).toBe(3000);
  });

  it("reads apiKey from env", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.API_KEY = "secret123";
    const config = loadConfig();
    expect(config.apiKey).toBe("secret123");
  });

  it("defaults apiKey to null", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.apiKey).toBeNull();
  });

  it("reads MISSION_COST_CAP as float", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.MISSION_COST_CAP = "99.5";
    const config = loadConfig();
    expect(config.missionCostCap).toBe(99.5);
  });

  it("defaults MISSION_COST_CAP to 50.0", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.missionCostCap).toBe(50.0);
  });

  it("reads custom worker timeouts", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.WORKER_TIMEOUT_SIMPLE = "60000";
    process.env.WORKER_TIMEOUT_BUILD = "120000";
    process.env.WORKER_TIMEOUT_TEST_HEAVY = "300000";
    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(60000);
    expect(config.workerTimeouts.build).toBe(120000);
    expect(config.workerTimeouts.testHeavy).toBe(300000);
  });

  it("defaults validator and research timeouts", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.validatorTimeout).toBe(180000);
    expect(config.researchTimeout).toBe(120000);
  });

  it("reads maxValidatorRetries and maxRescopes", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.MAX_VALIDATOR_RETRIES = "5";
    process.env.MAX_RESCOPES_PER_MILESTONE = "10";
    const config = loadConfig();
    expect(config.maxValidatorRetries).toBe(5);
    expect(config.maxRescopes).toBe(10);
  });

  it("defaults validator tool-call cap to unlimited", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.validatorToolCallCap).toBe(0);
  });

  it("reads validator tool-call cap from env", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.VALIDATOR_TOOL_CALL_CAP = "80";
    const config = loadConfig();
    expect(config.validatorToolCallCap).toBe(80);
  });

  it("defaults maxConcurrentMissions to 3", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.maxConcurrentMissions).toBe(3);
  });

  it("reads AUREX_ROOT from env", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.AUREX_ROOT = "/opt/aurex";
    const config = loadConfig();
    expect(config.aurexRoot).toBe("/opt/aurex");
  });

  it("defaults AUREX_ROOT to REPO_ROOT", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.aurexRoot).toBe("/tmp/test-repo");
  });

  it("reads custom gitMainBranch", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.GIT_MAIN_BRANCH = "develop";
    const config = loadConfig();
    expect(config.gitMainBranch).toBe("develop");
  });

  it("reads quota settings from env", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.QUOTA_ENABLED = "true";
    process.env.QUOTA_WINDOW_HOURS = "10";
    process.env.QUOTA_BURN_HOURS = "2";
    const config = loadConfig();
    expect(config.quotaEnabled).toBe(true);
    expect(config.quotaWindowDurationMs).toBe(10 * 60 * 60 * 1000);
    expect(config.quotaBurnDurationMs).toBe(2 * 60 * 60 * 1000);
  });

  it("defaults quota settings to disabled with 5h window 1h burn", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    const config = loadConfig();
    expect(config.quotaEnabled).toBe(false);
    expect(config.quotaWindowDurationMs).toBe(5 * 60 * 60 * 1000);
    expect(config.quotaBurnDurationMs).toBe(1 * 60 * 60 * 1000);
  });

  it("throws with the key name for missing required vars", () => {
    // LAPIS_ENDPOINT is missing
    process.env.REPO_ROOT = "/tmp/test-repo";
    expect(() => loadConfig()).toThrow("LAPIS_ENDPOINT");
  });

  it("throws when REPO_ROOT is missing", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    expect(() => loadConfig()).toThrow("REPO_ROOT");
  });
});
