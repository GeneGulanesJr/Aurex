import { describe, it, expect, vi } from "vitest";
import { createQuotaAwarePinyxClient, QuotaExhaustedError } from "../src/clients/pinyx-quota-wrapper.js";
import { createQuotaWindow, recordFirstLLMCall } from "../src/enforcement/quota-gate.js";
import type { PinyxClient, ChatResponse } from "../src/clients/pinyx-client.js";
import type { QuotaWindow } from "@aurex/shared";

const HOUR = 60 * 60 * 1000;

function mockPinyxClient(): PinyxClient {
  return {
    chat: vi.fn(async () => ({
      content: "test response",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }) as unknown as ChatResponse),
    chatStream: vi.fn(async (_req, onChunk) => {
      onChunk("test");
      return {
        content: "test response",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
    }),
    ping: vi.fn(async () => {}),
  };
}

describe("createQuotaAwarePinyxClient", () => {
  it("passes through when quota is disabled", async () => {
    const inner = mockPinyxClient();
    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => null,
      saveQuotaWindow: async () => {},
      enabled: false,
    });

    const result = await client.chat({ model: "test", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");
    expect(inner.chat).toHaveBeenCalledOnce();
  });

  it("passes through and creates first LLM call record when no firstLLMCallAt", async () => {
    const inner = mockPinyxClient();
    const window = createQuotaWindow({ now: new Date() });
    let saved: QuotaWindow | null = null;

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => window,
      saveQuotaWindow: async (w) => { saved = w; },
      enabled: true,
    });

    const result = await client.chat({ model: "test", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");
    expect(saved).not.toBeNull();
    expect(saved!.firstLLMCallAt).not.toBeNull();
  });

  it("passes through when within burn duration", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
      enabled: true,
    });

    const nearFuture = new Date(now.getTime() + 30 * 60 * 1000);
    vi.setSystemTime(nearFuture);

    const result = await client.chat({ model: "test", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");

    vi.useRealTimers();
  });

  it("throws QuotaExhaustedError when quota exhausted", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
      enabled: true,
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    await expect(
      client.chat({ model: "test", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(QuotaExhaustedError);

    vi.useRealTimers();
  });

  it("throws QuotaExhaustedError for chatStream as well", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
      enabled: true,
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    await expect(
      client.chatStream({ model: "test", messages: [{ role: "user", content: "hi" }] }, () => {}),
    ).rejects.toThrow(QuotaExhaustedError);

    vi.useRealTimers();
  });

  it("ping always passes through", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
      enabled: true,
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    await expect(client.ping()).resolves.toBeUndefined();

    vi.useRealTimers();
  });
});
