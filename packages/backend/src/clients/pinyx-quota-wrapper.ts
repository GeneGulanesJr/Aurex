import type { PinyxClient, ChatRequest, ChatResponse } from "./pinyx-client.js";
import type { QuotaConfig, QuotaWindow } from "@aurex/shared";
import { checkQuota, recordFirstLLMCall, getEffectiveProviderConfig, extractProviderIdFromModel } from "../enforcement/quota-gate.js";

export class QuotaExhaustedError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly windowResetsAt: string,
  ) {
    super(`Quota exhausted for provider ${providerId}`);
    this.name = "QuotaExhaustedError";
  }
}

export interface QuotaAwarePinyxOpts {
  getQuotaConfig: () => Promise<QuotaConfig>;
  getQuotaWindow: (providerId: string) => Promise<QuotaWindow | null>;
  saveQuotaWindow: (providerId: string, w: QuotaWindow) => Promise<void>;
}

export function createQuotaAwarePinyxClient(inner: PinyxClient, opts: QuotaAwarePinyxOpts): PinyxClient {
  async function enforceAndTrack(model: string): Promise<void> {
    const providerId = extractProviderIdFromModel(model);
    const config = await opts.getQuotaConfig();

    if (!config.enabled) return;

    const providerConfig = getEffectiveProviderConfig(config, providerId);
    if (!providerConfig.tracked) return;

    const window = await opts.getQuotaWindow(providerId);
    const now = new Date();
    const result = checkQuota(window, now);

    if (!result.ok && result.reason === "quota_exhausted") {
      throw new QuotaExhaustedError(providerId, result.windowResetsAt ?? new Date().toISOString());
    }

    if (window && window.firstLLMCallAt === null) {
      const updated = recordFirstLLMCall(window, now);
      await opts.saveQuotaWindow(providerId, updated);
    }
  }

  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      await enforceAndTrack(req.model);
      return inner.chat(req);
    },

    async chatStream(req: ChatRequest, onChunk: (text: string) => void): Promise<ChatResponse> {
      await enforceAndTrack(req.model);
      return inner.chatStream(req, onChunk);
    },

    async ping(): Promise<void> {
      return inner.ping();
    },
  };
}
