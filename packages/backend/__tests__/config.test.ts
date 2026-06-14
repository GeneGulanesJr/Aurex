import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config";

function setDefaults(overrides?: Record<string, string>) {
  process.env.LAPIS_ENDPOINT = "http://localhost:9100";
  process.env.REPO_ROOT = "/tmp/test-repo";
  process.env.AUTH0_DOMAIN = "test.us.auth0.com";
  process.env.AUTH0_AUDIENCE = "https://api.test.io";
  if (overrides) Object.assign(process.env, overrides);
}

describe("loadConfig", () => {
  beforeEach(() => {
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
    delete process.env.AUREX_ROOT;
    delete process.env.MAX_CONCURRENT_MISSIONS;
    delete process.env.QUOTA_ENABLED;
    delete process.env.QUOTA_WINDOW_HOURS;
    delete process.env.QUOTA_BURN_HOURS;
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.AUTH_DISABLED;
  });

  it("reads LAPIS_ENDPOINT", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.lapisEndpoint).toBe("http://localhost:9100");
    expect((config as Record<string, unknown>).lapisDbPath).toBeUndefined();
    expect((config as Record<string, unknown>).lapisCliPath).toBeUndefined();
  });

  it("does not require PINYX_ENDPOINT — PiNyx is configured via UI", () => {
    setDefaults();
    const config = loadConfig();
    expect((config as Record<string, unknown>).pinyxEndpoint).toBeUndefined();
    expect((config as Record<string, unknown>).modelHints).toBeUndefined();
  });

  it("provides timeout defaults", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(180_000);
  });

  it("throws on missing required env vars", () => {
    expect(() => loadConfig()).toThrow("Missing required env var");
  });

  it("defaults gitMainBranch to main", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.gitMainBranch).toBe("main");
  });

  it("reads PORT from env", () => {
    setDefaults({ PORT: "8080" });
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it("defaults PORT to 3000", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.port).toBe(3000);
  });

  it("reads Auth0 config from env", () => {
    setDefaults({
      AUTH0_DOMAIN: "my-tenant.us.auth0.com",
      AUTH0_AUDIENCE: "https://api.aurex.io",
    });
    const config = loadConfig();
    expect(config.auth0Domain).toBe("my-tenant.us.auth0.com");
    expect(config.auth0Audience).toBe("https://api.aurex.io");
  });

  it("throws when AUTH0_DOMAIN is missing", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    expect(() => loadConfig()).toThrow("AUTH0_DOMAIN");
  });

  it("throws when AUTH0_AUDIENCE is missing", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.AUTH0_DOMAIN = "test.us.auth0.com";
    expect(() => loadConfig()).toThrow("AUTH0_AUDIENCE");
  });

  it("does not require AUTH0 fields when AUTH_DISABLED=true", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.AUTH_DISABLED = "true";
    const config = loadConfig();
    expect(config.authDisabled).toBe(true);
    expect(config.auth0Domain).toBe("");
    expect(config.auth0Audience).toBe("");
  });

  it("reads MISSION_COST_CAP as float", () => {
    setDefaults({ MISSION_COST_CAP: "99.5" });
    const config = loadConfig();
    expect(config.missionCostCap).toBe(99.5);
  });

  it("defaults MISSION_COST_CAP to 50.0", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.missionCostCap).toBe(50.0);
  });

  it("reads custom worker timeouts", () => {
    setDefaults({
      WORKER_TIMEOUT_SIMPLE: "60000",
      WORKER_TIMEOUT_BUILD: "120000",
      WORKER_TIMEOUT_TEST_HEAVY: "300000",
    });
    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(60000);
    expect(config.workerTimeouts.build).toBe(120000);
    expect(config.workerTimeouts.testHeavy).toBe(300000);
  });

  it("defaults validator and research timeouts", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.validatorTimeout).toBe(180000);
    expect(config.researchTimeout).toBe(120000);
  });

  it("reads maxValidatorRetries and maxRescopes", () => {
    setDefaults({
      MAX_VALIDATOR_RETRIES: "5",
      MAX_RESCOPES_PER_MILESTONE: "10",
    });
    const config = loadConfig();
    expect(config.maxValidatorRetries).toBe(5);
    expect(config.maxRescopes).toBe(10);
  });

  it("defaults validator tool-call cap to unlimited", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.validatorToolCallCap).toBe(0);
  });

  it("reads validator tool-call cap from env", () => {
    setDefaults({ VALIDATOR_TOOL_CALL_CAP: "80" });
    const config = loadConfig();
    expect(config.validatorToolCallCap).toBe(80);
  });

  it("defaults maxConcurrentMissions to 3", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.maxConcurrentMissions).toBe(3);
  });

  it("reads AUREX_ROOT from env", () => {
    setDefaults({ AUREX_ROOT: "/opt/aurex" });
    const config = loadConfig();
    expect(config.aurexRoot).toBe("/opt/aurex");
  });

  it("defaults AUREX_ROOT to REPO_ROOT", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.aurexRoot).toBe("/tmp/test-repo");
  });

  it("reads custom gitMainBranch", () => {
    setDefaults({ GIT_MAIN_BRANCH: "develop" });
    const config = loadConfig();
    expect(config.gitMainBranch).toBe("develop");
  });

  it("reads quota settings from env", () => {
    setDefaults({
      QUOTA_ENABLED: "true",
      QUOTA_WINDOW_HOURS: "10",
      QUOTA_BURN_HOURS: "2",
    });
    const config = loadConfig();
    expect(config.quotaEnabled).toBe(true);
    expect(config.quotaWindowDurationMs).toBe(10 * 60 * 60 * 1000);
    expect(config.quotaBurnDurationMs).toBe(2 * 60 * 60 * 1000);
  });

  it("defaults quota settings to disabled with 5h window 1h burn", () => {
    setDefaults();
    const config = loadConfig();
    expect(config.quotaEnabled).toBe(false);
    expect(config.quotaWindowDurationMs).toBe(5 * 60 * 60 * 1000);
    expect(config.quotaBurnDurationMs).toBe(1 * 60 * 60 * 1000);
  });

  it("throws with the key name for missing required vars", () => {
    process.env.REPO_ROOT = "/tmp/test-repo";
    expect(() => loadConfig()).toThrow("LAPIS_ENDPOINT");
  });

  it("throws when REPO_ROOT is missing", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    expect(() => loadConfig()).toThrow("REPO_ROOT");
  });
});
