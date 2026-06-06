import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { QuotaWindow, QuotaConfig, QuotaProviderStatus, PrefireRequest, PrefireResponse, CalculatePrefireRequest, CalculatePrefireResponse, QuotaConfigUpdateRequest } from "@aurex/shared";
import {
  prefire as prefireWindow,
  getEffectiveProviderConfig,
  getProviderStatusDisplay,
  calculatePrefireTime,
  buildPrefireTimeline,
  resetWindow,
  createQuotaWindow,
  validateQuotaDurations,
} from "../enforcement/quota-gate.js";
import { acquireQuotaLock } from "../enforcement/quota-mutex.js";
import type { AppConfig } from "../config.js";

const QUOTA_CONFIG_KEY = "quota_config";
const QUOTA_WINDOWS_KEY = "quota_windows";

export async function quotaRoutes(
  app: FastifyInstance,
  { lapis, config }: { lapis: LaPisClient; config: AppConfig },
) {

  async function loadQuotaConfig(): Promise<QuotaConfig> {
    const saved = await lapis.getSetting<QuotaConfig>(QUOTA_CONFIG_KEY);
    if (saved) return saved;
    return {
      enabled: config.quotaEnabled,
      windowDurationMs: config.quotaWindowDurationMs,
      burnDurationMs: config.quotaBurnDurationMs,
      providers: [],
    };
  }

  async function saveQuotaConfig(qc: QuotaConfig): Promise<void> {
    await lapis.setSetting(QUOTA_CONFIG_KEY, qc);
  }

  async function loadAllWindows(): Promise<Record<string, QuotaWindow>> {
    return (await lapis.getSetting<Record<string, QuotaWindow>>(QUOTA_WINDOWS_KEY)) ?? {};
  }

  async function saveAllWindows(windows: Record<string, QuotaWindow>): Promise<void> {
    await lapis.setSetting(QUOTA_WINDOWS_KEY, windows);
  }

  async function withProviderLock<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    const release = await acquireQuotaLock(providerId);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async function loadProviderWindow(providerId: string): Promise<QuotaWindow | null> {
    const all = await loadAllWindows();
    return all[providerId] ?? null;
  }

  async function saveProviderWindow(providerId: string, w: QuotaWindow): Promise<void> {
    const all = await loadAllWindows();
    all[providerId] = w;
    await saveAllWindows(all);
  }

  async function atomicUpdateProviderWindow(providerId: string, updater: (current: QuotaWindow | null) => Promise<QuotaWindow>): Promise<QuotaWindow> {
    return withProviderLock(providerId, async () => {
      const current = await loadProviderWindow(providerId);
      const updated = await updater(current);
      await saveProviderWindow(providerId, updated);
      return updated;
    });
  }

  app.get("/api/quota", async () => {
    const qc = await loadQuotaConfig();
    const now = new Date();

    const knownProviderIds = new Set(qc.providers.map((p) => p.providerId));
    const allWindows = await loadAllWindows();
    for (const pid of Object.keys(allWindows)) {
      knownProviderIds.add(pid);
    }

    const providerStatuses: QuotaProviderStatus[] = [];
    for (const providerId of knownProviderIds) {
      const providerConfig = getEffectiveProviderConfig(qc, providerId);
      const window = allWindows[providerId] ?? null;

      providerStatuses.push(
        getProviderStatusDisplay(providerId, providerConfig, window, qc.enabled, now),
      );
    }

    if (providerStatuses.length === 0) {
      providerStatuses.push(
        getProviderStatusDisplay("default", { tracked: true, windowDurationMs: qc.windowDurationMs, burnDurationMs: qc.burnDurationMs }, null, qc.enabled, now),
      );
    }

    return { enabled: qc.enabled, providers: providerStatuses };
  });

  app.post("/api/quota/config", async (request, reply) => {
    const body = (request.body ?? {}) as QuotaConfigUpdateRequest;

    if (body.windowDurationMs !== undefined && !validateQuotaDurations(body.windowDurationMs, body.burnDurationMs ?? (await loadQuotaConfig()).burnDurationMs)) {
      return reply.status(400).send({ error: "windowDurationMs and burnDurationMs must be positive and burn <= window" });
    }
    if (body.burnDurationMs !== undefined && !validateQuotaDurations(body.windowDurationMs ?? (await loadQuotaConfig()).windowDurationMs, body.burnDurationMs)) {
      return reply.status(400).send({ error: "windowDurationMs and burnDurationMs must be positive and burn <= window" });
    }
    if (body.providers !== undefined) {
      for (const p of body.providers) {
        if (!p.providerId || typeof p.providerId !== "string") {
          return reply.status(400).send({ error: "Each provider must have a non-empty providerId" });
        }
        if (p.windowDurationMs !== undefined && p.windowDurationMs <= 0) {
          return reply.status(400).send({ error: `Provider ${p.providerId} windowDurationMs must be positive` });
        }
        if (p.burnDurationMs !== undefined && p.burnDurationMs <= 0) {
          return reply.status(400).send({ error: `Provider ${p.providerId} burnDurationMs must be positive` });
        }
      }
    }

    const qc = await loadQuotaConfig();

    if (body.enabled !== undefined) qc.enabled = body.enabled;
    if (body.windowDurationMs !== undefined) qc.windowDurationMs = body.windowDurationMs;
    if (body.burnDurationMs !== undefined) qc.burnDurationMs = body.burnDurationMs;
    if (body.providers !== undefined) {
      qc.providers = body.providers.map((p) => ({
        providerId: p.providerId,
        tracked: p.tracked,
        windowDurationMs: p.windowDurationMs,
        burnDurationMs: p.burnDurationMs,
      }));
    }

    await saveQuotaConfig(qc);
    return reply.status(200).send({ ok: true });
  });

  app.post("/api/quota/prefire", async (request, reply) => {
    const body = (request.body ?? {}) as PrefireRequest & { providerId?: string };
    const qc = await loadQuotaConfig();
    const providerId = body.providerId ?? "default";
    const providerConfig = getEffectiveProviderConfig(qc, providerId);
    const windowDurationMs = body.windowDurationMs ?? providerConfig.windowDurationMs;
    const burnDurationMs = body.burnDurationMs ?? providerConfig.burnDurationMs;

    if (!validateQuotaDurations(windowDurationMs, burnDurationMs)) {
      return reply.status(400).send({ error: "windowDurationMs and burnDurationMs must be positive and burn <= window" });
    }

    const now = new Date();
    const window = await atomicUpdateProviderWindow(providerId, async (current) => {
      return prefireWindow(current, now, { windowDurationMs, burnDurationMs });
    });

    const windowEnd = new Date(new Date(window.windowStart).getTime() + window.windowDurationMs);
    const response: PrefireResponse = {
      windowStart: window.windowStart,
      windowEnd: windowEnd.toISOString(),
      burnDurationMs: window.burnDurationMs,
      prefireAdvice: `Window active from ${new Date(window.windowStart).toLocaleTimeString()} to ${windowEnd.toLocaleTimeString()}. First LLM call starts your ${Math.round(window.burnDurationMs / 60000)}-minute burn timer.`,
    };

    return reply.status(201).send(response);
  });

  app.post("/api/quota/reset", async (request) => {
    const body = (request.body ?? {}) as { providerId?: string };
    const qc = await loadQuotaConfig();
    const providerId = body.providerId ?? "default";
    const providerConfig = getEffectiveProviderConfig(qc, providerId);
    const now = new Date();

    const window = await atomicUpdateProviderWindow(providerId, async (current) => {
      return resetWindow(current ?? createQuotaWindow({
        windowDurationMs: providerConfig.windowDurationMs,
        burnDurationMs: providerConfig.burnDurationMs,
        now,
      }), now);
    });

    return getProviderStatusDisplay(providerId, providerConfig, window, qc.enabled, now);
  });

  app.post("/api/quota/calculate-prefire", async (request, reply) => {
    const body = request.body as CalculatePrefireRequest;
    const desiredStart = new Date(body.desiredStartTime);
    if (isNaN(desiredStart.getTime())) {
      return reply.status(400).send({ error: "Invalid desiredStartTime" });
    }
    const qc = await loadQuotaConfig();
    const burnDurationMs = body.burnDurationMs ?? qc.burnDurationMs;
    const windowDurationMs = body.windowDurationMs ?? qc.windowDurationMs;

    if (!validateQuotaDurations(windowDurationMs, burnDurationMs)) {
      return reply.status(400).send({ error: "windowDurationMs and burnDurationMs must be positive and burn <= window" });
    }

    const prefireTime = calculatePrefireTime(desiredStart, burnDurationMs, windowDurationMs, new Date());
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
