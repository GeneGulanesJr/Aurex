import { describe, it, expect } from "vitest";
import { AGENT_TOOLS, AGENT_SKILL, needsMemoryLayer, resolveModel } from "../../src/agents/factory";
import type { AgentType } from "@aurex/shared";

describe("agent factory", () => {
  it("worker has read, write, edit, bash tools", () => {
    const tools = AGENT_TOOLS["worker"];
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
    expect(tools).toContain("bash");
  });

  it("validator_scrutiny has read + bash (tests only)", () => {
    const tools = AGENT_TOOLS["validator_scrutiny"];
    expect(tools).toContain("read");
    expect(tools).toContain("bash");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
  });

  it("research has read-only discovery tools", () => {
    expect(AGENT_TOOLS["research"]).toEqual(["read", "grep", "find", "ls"]);
    expect(AGENT_TOOLS["research"]).not.toContain("write");
    expect(AGENT_TOOLS["research"]).not.toContain("edit");
    expect(AGENT_TOOLS["research"]).not.toContain("bash");
  });

  it("orchestrator has read only", () => {
    expect(AGENT_TOOLS["orchestrator"]).toEqual(["read"]);
  });

  it("skill files map correctly", () => {
    expect(AGENT_SKILL["orchestrator"]).toContain("src/skills/orchestrator.md");
    expect(AGENT_SKILL["worker"]).toContain("src/skills/worker.md");
    expect(AGENT_SKILL["validator_scrutiny"]).toContain("src/skills/validator.md");
    expect(AGENT_SKILL["validator_user_testing"]).toContain("src/skills/validator.md");
    expect(AGENT_SKILL["research"]).toContain("src/skills/research.md");
  });

  it("memory-layer for workers and research only", () => {
    expect(needsMemoryLayer("worker")).toBe(true);
    expect(needsMemoryLayer("research")).toBe(true);
    expect(needsMemoryLayer("orchestrator")).toBe(false);
    expect(needsMemoryLayer("validator_scrutiny")).toBe(false);
    expect(needsMemoryLayer("validator_user_testing")).toBe(false);
  });

  it("resolveModel returns correct hint", () => {
    const hints: Record<AgentType, string> = {
      orchestrator: "reasoning-strong",
      worker: "code-fast",
      validator_scrutiny: "reasoning",
      validator_user_testing: "computer-use",
      research: "fast-cheap",
    };
    expect(resolveModel("worker", hints)).toBe("code-fast");
    expect(resolveModel("orchestrator", hints)).toBe("reasoning-strong");
  });
});
