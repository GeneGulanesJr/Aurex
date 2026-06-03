import { describe, it, expect, vi } from "vitest";
import { createQuotaAwarePinyxClient, QuotaExhaustedError } from "../src/clients/pinyx-quota-wrapper.js";
import { createQuotaWindow, recordFirstLLMCall } from "../src/enforcement/quota-gate.js";
import type { PinyxClient, ChatResponse } from "../src/clients/pinyx-client.js";
import type { QuotaWindow, QuotaConfig } from "@aurex/shared";

const HOUR = 60 * 60 * 1000;

const defaultConfig: QuotaConfig = {
  enabled: true,
  windowDurationMs: 5 * HOUR,
  burnDurationMs: HOUR,
  providers: [
    { providerId: "kilo", tracked: true },
  ],
};

const disabledConfig: QuotaConfig = {
  enabled: false,
  windowDurationMs: 5 * HOUR,
  burnDurationMs: HOUR,
  providers: [],
};

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
  it("passes through when quota config is disabled", async () => {
    const inner = mockPinyxClient();
    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => disabledConfig,
      getQuotaWindow: async () => null,
      saveQuotaWindow: async () => {},
    });

    const result = await client.chat({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");
    expect(inner.chat).toHaveBeenCalledOnce();
  });

  it("passes through for untracked provider", async () => {
    const inner = mockPinyxClient();
    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => null,
      saveQuotaWindow: async () => {},
    });

    const result = await client.chat({ model: "zai/glm-5", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");
    expect(inner.chat).toHaveBeenCalledOnce();
  });

  it("passes through and creates first LLM call record when no firstLLMCallAt", async () => {
    const inner = mockPinyxClient();
    const window = createQuotaWindow({ now: new Date() });
    let saved: QuotaWindow | null = null;

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => window,
      saveQuotaWindow: async (_pid, w) => { saved = w; },
    });

    const result = await client.chat({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] });
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
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
    });

    const nearFuture = new Date(now.getTime() + 30 * 60 * 1000);
    vi.setSystemTime(nearFuture);

    const result = await client.chat({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");

    vi.useRealTimers();
  });

  it("throws QuotaExhaustedError when quota exhausted", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    try {
      await client.chat({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(QuotaExhaustedError);
      expect((e as QuotaExhaustedError).providerId).toBe("kilo");
    }

    vi.useRealTimers();
  });

  it("throws QuotaExhaustedError for chatStream as well", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    await expect(
      client.chatStream({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] }, () => {}),
    ).rejects.toThrow(QuotaExhaustedError);

    vi.useRealTimers();
  });

  it("ping always passes through", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const window = createQuotaWindow({ now, burnDurationMs: HOUR });
    const withCall = recordFirstLLMCall(window, now);

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => defaultConfig,
      getQuotaWindow: async () => withCall,
      saveQuotaWindow: async () => {},
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    await expect(client.ping()).resolves.toBeUndefined();

    vi.useRealTimers();
  });

  it("per-provider isolation: kilo exhausted does not block zai", async () => {
    const inner = mockPinyxClient();
    const now = new Date();
    const kiloWindow = createQuotaWindow({ now, burnDurationMs: HOUR });
    const kiloWithCall = recordFirstLLMCall(kiloWindow, now);

    const config: QuotaConfig = {
      enabled: true,
      windowDurationMs: 5 * HOUR,
      burnDurationMs: HOUR,
      providers: [
        { providerId: "kilo", tracked: true },
        { providerId: "zai", tracked: true },
      ],
    };

    const windows: Record<string, QuotaWindow> = { kilo: kiloWithCall };

    const client = createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: async () => config,
      getQuotaWindow: async (pid) => windows[pid] ?? null,
      saveQuotaWindow: async (pid, w) => { windows[pid] = w; },
    });

    const afterBurn = new Date(now.getTime() + HOUR + 1000);
    vi.setSystemTime(afterBurn);

    // kilo should be exhausted
    try {
      await client.chat({ model: "kilo/kilo-auto/free", messages: [{ role: "user", content: "hi" }] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(QuotaExhaustedError);
      expect((e as QuotaExhaustedError).providerId).toBe("kilo");
    }

    // zai should still work (no window yet)
    const result = await client.chat({ model: "zai/glm-5", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("test response");

    vi.useRealTimers();
  });
});
