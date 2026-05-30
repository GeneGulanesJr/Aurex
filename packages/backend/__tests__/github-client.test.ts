// packages/backend/__tests__/github-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exchangeCode, getUser, listRepos, revokeToken } from "../src/clients/github-client.js";

describe("github-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("exchangeCode", () => {
    it("exchanges code for access token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "ghp_test123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const token = await exchangeCode("cid", "csec", "code123", "http://localhost/callback");
      expect(token).toBe("ghp_test123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on OAuth error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "bad_verification_code" }),
      }));
      await expect(exchangeCode("cid", "csec", "bad", "http://localhost/callback"))
        .rejects.toThrow("GitHub OAuth error: bad_verification_code");
    });

    it("throws on HTTP error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
      await expect(exchangeCode("cid", "csec", "code", "http://localhost/callback"))
        .rejects.toThrow("GitHub token exchange failed: 422");
    });
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

  describe("revokeToken", () => {
    it("sends DELETE with Basic auth", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      vi.stubGlobal("fetch", mockFetch);
      await revokeToken("cid", "csec", "token");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/cid/token",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({ Authorization: expect.stringContaining("Basic") }),
        }),
      );
    });

    it("ignores 404 (already revoked)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(revokeToken("cid", "csec", "token")).resolves.toBeUndefined();
    });

    it("throws on other errors", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      await expect(revokeToken("cid", "csec", "token")).rejects.toThrow("GitHub revokeToken failed: 500");
    });
  });
});
