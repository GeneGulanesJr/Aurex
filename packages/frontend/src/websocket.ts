import type { WsEvent } from '@aurex/shared';

type WsListener = (event: WsEvent) => void;

export class MissionWebSocket {
  private ws: WebSocket | null = null;
  private listeners: Set<WsListener> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private missionId: string;

  constructor(missionId: string) {
    this.missionId = missionId;
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/${this.missionId}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        for (const listener of this.listeners) {
          listener(parsed);
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }

  subscribe(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
