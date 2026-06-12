import { jwtVerify, createRemoteJWKSet } from "jose";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface Auth0User {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(domain: string) {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  }
  return jwksCache;
}

const SKIP_PATHS = ["/health", "/api/github/callback"];

function shouldSkip(url: string): boolean {
  if (url.startsWith("/ws")) return true;
  const path = url.split("?")[0];
  return SKIP_PATHS.some((p) => path === p);
}

export async function verifyJwt(
  token: string,
  domain: string,
  audience: string,
): Promise<Auth0User> {
  const { payload } = await jwtVerify(token, getJWKS(domain), {
    issuer: `https://${domain}/`,
    audience,
  });
  return {
    sub: payload.sub ?? "",
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

export function createAuthHook(
  auth0Domain: string,
  auth0Audience: string,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (shouldSkip(request.url)) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing Authorization header" });
    }

    const token = header.slice(7);
    try {
      request.user = await verifyJwt(token, auth0Domain, auth0Audience);
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
  };
}

export function registerGlobalAuth(
  app: FastifyInstance,
  auth0Domain: string,
  auth0Audience: string,
): void {
  const authHook = createAuthHook(auth0Domain, auth0Audience);
  app.addHook("onRequest", authHook);
}
