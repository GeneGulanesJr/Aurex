// packages/backend/src/agents/factory.ts
import type { AgentType } from "@aurex/shared";

export const AGENT_TOOLS: Record<AgentType, string[]> = {
  orchestrator: ["read"],
  worker: ["read", "write", "edit", "bash"],
  validator_scrutiny: ["read", "bash"],
  validator_user_testing: ["read", "bash"],
  research: ["read"],
};

export const AGENT_SKILL: Record<AgentType, string> = {
  orchestrator: "src/skills/orchestrator.md",
  worker: "src/skills/worker.md",
  validator_scrutiny: "src/skills/validator.md",
  validator_user_testing: "src/skills/validator.md",
  research: "src/skills/research.md",
};

export function needsMemoryLayer(type: AgentType): boolean {
  return type === "worker" || type === "research";
}

export function resolveModel(type: AgentType, modelHints: Record<AgentType, string>): string {
  return modelHints[type];
}
