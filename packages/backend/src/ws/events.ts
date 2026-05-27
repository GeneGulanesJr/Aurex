// packages/backend/src/ws/events.ts
import type { FastifyInstance } from "fastify";
import type { WsClientEvent } from "@aurex/shared";

export type EventHandler = (event: WsClientEvent) => void;

export interface EventBus {
  emit(event: WsClientEvent): void;
  subscribe(handler: EventHandler): () => void;
}

export function createEventBus(): EventBus {
  const subscribers = new Set<EventHandler>();

  return {
    emit(event) {
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
  };
}

export function registerWebSocketRoutes(app: FastifyInstance, eventBus: EventBus): void {
  app.get("/ws", { websocket: true }, (socket) => {
    const unsubscribe = eventBus.subscribe((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ event }));
      }
    });

    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
    socket.on("message", () => {
      // Client messages are accepted for forward compatibility; subscription is implicit.
    });
  });
}
