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
    delete process.env.GIT_MAIN_BRANCH;
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
    expect(config.workerTimeouts.simple).toBe(120000);
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
});
