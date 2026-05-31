// packages/backend/src/routes/pinyx.ts
import type { FastifyInstance } from "fastify";
import type { AgentType, MissionConfig } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

export interface PinyxProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface PinyxConfigSetting {
  endpoint: string;
  modelHints: Record<AgentType, string>;
  providers: PinyxProviderConfig[];
}

export interface PublicPinyxProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface PublicPinyxConfig {
  endpoint: string;
  modelHints: Record<AgentType, string>;
  providers: PublicPinyxProviderConfig[];
}

interface PinyxRouteDeps {
  lapis: LaPisClient;
}

function publicProvider(provider: PinyxProviderConfig): PublicPinyxProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: Boolean(provider.apiKey),
  };
}

export function publicPinyxConfig(config: PinyxConfigSetting): PublicPinyxConfig {
  return {
    endpoint: config.endpoint,
    modelHints: config.modelHints,
    providers: config.providers.map(publicProvider),
  };
}

const defaultModelHints: Record<AgentType, string> = {
  orchestrator: "kilo/kilo-auto/free",
  worker: "kilo/kilo-auto/free",
  validator_scrutiny: "kilo/kilo-auto/free",
  validator_user_testing: "kilo/kilo-auto/free",
  research: "kilo/kilo-auto/free",
};

const DEFAULT_PINYX_ENDPOINTS = [
  "http://pinyx-stub:7331",   // Docker internal hostname
  "http://pinyx:7331",        // Alternative Docker hostname
  "http://localhost:7331",    // Local dev
];

async function detectPinyxEndpoint(): Promise<string> {
  for (const url of DEFAULT_PINYX_ENDPOINTS) {
    try {
      const res = await fetch(`${url}/health`, { method: "GET", signal: AbortSignal.timeout(2000) });
      if (res.ok) return url;
    } catch { /* try next */ }
  }
  return ""; // Not found — user will need to configure manually
}

export async function resolvePinyxConfig(lapis: LaPisClient): Promise<PinyxConfigSetting | null> {
  const saved = await lapis.getSetting<PinyxConfigSetting>("pinyx_config");
  if (!saved?.endpoint) return null;
  return {
    endpoint: saved.endpoint,
    modelHints: { ...defaultModelHints, ...(saved.modelHints ?? {}) },
    providers: saved.providers ?? [],
  };
}

export function registerPinyxRoutes(app: FastifyInstance, deps: PinyxRouteDeps) {
  const { lapis } = deps;

  app.get("/api/pinyx/status", async () => {
    const config = await resolvePinyxConfig(lapis);
    return { configured: Boolean(config), endpoint: config?.endpoint ?? null };
  });

  app.get("/api/pinyx/config", async () => {
    const config = await resolvePinyxConfig(lapis);
    if (!config) {
      // Auto-detect PiNyx endpoint for first-time setup
      const detected = await detectPinyxEndpoint();
      return {
        endpoint: detected,
        modelHints: defaultModelHints,
        providers: [],
        autoDetected: detected !== "",
      };
    }
    return publicPinyxConfig(config);
  });

  app.post("/api/pinyx/config", async (request, reply) => {
    const body = request.body as Partial<PinyxConfigSetting>;
    if (!body.endpoint) {
      return reply.status(400).send({ error: "endpoint is required" });
    }

    // Validate endpoint is reachable
    const endpoint = body.endpoint.replace(/\/$/, "");
    try {
      const res = await fetch(`${endpoint}/v1/models`, { method: "GET" });
      if (!res.ok) {
        return reply.status(502).send({ error: `PiNyx endpoint returned ${res.status}` });
      }
    } catch {
      return reply.status(502).send({ error: "Cannot reach PiNyx endpoint" });
    }

    const existing = await resolvePinyxConfig(lapis);
    const existingById = new Map((existing?.providers ?? []).map((p) => [p.id, p]));
    const providers = (body.providers ?? []).map((provider) => {
      const existingProvider = existingById.get(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey || existingProvider?.apiKey,
      };
    });
    const config: PinyxConfigSetting = {
      endpoint: body.endpoint,
      modelHints: { ...defaultModelHints, ...(body.modelHints ?? {}) },
      providers,
    };
    await lapis.setSetting("pinyx_config", config);
    return publicPinyxConfig(config);
  });

  app.get("/api/pinyx/models", async (_request, reply) => {
    const config = await resolvePinyxConfig(lapis);
    if (!config) {
      return reply.status(400).send({ error: "PiNyx is not configured" });
    }
    const endpoint = config.endpoint.replace(/\/$/, "");
    try {
      const res = await fetch(`${endpoint}/v1/models`, { method: "GET" });
      if (!res.ok) return reply.status(502).send({ error: `PiNyx returned ${res.status}` });
      const body = await res.json() as { data?: unknown[] };
      return { models: body.data ?? [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      return reply.status(502).send({ error: `Failed to fetch PiNyx models: ${message}` });
    }
  });
}
