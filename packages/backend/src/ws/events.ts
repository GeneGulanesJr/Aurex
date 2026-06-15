import type { FastifyInstance } from "fastify";
import type { CheckpointDecision, WsClientEvent } from "@aurex/shared";
import { verifyJwt } from "../routes/auth.js";

export type EventHandler = (event: WsClientEvent) => void;

export interface SequencedEvent {
  seq: number;
  event: WsClientEvent;
}

export interface EventBus {
  emit(event: WsClientEvent): void;
  subscribe(handler: EventHandler): () => void;
  getEventsSince(seq: number): SequencedEvent[];
  getCurrentSeq(): number;
}

const MAX_EVENT_HISTORY = 10_000;

export function createEventBus(): EventBus {
  const subscribers = new Set<EventHandler>();
  const ring = new Array<SequencedEvent>(MAX_EVENT_HISTORY);
  let writeIdx = 0;
  let size = 0;
  let seqCounter = 0;

  function ringReadIdx(logicalIdx: number): number {
    if (size < MAX_EVENT_HISTORY) return logicalIdx;
    return (writeIdx + logicalIdx) % MAX_EVENT_HISTORY;
  }

  function ringSlice(startLogical: number, endLogical: number): SequencedEvent[] {
    const result: SequencedEvent[] = [];
    for (let i = startLogical; i < endLogical; i++) {
      result.push(ring[ringReadIdx(i)]);
    }
    return result;
  }

  return {
    emit(event) {
      seqCounter++;
      const sequenced: SequencedEvent = { seq: seqCounter, event };
      ring[writeIdx] = sequenced;
      writeIdx = (writeIdx + 1) % MAX_EVENT_HISTORY;
      if (size < MAX_EVENT_HISTORY) size++;
      for (const handler of subscribers) {
        handler(event);
      }
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    getEventsSince(sinceSeq) {
      if (size === 0) return [];
      const oldestSeq = seqCounter - size + 1;
      if (sinceSeq < oldestSeq) return ringSlice(0, size);
      const targetLogical = sinceSeq - oldestSeq + 1;
      if (targetLogical >= size) return [];
      return ringSlice(targetLogical, size);
    },
    getCurrentSeq() {
      return seqCounter;
    },
  };
}

export interface WsAuthConfig {
  auth0Domain: string;
  auth0Audience: string;
  authDisabled?: boolean;
}

/**
 * Resolver invoked when a client sends a `checkpoint_decision` message over
 * the socket. Mirrors the REST `POST /api/missions/:id/checkpoints` flow
 * (including dedup) so both transports behave identically.
 */
export type WsCheckpointResolver = (input: {
  missionId: string;
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
  rescopeGuidance?: string;
}) => Promise<{ ok: true; duplicate: boolean } | { ok: false; status: number; error: string }>;

export interface RegisterWebSocketRoutesOptions extends WsAuthConfig {
  /**
   * When provided, the socket handles `checkpoint_decision` messages and sends
   * a `checkpoint_resolved` ack back to the client. When omitted, such messages
   * are ignored (the REST path remains the source of truth).
   */
  resolveCheckpoint?: WsCheckpointResolver;
}

export function registerWebSocketRoutes(
  app: FastifyInstance,
  eventBus: EventBus,
  options: RegisterWebSocketRoutesOptions,
): void {
  const authConfig: WsAuthConfig = {
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    authDisabled: options.authDisabled,
  };
  const { resolveCheckpoint } = options;
  app.get("/ws", { websocket: true }, (socket) => {
    let authenticated = authConfig.authDisabled ? true : false;
    const subscribedMissions = new Set<string>();

    const pendingAuthTimeout = authConfig.authDisabled
      ? undefined
      : setTimeout(() => {
          if (!authenticated && socket.readyState === socket.OPEN) {
            socket.close(4001, "Auth timeout");
          }
        }, 10000);

    let unsubscribe: (() => void) | null = null;

    // When auth is disabled, immediately send auth_ok and wire up
    if (authConfig.authDisabled) {
      setImmediate(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "auth_ok" }));
          wireUp();
        }
      });
    }

    const messageHandler = async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!authenticated) {
          if (msg.type === "auth" && typeof msg.token === "string") {
            try {
              await verifyJwt(msg.token, authConfig.auth0Domain, authConfig.auth0Audience);
              authenticated = true;
              clearTimeout(pendingAuthTimeout);
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify({ type: "auth_ok" }));
              }
              wireUp();
            } catch {
              if (socket.readyState === socket.OPEN) {
                socket.close(4003, "Invalid auth");
              }
            }
          } else {
            if (socket.readyState === socket.OPEN) {
              socket.close(4003, "Invalid auth");
            }
          }
          return;
        }

        if (msg.type === "replay" && typeof msg.lastSeq === "number") {
          const missed = eventBus.getEventsSince(msg.lastSeq);
          const BATCH_SIZE = 100;
          let offset = 0;
          function sendBatch() {
            const end = Math.min(offset + BATCH_SIZE, missed.length);
            for (let i = offset; i < end; i++) {
              if (socket.readyState !== socket.OPEN) return;
              socket.send(JSON.stringify({ seq: missed[i].seq, event: missed[i].event, replayed: true }));
            }
            offset = end;
            if (offset < missed.length) {
              setImmediate(sendBatch);
            } else if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "replay_done", count: missed.length }));
            }
          }
          sendBatch();
          return;
        }

        if (msg.event === "subscribe_mission" && typeof msg.missionId === "string") {
          subscribedMissions.add(msg.missionId);
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "subscribed", missionId: msg.missionId }));
          }
          return;
        }

        if (msg.event === "checkpoint_decision" && resolveCheckpoint) {
          const checkpointId = typeof msg.checkpointId === "string" ? msg.checkpointId : null;
          const missionId = typeof msg.missionId === "string" ? msg.missionId : null;
          const decision = msg.decision === "approve" || msg.decision === "reject" ? msg.decision : null;
          if (!checkpointId || !missionId || !decision) {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({
                type: "checkpoint_resolved",
                checkpointId: checkpointId ?? null,
                accepted: false,
                error: "checkpointId, missionId, and decision are required",
              }));
            }
            return;
          }
          try {
            const result = await resolveCheckpoint({
              missionId,
              checkpointId,
              decision,
              guidance: typeof msg.guidance === "string" ? msg.guidance : undefined,
              reason: typeof msg.reason === "string" ? msg.reason : undefined,
              rescopeGuidance: typeof msg.rescopeGuidance === "string" ? msg.rescopeGuidance : undefined,
            });
            if (socket.readyState === socket.OPEN) {
              if (result.ok) {
                socket.send(JSON.stringify({
                  type: "checkpoint_resolved",
                  checkpointId,
                  accepted: true,
                  duplicate: result.duplicate,
                }));
              } else {
                socket.send(JSON.stringify({
                  type: "checkpoint_resolved",
                  checkpointId,
                  accepted: false,
                  error: result.error,
                  status: result.status,
                }));
              }
            }
          } catch (err) {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({
                type: "checkpoint_resolved",
                checkpointId,
                accepted: false,
                error: err instanceof Error ? err.message : "failed to resolve checkpoint",
              }));
            }
          }
          return;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    function wireUp() {
      setImmediate(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "hello", seq: eventBus.getCurrentSeq() }));
        }
      });

      unsubscribe = eventBus.subscribe((event) => {
        if (socket.readyState === socket.OPEN) {
          const anyEvent = event as any;
          if (subscribedMissions.size > 0 && anyEvent.missionId && !subscribedMissions.has(anyEvent.missionId)) {
            return;
          }
          const seq = eventBus.getCurrentSeq();
          socket.send(JSON.stringify({ seq, event }));
        }
      });
    }

    socket.on("message", messageHandler);

    socket.on("close", () => {
      if (unsubscribe) unsubscribe();
      clearTimeout(pendingAuthTimeout);
    });
    socket.on("error", () => {
      if (unsubscribe) unsubscribe();
      clearTimeout(pendingAuthTimeout);
    });
  });
}
