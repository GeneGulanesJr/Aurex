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
    <div className="bg-surface rounded-lg p-4 h-64 overflow-y-auto">
      <div className="text-sm text-gray-400 mb-2">Events</div>
      {events.length === 0 && <div className="text-gray-600 text-sm">No events yet</div>}
      <div ref={listRef}>
        {events.slice(-20).reverse().map((event, i) => (
          <div key={i} className="feed-item text-xs py-1 border-b border-gray-800">
            <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>{" "}
            <span className="text-gray-300">{event.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
