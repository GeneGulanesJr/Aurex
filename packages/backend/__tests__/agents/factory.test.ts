import { describe, it, expect } from "vitest";
import { AGENT_TOOLS, needsMemoryLayer } from "../../src/agents/factory";

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

  it("memory-layer for workers and research only", () => {
    expect(needsMemoryLayer("worker")).toBe(true);
    expect(needsMemoryLayer("research")).toBe(true);
    expect(needsMemoryLayer("orchestrator")).toBe(false);
    expect(needsMemoryLayer("validator_scrutiny")).toBe(false);
    expect(needsMemoryLayer("validator_user_testing")).toBe(false);
  });
});
