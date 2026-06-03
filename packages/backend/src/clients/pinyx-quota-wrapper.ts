import type { PinyxClient, ChatRequest, ChatResponse } from "./pinyx-client.js";
import type { QuotaWindow } from "@aurex/shared";
import { checkQuota, recordFirstLLMCall } from "../enforcement/quota-gate.js";

export class QuotaExhaustedError extends Error {
  constructor(public readonly windowResetsAt: string) {
    super("Quota exhausted");
    this.name = "QuotaExhaustedError";
  }
}

export interface QuotaAwarePinyxOpts {
  getQuotaWindow: () => Promise<QuotaWindow | null>;
  saveQuotaWindow: (w: QuotaWindow) => Promise<void>;
  enabled: boolean;
}

export function createQuotaAwarePinyxClient(inner: PinyxClient, opts: QuotaAwarePinyxOpts): PinyxClient {
  if (!opts.enabled) return inner;

  async function enforceAndTrack(): Promise<void> {
    const window = await opts.getQuotaWindow();
    const now = new Date();
    const result = checkQuota(window, now);

    if (!result.ok && result.reason === "quota_exhausted") {
      throw new QuotaExhaustedError(result.windowResetsAt ?? new Date().toISOString());
    }

    if (window && window.firstLLMCallAt === null) {
      const updated = recordFirstLLMCall(window, now);
      await opts.saveQuotaWindow(updated);
    }
  }

  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      await enforceAndTrack();
      return inner.chat(req);
    },

    async chatStream(req: ChatRequest, onChunk: (text: string) => void): Promise<ChatResponse> {
      await enforceAndTrack();
      return inner.chatStream(req, onChunk);
    },

    async ping(): Promise<void> {
      return inner.ping();
    },
  };
}
