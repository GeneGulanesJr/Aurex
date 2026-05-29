import { useEffect, useRef } from "react";
import type { WsClientEvent } from "@aurex/shared";
import { staggerEntrance } from "../animations/stagger";

interface StatusFeedProps {
  events: WsClientEvent[];
}

export function StatusFeed({ events }: StatusFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".feed-item"));
    if (items.length > 0) {
      staggerEntrance(items.slice(-5));
    }
  }, [events.length]);

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 16px", height: "256px", overflowY: "auto" }}>
      <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>Events</div>
      {events.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No events yet</div>}
      <div ref={listRef}>
        {events.slice(-20).reverse().map((event, i) => (
          <div key={i} className="feed-item" style={{ fontSize: "12px", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-secondary)" }}>{new Date().toLocaleTimeString()}</span>{" "}
            <span style={{ color: "var(--text-primary)" }}>{event.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
