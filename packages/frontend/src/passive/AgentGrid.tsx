import { AgentNode } from "./AgentNode";
import type { WorkingUnit } from "@aurex/shared";

interface AgentGridProps {
  workers: WorkingUnit[];
}

export function AgentGrid({ workers }: AgentGridProps) {
  if (workers.length === 0) {
    return <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0", fontSize: "13px" }}>No active agents</div>;
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {workers.map((w) => (
        <AgentNode key={w.id} worker={w} />
      ))}
    </div>
  );
}
