// packages/backend/__tests__/github-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getUser, listRepos } from "../src/clients/github-client.js";

describe("github-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getUser", () => {
    it("returns user profile", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" }),
      }));
      const user = await getUser("token");
      expect(user).toEqual({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" });
    });

    it("returns null name when not set", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "testuser", avatar_url: "https://avatar.url", name: null }),
      }));
      const user = await getUser("token");
      expect(user.name).toBeNull();
    });

    it("throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      await expect(getUser("bad")).rejects.toThrow("GitHub getUser failed: 401");
    });
  });

  describe("listRepos", () => {
    it("returns mapped repos", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 1,
          full_name: "owner/repo",
          clone_url: "https://github.com/owner/repo.git",
          private: true,
          default_branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }]),
      }));
      const repos = await listRepos("token");
      expect(repos).toHaveLength(1);
      expect(repos[0].full_name).toBe("owner/repo");
    });

    it("throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
      await expect(listRepos("bad")).rejects.toThrow("GitHub listRepos failed: 403");
    });
  });
});
