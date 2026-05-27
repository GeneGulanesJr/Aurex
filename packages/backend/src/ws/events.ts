// packages/backend/src/ws/events.ts
import type { FastifyInstance } from "fastify";
import type { WsClientEvent } from "@aurex/shared";

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
  const history: SequencedEvent[] = [];
  let seqCounter = 0;

  return {
    emit(event) {
      seqCounter++;
      const sequenced: SequencedEvent = { seq: seqCounter, event };
      history.push(sequenced);
      if (history.length > MAX_EVENT_HISTORY) {
        history.splice(0, history.length - MAX_EVENT_HISTORY);
      }
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
      if (sinceSeq <= 0) return history;
      const startIdx = history.findIndex((e) => e.seq > sinceSeq);
      if (startIdx === -1) return [];
      return history.slice(startIdx);
    },
    getCurrentSeq() {
      return seqCounter;
    },
  };
}

export function registerWebSocketRoutes(app: FastifyInstance, eventBus: EventBus, apiKey: string | null = null): void {
  app.get("/ws", { websocket: true }, (socket) => {
    let authenticated = !apiKey;
    const pendingAuthTimeout = apiKey
      ? setTimeout(() => {
          if (!authenticated && socket.readyState === socket.OPEN) {
            socket.close(4001, "Auth timeout");
          }
        }, 5000)
      : null;

    let unsubscribe: (() => void) | null = null;

    const messageHandler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!authenticated) {
          if (msg.type === "auth" && msg.token === apiKey) {
            authenticated = true;
            if (pendingAuthTimeout) clearTimeout(pendingAuthTimeout);
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "auth_ok" }));
            }
            wireUp();
          } else {
            if (socket.readyState === socket.OPEN) {
              socket.close(4003, "Invalid auth");
            }
          }
          return;
        }

        if (msg.type === "replay" && typeof msg.lastSeq === "number") {
          const missed = eventBus.getEventsSince(msg.lastSeq);
          for (const { seq, event } of missed) {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ seq, event, replayed: true }));
            }
          }
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "replay_done", count: missed.length }));
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    function wireUp() {
      // Defer to next tick so client message handlers are registered first
      setImmediate(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "hello", seq: eventBus.getCurrentSeq() }));
        }
      });

      unsubscribe = eventBus.subscribe((event) => {
        if (socket.readyState === socket.OPEN) {
          const seq = eventBus.getCurrentSeq();
          socket.send(JSON.stringify({ seq, event }));
        }
      });
    }

    socket.on("message", messageHandler);

    if (authenticated) {
      wireUp();
    }

    socket.on("close", () => {
      if (unsubscribe) unsubscribe();
      if (pendingAuthTimeout) clearTimeout(pendingAuthTimeout);
    });
    socket.on("error", () => {
      if (unsubscribe) unsubscribe();
      if (pendingAuthTimeout) clearTimeout(pendingAuthTimeout);
    });
  });
}
