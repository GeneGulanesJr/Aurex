import { useEffect, useRef } from "react";
import type { WorkingUnit } from "@aurex/shared";
import { createPulse, createSpin, createIdle } from "../animations/agent-animations";

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
    const el = nodeRef.current;
    if (!el) return;
    let anim: ReturnType<typeof createPulse> | undefined;
    if (worker.status === "working") {
      anim = createPulse(el);
    } else if (worker.status === "spawned") {
      anim = createSpin(el);
    } else {
      createIdle(el);
    }
    return () => { anim?.pause(); };
  }, [worker.status]);

  return (
    <div ref={nodeRef} className="bg-surface rounded-lg p-4 flex items-center gap-3">
      <div className={`w-3 h-3 rounded-full status-dot ${statusColor[worker.status] || "bg-gray-500"}`} />
      <div>
        <div className="text-sm font-medium truncate">{worker.description}</div>
        <div className="text-xs text-gray-400">{worker.status}</div>
      </div>
    </div>
  );
}
