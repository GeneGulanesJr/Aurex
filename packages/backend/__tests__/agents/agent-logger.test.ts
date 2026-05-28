import { describe, it, expect } from "vitest";
import { createAgentLogger, type AgentLogEntry } from "../../src/agents/agent-logger";

function makeEntry(overrides: Partial<AgentLogEntry> & { sessionId: string }): Omit<AgentLogEntry, "timestamp"> {
  return {
    agentType: "worker",
    missionId: "m-1",
    milestoneId: "ms-1",
    event: "spawned",
    ...overrides,
  };
}

describe("createAgentLogger", () => {
  it("logs entries with auto-generated timestamp", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1" }));
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe("s-1");
    expect(entries[0].timestamp).toBeTruthy();
  });

  it("returns all entries when no filter", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1" }));
    logger.log(makeEntry({ sessionId: "s-2" }));
    expect(logger.getEntries()).toHaveLength(2);
  });

  it("filters by missionId", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1", missionId: "m-1" }));
    logger.log(makeEntry({ sessionId: "s-2", missionId: "m-2" }));
    const result = logger.getEntries({ missionId: "m-1" });
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s-1");
  });

  it("filters by sessionId", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1" }));
    logger.log(makeEntry({ sessionId: "s-2" }));
    const result = logger.getEntries({ sessionId: "s-1" });
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s-1");
  });

  it("filters by event", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1", event: "spawned" }));
    logger.log(makeEntry({ sessionId: "s-1", event: "completed" }));
    const result = logger.getEntries({ event: "completed" });
    expect(result).toHaveLength(1);
    expect(result[0].event).toBe("completed");
  });

  it("combines multiple filters", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1", missionId: "m-1", event: "spawned" }));
    logger.log(makeEntry({ sessionId: "s-1", missionId: "m-1", event: "completed" }));
    logger.log(makeEntry({ sessionId: "s-2", missionId: "m-1", event: "spawned" }));
    const result = logger.getEntries({ missionId: "m-1", event: "spawned" });
    expect(result).toHaveLength(2);
  });

  it("getRecent returns last N entries", () => {
    const logger = createAgentLogger();
    for (let i = 0; i < 10; i++) {
      logger.log(makeEntry({ sessionId: `s-${i}` }));
    }
    const recent = logger.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].sessionId).toBe("s-7");
    expect(recent[2].sessionId).toBe("s-9");
  });

  it("clear removes all entries", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1" }));
    logger.log(makeEntry({ sessionId: "s-2" }));
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });

  it("clear by sessionId removes only matching entries", () => {
    const logger = createAgentLogger();
    logger.log(makeEntry({ sessionId: "s-1" }));
    logger.log(makeEntry({ sessionId: "s-2" }));
    logger.clear("s-1");
    const remaining = logger.getEntries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe("s-2");
  });

  it("trims entries per mission when exceeding maxEntriesPerMission", () => {
    const logger = createAgentLogger(5);
    for (let i = 0; i < 7; i++) {
      logger.log(makeEntry({ sessionId: `s-${i}`, missionId: "m-1" }));
    }
    const entries = logger.getEntries({ missionId: "m-1" });
    expect(entries.length).toBeLessThanOrEqual(5);
  });

  it("does not trim entries from other missions", () => {
    const logger = createAgentLogger(3);
    for (let i = 0; i < 5; i++) {
      logger.log(makeEntry({ sessionId: `s-a-${i}`, missionId: "m-1" }));
    }
    logger.log(makeEntry({ sessionId: "s-b-1", missionId: "m-2" }));
    logger.log(makeEntry({ sessionId: "s-b-2", missionId: "m-2" }));
    const m2 = logger.getEntries({ missionId: "m-2" });
    expect(m2).toHaveLength(2);
  });
});
