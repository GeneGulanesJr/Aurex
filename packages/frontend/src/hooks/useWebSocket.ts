import { useEffect, useRef, useCallback, useState } from "react";
import type { WsClientEvent } from "@aurex/shared";

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MULTIPLIER = 1.5;
const RECONNECT_MAX_ATTEMPTS = 20;
const LAST_SEQ_KEY = "aurex:lastSeq";

/** WS close codes that indicate an auth/session problem — don't reconnect forever. */
const AUTH_FAILURE_CODES = new Set([4001, 4003, 1008]);

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
  /** Invoked when the WebSocket auth handshake fails (expired/revoked token). */
  onAuthError?: () => void;
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
  const reconnectAttemptsRef = useRef(0);
  const authFailedRef = useRef(false);
  const mountedRef = useRef(true);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const onAuthErrorRef = useRef(opts?.onAuthError);
  onAuthErrorRef.current = opts?.onAuthError;
  const connectFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    authFailedRef.current = false;

    function connect() {
      if (!mountedRef.current) return;
      if (authFailedRef.current) return;
      if (optsRef.current?.enabled === false) return;

      const ws = new WebSocket(buildWsUrl(window.location.host, window.location.protocol));
      ws.onopen = async () => {
        if (!mountedRef.current) { ws.close(); return; }
        reconnectDelayRef.current = RECONNECT_BASE_DELAY;
        reconnectAttemptsRef.current = 0;

        if (optsRef.current?.getToken) {
          try {
            const token = await optsRef.current.getToken();
            ws.send(JSON.stringify({ type: "auth", token }));
          } catch {
            authFailedRef.current = true;
            onAuthErrorRef.current?.();
            ws.close(4003, "Auth failed");
            return;
          }
        }

        if (!optsRef.current?.getToken) {
          sendPostAuthMessages(ws);
          setConnected(true);
        }
      };

      ws.onclose = (ev) => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        // Auth failures: don't reconnect forever — the onAuthError handler
        // (which calls logout()) will redirect to login.
        if (AUTH_FAILURE_CODES.has(ev.code)) {
          authFailedRef.current = true;
          onAuthErrorRef.current?.();
          return;
        }
        scheduleReconnect();
      };

      // Micro-batch agent_output events to prevent UI freeze during rapid tool calls
      let batchQueue: WsClientEvent[] = [];

      function flushBatch() {
        batchTimerRef.current = null;
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
            if (!batchTimerRef.current) {
              batchTimerRef.current = setTimeout(flushBatch, 0);
            }
          } else {
            // Flush any pending batch first, then dispatch immediately
            if (batchTimerRef.current) {
              clearTimeout(batchTimerRef.current);
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
      if (authFailedRef.current) return;
      if (optsRef.current?.enabled === false) return;
      if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) {
        return;
      }
      reconnectAttemptsRef.current += 1;
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
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
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
      reconnectAttemptsRef.current = 0;
      authFailedRef.current = false;
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
