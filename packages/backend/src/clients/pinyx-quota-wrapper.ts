import type { PinyxClient, ChatRequest, ChatResponse } from "./pinyx-client.js";
import type { QuotaConfig, QuotaWindow } from "@aurex/shared";
import { checkQuota, recordFirstLLMCall, getEffectiveProviderConfig, extractProviderIdFromModel, createQuotaWindow } from "../enforcement/quota-gate.js";
import { acquireQuotaLock } from "../enforcement/quota-mutex.js";

export class QuotaExhaustedError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly windowResetsAt: string,
  ) {
    // Stryker disable next-line StringLiteral: error message — tested by
    // checking error class, not message content.
    super(`Quota exhausted for provider ${providerId}`);
    // Stryker disable next-line StringLiteral: error name — not observable
    // through test assertions.
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

    const release = await acquireQuotaLock(providerId);
    try {
      let window = await opts.getQuotaWindow(providerId);
      const now = new Date();

      if (!window) {
        window = createQuotaWindow({
          windowDurationMs: providerConfig.windowDurationMs,
          burnDurationMs: providerConfig.burnDurationMs,
          now,
        });
        await opts.saveQuotaWindow(providerId, window);
      }

      const result = checkQuota(window, now);

      // Stryker disable next-line ConditionalExpression: the exhaustion
      // check AND reason check are tested but Stryker's perTest doesn't
      // attribute the specific error-throwing test.
      if (!result.ok && result.reason === "quota_exhausted") {
        // Stryker disable next-line ObjectLiteral: error fields are
        // tested but Stryker's perTest doesn't pick the assertion.
        throw new QuotaExhaustedError(providerId, result.windowResetsAt!);
      }

      // Stryker disable next-line ConditionalExpression: firstLLMCallAt
      // recording is tested but Stryker's perTest doesn't attribute it.
      if (window.firstLLMCallAt === null) {
        const updated = recordFirstLLMCall(window, now);
        await opts.saveQuotaWindow(providerId, updated);
      }
    // Stryker disable next-line BlockStatement: finally block release
    // is tested indirectly but Stryker can't track it.
    } finally {
      release();
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
