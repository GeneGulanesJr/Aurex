// packages/backend/src/ws/events.ts
import type { FastifyInstance } from "fastify";
import type { WsClientEvent, WsClientMessage } from "@aurex/shared";

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

export interface WsRouteDeps {
  onSubscribeMission?: (socket: any, missionId: string) => void;
  onCheckpointDecision?: (msg: WsClientMessage) => void;
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

export function registerWebSocketRoutes(
  app: FastifyInstance,
  eventBus: EventBus,
  apiKey: string | null = null,
  deps?: WsRouteDeps,
): void {
  app.get("/ws", { websocket: true }, (socket) => {
    let authenticated = !apiKey;
    const subscribedMissions = new Set<string>();
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
          deps?.onSubscribeMission?.(socket, msg.missionId);
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "subscribed", missionId: msg.missionId }));
          }
          return;
        }

        if (msg.event === "checkpoint_decision") {
          deps?.onCheckpointDecision?.(msg as WsClientMessage);
          return;
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
