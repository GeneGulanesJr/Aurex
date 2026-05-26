import { useEffect, useRef, useCallback, useState } from "react";
import type { WsClientEvent } from "@aurex/shared";

export function useWebSocket(onEvent: (event: WsClientEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { event: WsClientEvent };
        onEventRef.current(parsed.event);
      } catch {
        // Ignore malformed messages
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { connected, send };
}
