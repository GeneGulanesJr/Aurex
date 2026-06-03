import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { AppConfig } from "../config.js";
import type { QuotaWindow, QuotaStatusResponse, PrefireRequest, PrefireResponse, CalculatePrefireRequest, CalculatePrefireResponse } from "@aurex/shared";
import {
  prefire as prefireWindow,
  checkQuota,
  getQuotaStatusDisplay,
  calculatePrefireTime,
  buildPrefireTimeline,
  resetWindow,
} from "../enforcement/quota-gate.js";

const QUOTA_SETTINGS_KEY = "quota_window";

export async function quotaRoutes(
  app: FastifyInstance,
  { lapis, config }: { lapis: LaPisClient; config: AppConfig },
) {
  async function loadQuotaWindow(): Promise<QuotaWindow | null> {
    return lapis.getSetting<QuotaWindow>(QUOTA_SETTINGS_KEY);
  }

  async function saveQuotaWindow(window: QuotaWindow): Promise<void> {
    await lapis.setSetting(QUOTA_SETTINGS_KEY, window);
  }

  app.get("/api/quota", async () => {
    const window = await loadQuotaWindow();
    const now = new Date();

    if (config.quotaEnabled && window) {
      const result = checkQuota(window, now);
      if (result.reason === "window_expired") {
        const reset = resetWindow(window, now);
        await saveQuotaWindow(reset);
        return getQuotaStatusDisplay(reset, now, config.quotaEnabled);
      }
    }

    return getQuotaStatusDisplay(window, now, config.quotaEnabled);
  });

  app.post("/api/quota/prefire", async (request, reply) => {
    const body = (request.body ?? {}) as PrefireRequest;
    const now = new Date();
    const current = await loadQuotaWindow();

    const window = prefireWindow(current, now, {
      windowDurationMs: body.windowDurationMs ?? config.quotaWindowDurationMs,
      burnDurationMs: body.burnDurationMs ?? config.quotaBurnDurationMs,
    });

    await saveQuotaWindow(window);

    const windowEnd = new Date(new Date(window.windowStart).getTime() + window.windowDurationMs);
    const response: PrefireResponse = {
      windowStart: window.windowStart,
      windowEnd: windowEnd.toISOString(),
      burnDurationMs: window.burnDurationMs,
      prefireAdvice: `Window active from ${new Date(window.windowStart).toLocaleTimeString()} to ${windowEnd.toLocaleTimeString()}. First LLM call starts your ${Math.round(window.burnDurationMs / 60000)}-minute burn timer.`,
    };

    return reply.status(201).send(response);
  });

  app.post("/api/quota/reset", async () => {
    const current = await loadQuotaWindow();
    const now = new Date();
    const window = resetWindow(current ?? {
      windowStart: now.toISOString(),
      windowDurationMs: config.quotaWindowDurationMs,
      burnDurationMs: config.quotaBurnDurationMs,
      firstLLMCallAt: null,
      isActive: false,
      lastActiveAt: null,
    }, now);

    await saveQuotaWindow(window);
    return getQuotaStatusDisplay(window, now, config.quotaEnabled);
  });

  app.post("/api/quota/calculate-prefire", async (request) => {
    const body = request.body as CalculatePrefireRequest;
    const desiredStart = new Date(body.desiredStartTime);
    const burnDurationMs = body.burnDurationMs ?? config.quotaBurnDurationMs;
    const windowDurationMs = body.windowDurationMs ?? config.quotaWindowDurationMs;

    const prefireTime = calculatePrefireTime(desiredStart, burnDurationMs, windowDurationMs);
    const timeline = buildPrefireTimeline(prefireTime, desiredStart, burnDurationMs, windowDurationMs);

    const response: CalculatePrefireResponse = {
      prefireTime: prefireTime.toISOString(),
      desiredStartTime: desiredStart.toISOString(),
      burnDurationMs,
      windowDurationMs,
      timeline,
    };

    return response;
  });
}
