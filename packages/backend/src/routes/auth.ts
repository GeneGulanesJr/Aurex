// packages/backend/src/routes/auth.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export function createAuthHook(apiKey: string | null) {
  if (!apiKey) {
    return async (_request: FastifyRequest, _reply: FastifyReply) => {};
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === "/health" || request.url.startsWith("/ws")) return;
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing or invalid Authorization header" });
    }
    const token = header.slice(7);
    if (token !== apiKey) {
      return reply.status(403).send({ error: "Invalid API key" });
    }
  };
}

export function registerGlobalAuth(app: FastifyInstance, apiKey: string | null): void {
  const authHook = createAuthHook(apiKey);
  app.addHook("onRequest", authHook);
}
