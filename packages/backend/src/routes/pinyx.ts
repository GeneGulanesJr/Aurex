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
  endpoint: string;
  modelHints: MissionConfig["modelHints"];
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

export async function resolvePinyxConfig(
  lapis: LaPisClient,
  defaults: { endpoint: string; modelHints: MissionConfig["modelHints"] },
): Promise<PinyxConfigSetting> {
  const saved = await lapis.getSetting<Partial<PinyxConfigSetting>>("pinyx_config");
  return {
    endpoint: saved?.endpoint || defaults.endpoint,
    modelHints: { ...defaults.modelHints, ...(saved?.modelHints ?? {}) },
    providers: saved?.providers ?? [],
  };
}

export function registerPinyxRoutes(app: FastifyInstance, deps: PinyxRouteDeps) {
  const defaults = { endpoint: deps.endpoint, modelHints: deps.modelHints };

  app.get("/api/pinyx/config", async () => {
    const config = await resolvePinyxConfig(deps.lapis, defaults);
    return publicPinyxConfig(config);
  });

  app.post("/api/pinyx/config", async (request, reply) => {
    const body = request.body as Partial<PinyxConfigSetting>;
    if (!body.endpoint) {
      return reply.status(400).send({ error: "endpoint is required" });
    }
    const existing = await resolvePinyxConfig(deps.lapis, defaults);
    const existingById = new Map(existing.providers.map((provider) => [provider.id, provider]));
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
      modelHints: { ...defaults.modelHints, ...(body.modelHints ?? {}) },
      providers,
    };
    await deps.lapis.setSetting("pinyx_config", config);
    return publicPinyxConfig(config);
  });

  app.get("/api/pinyx/models", async (_request, reply) => {
    const config = await resolvePinyxConfig(deps.lapis, defaults);
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
