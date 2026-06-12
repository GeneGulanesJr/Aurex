import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AgentSessionMessageRequest,
  PrepareAgentSessionRequest,
} from "@aurex/shared";
import type { PreparedSessionService } from "../sessions/prepared-session-service.js";
import { SessionConflictError } from "../sessions/prepared-session-service.js";

export interface AgentSessionRouteDeps {
  service: PreparedSessionService;
}

export async function agentSessionRoutes(
  app: FastifyInstance,
  deps: AgentSessionRouteDeps,
) {
  const { service } = deps;

  app.post(
    "/api/agent-sessions/prepare",
    async (
      req: FastifyRequest<{ Body: PrepareAgentSessionRequest }>,
      reply: FastifyReply,
    ) => {
      const body = req.body;
      if (
        !body?.missionId ||
        !body.role ||
        !body.config?.model ||
        !body.config?.prompt
      ) {
        return reply.code(400).send({
          error:
            "missionId, role, config.model, and config.prompt are required",
        });
      }
      const session = await service.prepare(body);
      return reply
        .code(201)
        .send({ sessionId: session.id, status: session.status, session });
    },
  );

  app.post(
    "/api/agent-sessions/:sessionId/start",
    async (
      req: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.start(req.params.sessionId);
        return reply.code(202).send(result);
      } catch (err) {
        if (err instanceof SessionConflictError) {
          return reply.code(409).send({ error: err.message });
        }
        return reply.code(404).send({
          error: err instanceof Error ? err.message : "session not found",
        });
      }
    },
  );

  app.get(
    "/api/agent-sessions/:sessionId",
    async (
      req: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const session = await service.get(req.params.sessionId);
      if (!session) return reply.code(404).send({ error: "session not found" });
      return { session };
    },
  );

  app.post(
    "/api/agent-sessions/:sessionId/messages",
    async (
      req: FastifyRequest<{
        Params: { sessionId: string };
        Body: AgentSessionMessageRequest;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.acceptMessage(
          req.params.sessionId,
          req.body?.message ?? "",
        );
        return reply.code(result.accepted ? 202 : 409).send(result);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "message rejected",
        });
      }
    },
  );

  app.post(
    "/api/agent-sessions/:sessionId/cancel",
    async (
      req: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const session = await service.cancel(req.params.sessionId);
        return { session };
      } catch (err) {
        if (err instanceof SessionConflictError) {
          return reply.code(409).send({ error: err.message });
        }
        return reply.code(404).send({
          error: err instanceof Error ? err.message : "session not found",
        });
      }
    },
  );
}
