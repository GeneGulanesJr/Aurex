import { useEffect, useRef, useCallback, useState } from "react";
import type { WsClientEvent } from "@aurex/shared";

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MULTIPLIER = 1.5;
const LAST_SEQ_KEY = "aurex:lastSeq";

export function buildWsUrl(host: string, protocol: string): string {
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${host}/ws`;
}

export function parseWsMessage(data: string): { seq?: number; event?: WsClientEvent; type?: string } | null {
  try { return JSON.parse(data); } catch { return null; }
}

export function buildPostAuthMessages(lastSeq: string | null, missionId?: string | null): string[] {
  const messages: string[] = [];
  if (lastSeq && !isNaN(Number(lastSeq))) {
    messages.push(JSON.stringify({ type: "replay", lastSeq: Number(lastSeq) }));
  }
  if (missionId) {
    messages.push(JSON.stringify({ event: "subscribe_mission", missionId }));
  }
  return messages;
}

/** Control messages the backend sends as top-level { type: ... } (not { event: ... }). */
export type WsControlMessage =
  | { type: "auth_ok" }
  | { type: "hello"; seq: number }
  | { type: "subscribed"; missionId: string }
  | { type: "replay_done"; count: number }
  | {
      type: "checkpoint_resolved";
      checkpointId: string;
      accepted: boolean;
      duplicate?: boolean;
      error?: string;
      status?: number;
    };

const CONTROL_TYPES = new Set<string>([
  "auth_ok",
  "hello",
  "subscribed",
  "replay_done",
  "checkpoint_resolved",
]);

export type ClassifiedMessage =
  | { kind: "event"; event: WsClientEvent; seq?: number }
  | { kind: "control"; control: WsControlMessage; seq?: number }
  | { kind: "unknown"; raw: unknown; seq?: number };

/** Pure classifier for a single WS message string. Exported for unit testing. */
export function classifyMessage(data: string): ClassifiedMessage | null {
  const parsed = parseWsMessage(data);
  if (!parsed) return null;
  const seq = parsed.seq;
  if (parsed.event) {
    return { kind: "event", event: parsed.event, seq };
  }
  if (parsed.type && CONTROL_TYPES.has(parsed.type)) {
    return { kind: "control", control: parsed as unknown as WsControlMessage, seq };
  }
  return { kind: "unknown", raw: parsed, seq };
}

export interface UseWebSocketOptions {
  missionId?: string | null;
  getToken?: () => Promise<string>;
  enabled?: boolean;
  /** Receives non-event control messages (auth_ok, checkpoint_resolved, etc.). */
  onControl?: (msg: WsControlMessage) => void;
}

export function useWebSocket(onEvent: (event: WsClientEvent) => void, opts?: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onControlRef = useRef(opts?.onControl);
  onControlRef.current = opts?.onControl;
  const reconnectDelayRef = useRef(RECONNECT_BASE_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const connectFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;
      if (optsRef.current?.enabled === false) return;

      const ws = new WebSocket(buildWsUrl(window.location.host, window.location.protocol));
      ws.onopen = async () => {
        if (!mountedRef.current) { ws.close(); return; }
        reconnectDelayRef.current = RECONNECT_BASE_DELAY;

        if (optsRef.current?.getToken) {
          try {
            const token = await optsRef.current.getToken();
            ws.send(JSON.stringify({ type: "auth", token }));
          } catch {
            ws.close(4003, "Auth failed");
            return;
          }
        }

        if (!optsRef.current?.getToken) {
          sendPostAuthMessages(ws);
          setConnected(true);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      // Micro-batch agent_output events to prevent UI freeze during rapid tool calls
      let batchQueue: WsClientEvent[] = [];
      let batchTimer: ReturnType<typeof setTimeout> | null = null;

      function flushBatch() {
        batchTimer = null;
        if (batchQueue.length === 0) return;
        const events = batchQueue;
        batchQueue = [];
        // Dispatch each event; the reducer handles them individually but
        // batching via setTimeout(0) coalesces multiple rapid dispatches
        // into a single React render cycle.
        for (const evt of events) {
          onEventRef.current(evt);
        }
      }

      function sendPostAuthMessages(socket: WebSocket) {
        // Send replay request from last known sequence only after the server has
        // accepted authentication. Sending this while JWT verification is still
        // pending can race with the backend's pre-auth guard.
        const lastSeq = localStorage.getItem(LAST_SEQ_KEY);
        for (const message of buildPostAuthMessages(lastSeq, optsRef.current?.missionId)) {
          socket.send(message);
        }
      }

      ws.onmessage = (msg) => {
        const classified = classifyMessage(msg.data);
        if (!classified) return;

        // Track sequence for replay (applies to both events and control messages).
        if (typeof classified.seq === "number") {
          localStorage.setItem(LAST_SEQ_KEY, String(classified.seq));
        }

        if (classified.kind === "control") {
          const c = classified.control;
          if (c.type === "auth_ok") {
            sendPostAuthMessages(ws);
            setConnected(true);
          }
          // Always forward control messages (including auth_ok, in case the
          // consumer wants to react) — but auth_ok still drives connection
          // state above so consumers don't need to handle it.
          onControlRef.current?.(c);
          return;
        }

        if (classified.kind === "event") {
          const eventType = (classified.event as any).type;
          if (eventType === "agent_output") {
            // Batch rapid agent_output events
            batchQueue.push(classified.event);
            if (!batchTimer) {
              batchTimer = setTimeout(flushBatch, 0);
            }
          } else {
            // Flush any pending batch first, then dispatch immediately
            if (batchTimer) {
              clearTimeout(batchTimer);
              flushBatch();
            }
            onEventRef.current(classified.event);
          }
        }
        // unknown messages are ignored (forward compatibility).
      };

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnect
      };

      wsRef.current = ws;
    }

    connectFnRef.current = connect;

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      if (optsRef.current?.enabled === false) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, reconnectDelayRef.current);
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * RECONNECT_MULTIPLIER,
        RECONNECT_MAX_DELAY,
      );
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Connect when enabled flips to true; disconnect when disabled
  useEffect(() => {
    if (opts?.enabled === false) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    } else if (opts?.enabled === true && !wsRef.current && mountedRef.current && connectFnRef.current) {
      reconnectDelayRef.current = RECONNECT_BASE_DELAY;
      connectFnRef.current();
    }
  }, [opts?.enabled]);

  // Re-subscribe when mission changes
  useEffect(() => {
    if (opts?.missionId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event: "subscribe_mission", missionId: opts.missionId }));
    }
  }, [opts?.missionId]);

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { connected, send };
}
