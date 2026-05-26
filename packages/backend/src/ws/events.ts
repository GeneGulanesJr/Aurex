// packages/backend/src/ws/events.ts
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
