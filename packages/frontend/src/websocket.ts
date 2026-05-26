import type { WsEvent } from '@aurex/shared';

type WsListener = (event: WsEvent) => void;

export class MissionWebSocket {
  private ws: WebSocket | null = null;
  private listeners: Set<WsListener> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private missionId: string;
  private disposed = false;

  constructor(missionId: string) {
    this.missionId = missionId;
  }

  connect(): void {
    if (this.disposed) return;

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

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
      this.ws = null;
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnect
    };
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }

  subscribe(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const base = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = Math.random() * 500;
    this.reconnectTimer = setTimeout(() => this.connect(), base + jitter);
  }
}
