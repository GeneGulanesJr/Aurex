import { useEffect, useRef } from "react";
import type { WorkingUnit } from "@aurex/shared";

interface AgentNodeProps {
  worker: WorkingUnit;
}

const statusColor: Record<string, string> = {
  spawned: "bg-yellow-500",
  working: "bg-blue-500",
  committing: "bg-purple-500",
  completed: "bg-green-500",
  timed_out: "bg-orange-500",
  failed: "bg-red-500",
};

export function AgentNode({ worker }: AgentNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nodeRef.current) return;
    nodeRef.current.style.opacity = "1";
  }, [worker.status]);

  return (
    <div ref={nodeRef} className="bg-surface rounded-lg p-4 flex items-center gap-3" style={{ opacity: 0 }}>
      <div className={`w-3 h-3 rounded-full ${statusColor[worker.status] || "bg-gray-500"}`} />
      <div>
        <div className="text-sm font-medium truncate">{worker.description}</div>
        <div className="text-xs text-gray-400">{worker.status}</div>
      </div>
    </div>
  );
}
