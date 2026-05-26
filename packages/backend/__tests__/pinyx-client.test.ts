import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinyxClient, PinyxClient } from "../src/clients/pinyx-client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("PinyxClient", () => {
  let client: PinyxClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createPinyxClient({ endpoint: "http://localhost:7331" });
  });

  it("sends chat completions to PiNyx", async () => {
    mockFetch.mockReturnValue(mockResponse({
      id: "chatcmpl-1",
      choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));

    const result = await client.chat({
      model: "code-fast",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7331/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.content).toBe("Hello");
    expect(result.usage.promptTokens).toBe(10);
  });

  it("ping checks /v1/models", async () => {
    mockFetch.mockReturnValue(mockResponse({ data: [] }));
    await client.ping();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7331/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws on PiNyx error", async () => {
    mockFetch.mockReturnValue(mockResponse({ error: "model not found" }, 404));
    await expect(client.chat({
      model: "nonexistent",
      messages: [{ role: "user", content: "test" }],
    })).rejects.toThrow();
  });
});
