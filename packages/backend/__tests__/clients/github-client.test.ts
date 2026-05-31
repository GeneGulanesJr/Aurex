import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mock
const { getUser, listRepos } = await import("../../src/clients/github-client.js");

describe("github-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUser", () => {
    it("returns user profile from valid token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" }),
      });

      const user = await getUser("ghp_abc123");
      expect(user).toEqual({ login: "testuser", avatar_url: "https://avatar.url", name: "Test User" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_abc123",
          }),
        }),
      );
    });

    it("throws on failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(getUser("bad")).rejects.toThrow("GitHub getUser failed: 401");
    });
  });

  describe("listRepos", () => {
    it("returns mapped repos", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{
          id: 1,
          full_name: "owner/repo",
          clone_url: "https://github.com/owner/repo.git",
          private: true,
          default_branch: "main",
          updated_at: "2026-01-01T00:00:00Z",
        }]),
      });
      const repos = await listRepos("token");
      expect(repos).toHaveLength(1);
      expect(repos[0].full_name).toBe("owner/repo");
    });

    it("throws on failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      await expect(listRepos("bad")).rejects.toThrow("GitHub listRepos failed: 403");
    });
  });
});
