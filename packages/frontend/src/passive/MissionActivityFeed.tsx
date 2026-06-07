import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import type { WsClientEvent } from "@aurex/shared";
import { buildActivityFeedItems } from "./missionUiModel";

interface MissionActivityFeedProps {
  logs: Array<{ phase: string; message: string; timestamp: number }>;
  events: WsClientEvent[];
  active: boolean;
  limit?: number;
}

export function MissionActivityFeed({ logs, events, active, limit = 12 }: MissionActivityFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = buildActivityFeedItems({ logs, events, limit });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>(".activity-feed-item");
    const newNodes = Array.from(nodes).slice(0, 3);
    if (newNodes.length === 0) return;
    animate(newNodes, { opacity: [0, 1], translateX: [8, 0], delay: stagger(35), duration: 250, ease: "outExpo" });
  }, [items.length]);

  return (
    <section style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Activity
        </span>
        {active && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.5s infinite" }} />}
        <span style={{ marginLeft: "auto", fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)" }}>{items.length} latest</span>
      </div>
      <div ref={listRef} style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: "6px", paddingRight: "2px" }}>
        {items.length === 0 ? (
          <div style={{ border: "1px dashed var(--border)", borderRadius: "6px", padding: "16px", textAlign: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}>
            Awaiting mission activity…
          </div>
        ) : items.map((item) => (
          <div key={item.id} className="activity-feed-item" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1px", color: item.color, minWidth: "58px" }}>{item.label}</span>
              <span style={{ marginLeft: "auto", fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)" }}>
                {formatActivityTime(item.timestamp)}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.45, wordBreak: "break-word" }}>{item.message}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatActivityTime(timestamp: number): string {
  // Synthetic timestamps preserve stable ordering for WsClientEvent variants that
  // do not carry a timestamp. Do not render those as 1970-era wall-clock times.
  if (timestamp < 946_684_800_000) return "live";
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
