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

export interface UseWebSocketOptions {
  missionId?: string | null;
  apiKey?: string;
}

export function useWebSocket(onEvent: (event: WsClientEvent) => void, opts?: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const reconnectDelayRef = useRef(RECONNECT_BASE_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const ws = new WebSocket(buildWsUrl(window.location.host, window.location.protocol));
      let authenticated = !optsRef.current?.apiKey;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        reconnectDelayRef.current = RECONNECT_BASE_DELAY;

        // Send auth if api key is configured
        if (optsRef.current?.apiKey) {
          ws.send(JSON.stringify({ type: "auth", token: optsRef.current.apiKey }));
        }

        // Send replay request from last known sequence
        const lastSeq = localStorage.getItem(LAST_SEQ_KEY);
        if (lastSeq && !isNaN(Number(lastSeq))) {
          ws.send(JSON.stringify({ type: "replay", lastSeq: Number(lastSeq) }));
        }

        // Subscribe to selected mission
        if (optsRef.current?.missionId) {
          ws.send(JSON.stringify({ event: "subscribe_mission", missionId: optsRef.current.missionId }));
        }

        setConnected(true);
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onmessage = (msg) => {
        const parsed = parseWsMessage(msg.data);
        if (!parsed) return;

        // Track sequence for replay
        if (typeof parsed.seq === "number") {
          localStorage.setItem(LAST_SEQ_KEY, String(parsed.seq));
        }

        // Handle auth response
        if (parsed.type === "auth_ok") {
          authenticated = true;
          return;
        }

        // Only dispatch actual events
        if (parsed.event) {
          onEventRef.current(parsed.event);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnect
      };

      wsRef.current = ws;
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
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
