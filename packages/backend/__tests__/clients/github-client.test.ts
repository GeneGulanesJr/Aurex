import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mock
const { exchangeCode } = await import("../../src/clients/github-client.js");

describe("github-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("exchangeCode", () => {
    it("exchanges an OAuth code for an access token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "ghu_abc123", token_type: "bearer", scope: "repo" }),
      });

      const result = await exchangeCode("Iv1.clientid", "shh-secret", "code123", "http://localhost:3000/api/github/callback");

      expect(result).toEqual({
        access_token: "ghu_abc123",
        token_type: "bearer",
        scope: "repo",
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
        }),
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        client_id: "Iv1.clientid",
        client_secret: "shh-secret",
        code: "code123",
        redirect_uri: "http://localhost:3000/api/github/callback",
      });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "bad_verification_code" }),
      });

      await expect(
        exchangeCode("id", "secret", "bad-code", "http://localhost:3000/api/github/callback"),
      ).rejects.toThrow("GitHub exchangeCode failed: 403");
    });
  });
});
