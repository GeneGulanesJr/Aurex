// packages/backend/src/agents/factory.ts
import type { AgentType } from "@aurex/shared";

export const AGENT_TOOLS: Record<AgentType, string[]> = {
  orchestrator: ["read"],
  worker: ["read", "write", "edit", "bash"],
  validator_scrutiny: ["read", "bash"],
  validator_user_testing: ["read", "bash"],
  research: ["read", "grep", "find", "ls"],
};

export function needsMemoryLayer(type: AgentType): boolean {
  return type === "worker" || type === "research";
}
