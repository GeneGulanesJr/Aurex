import type { Auth0User } from "../routes/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: Auth0User;
  }
}

export {};
