import type { AgentType } from "@aurex/shared";

export type AgentLogEvent =
  | "spawned"
  | "prompt_sent"
  | "tool_call"
  | "tool_result"
  | "cost_update"
  | "completed"
  | "timed_out"
  | "failed"
  | "aborted";

export interface AgentLogEntry {
  sessionId: string;
  agentType: AgentType;
  missionId: string;
  milestoneId: string;
  unitId?: string;
  event: AgentLogEvent;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface AgentLogFilter {
  missionId?: string;
  sessionId?: string;
  event?: AgentLogEvent;
}

export interface AgentLogger {
  log(entry: Omit<AgentLogEntry, "timestamp">): void;
  getEntries(filter?: AgentLogFilter): AgentLogEntry[];
  getRecent(count: number): AgentLogEntry[];
  clear(sessionId?: string): void;
}

export function createAgentLogger(maxEntriesPerMission: number = 1000): AgentLogger {
  const entries: AgentLogEntry[] = [];
  const counts = new Map<string, number>();

  function trimMission(missionId: string) {
    const count = counts.get(missionId) ?? 0;
    if (count <= maxEntriesPerMission) return;
    const toRemove = count - maxEntriesPerMission;
    let removed = 0;
    for (let i = 0; i < entries.length && removed < toRemove; i++) {
      if (entries[i]?.missionId === missionId) {
        entries.splice(i, 1);
        i--;
        removed++;
      }
    }
    counts.set(missionId, count - removed);
  }

  return {
    log(entry) {
      const full: AgentLogEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      entries.push(full);
      const c = (counts.get(entry.missionId) ?? 0) + 1;
      counts.set(entry.missionId, c);
      trimMission(entry.missionId);
    },

    getEntries(filter) {
      if (!filter) return [...entries];
      return entries.filter((e) => {
        if (filter.missionId && e.missionId !== filter.missionId) return false;
        if (filter.sessionId && e.sessionId !== filter.sessionId) return false;
        if (filter.event && e.event !== filter.event) return false;
        return true;
      });
    },

    getRecent(count) {
      return entries.slice(-count);
    },

    clear(sessionId) {
      if (!sessionId) {
        entries.length = 0;
        counts.clear();
        return;
      }
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]?.sessionId === sessionId) {
          entries.splice(i, 1);
        }
      }
    },
  };
}
