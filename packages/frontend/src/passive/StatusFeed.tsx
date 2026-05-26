import type { WsClientEvent } from "@aurex/shared";

interface StatusFeedProps {
  events: WsClientEvent[];
}

export function StatusFeed({ events }: StatusFeedProps) {
  return (
    <div className="bg-surface rounded-lg p-4 h-64 overflow-y-auto">
      <div className="text-sm text-gray-400 mb-2">Events</div>
      {events.length === 0 && <div className="text-gray-600 text-sm">No events yet</div>}
      {events.slice(-20).reverse().map((event, i) => (
        <div key={i} className="text-xs py-1 border-b border-gray-800">
          <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>{" "}
          <span className="text-gray-300">{event.type}</span>
        </div>
      ))}
    </div>
  );
}
