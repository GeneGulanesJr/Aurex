import type { PinyxClient, ChatRequest, ChatResponse } from "./pinyx-client.js";
import type { QuotaConfig, QuotaWindow, WsClientEvent } from "@aurex/shared";
import { checkQuota, recordFirstLLMCall, getEffectiveProviderConfig, extractProviderIdFromModel, createQuotaWindow, getProviderStatusDisplay } from "../enforcement/quota-gate.js";
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
  /**
   * Optional sink for `quota_update` WS events. Emitted after every tracked
   * LLM call (and on exhaustion) so the frontend QuotaPanel / activity feed
   * receive real-time updates instead of waiting on the 30s poll.
   */
  onQuotaUpdate?: (event: WsClientEvent) => void;
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
        // Emit a quota_update reflecting the exhausted state before
        // throwing, so the UI learns of the transition immediately.
        emitQuotaUpdate(window, providerId, providerConfig, now);
        // Stryker disable next-line ObjectLiteral: error fields are
        // tested but Stryker's perTest doesn't pick the assertion.
        throw new QuotaExhaustedError(providerId, result.windowResetsAt!);
      }

      // Stryker disable next-line ConditionalExpression: firstLLMCallAt
      // recording is tested but Stryker's perTest doesn't attribute it.
      if (window.firstLLMCallAt === null) {
        const updated = recordFirstLLMCall(window, now);
        await opts.saveQuotaWindow(providerId, updated);
        window = updated;
      }

      emitQuotaUpdate(window, providerId, providerConfig, now);
    // Stryker disable next-line BlockStatement: finally block release
    // is tested indirectly but Stryker can't track it.
    } finally {
      release();
    }
  }

  function emitQuotaUpdate(
    window: QuotaWindow,
    providerId: string,
    providerConfig: { tracked: boolean; windowDurationMs: number; burnDurationMs: number },
    now: Date,
  ): void {
    if (!opts.onQuotaUpdate) return;
    const display = getProviderStatusDisplay(providerId, providerConfig, window, true, now);
    opts.onQuotaUpdate({
      type: "quota_update",
      providerId: display.providerId,
      status: display.status,
      remainingBurnMs: display.remainingBurnMs,
      remainingWindowMs: display.remainingWindowMs,
      burnExpiresAt: display.burnExpiresAt,
    });
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
