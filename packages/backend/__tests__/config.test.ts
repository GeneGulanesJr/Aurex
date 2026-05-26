import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    // Reset env for each test
    delete process.env.LAPIS_ENDPOINT;
    delete process.env.PINYX_ENDPOINT;
    delete process.env.REPO_ROOT;
    delete process.env.PORT;
    delete process.env.WS_PORT;
    delete process.env.MISSION_COST_CAP;
    delete process.env.MODEL_ORCHESTRATOR;
    delete process.env.WORKER_TIMEOUT_SIMPLE;
    delete process.env.GIT_MAIN_BRANCH;
  });

  it("reads LAPIS_ENDPOINT not LAPIS_DB_PATH", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.lapisEndpoint).toBe("http://localhost:9100");
    expect(config.pinyxEndpoint).toBe("http://localhost:7331");
    expect((config as Record<string, unknown>).lapisDbPath).toBeUndefined();
    expect((config as Record<string, unknown>).lapisCliPath).toBeUndefined();
  });

  it("provides model hints with defaults", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.modelHints.orchestrator).toBe("reasoning-strong");
    expect(config.modelHints.worker).toBe("code-fast");
  });

  it("provides timeout defaults", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(120000);
  });

  it("throws on missing required env vars", () => {
    expect(() => loadConfig()).toThrow("Missing required env var");
  });

  it("defaults gitMainBranch to main", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";

    const config = loadConfig();
    expect(config.gitMainBranch).toBe("main");
  });
});
