import { useMemo, useState, useRef, useCallback } from "react";
import type { Milestone, WsClientEvent } from "@aurex/shared";
import type { AgentLogEntry, MissionError } from "../hooks/useMission";

interface MissionDebugLogProps {
  mission: { id: string; description: string; status: string };
  milestones: Milestone[];
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  events: WsClientEvent[];
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
}

export function MissionDebugLog({ mission, milestones, logs, events, errors, agentLogs }: MissionDebugLogProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const transcript = useMemo(
    () => buildMissionDebugTranscript({ mission, milestones, logs, events, errors, agentLogs }),
    [mission, milestones, logs, events, errors, agentLogs],
  );

  const copyTranscript = useCallback(async () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(transcript);
      setCopyState("copied");
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
    }
  }, [transcript]);

  return (
    <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Mission Debug Log
        </span>
        <span style={{ marginLeft: "auto", fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)" }}>
          {transcript.split("\n").length} lines
        </span>
        <button
          onClick={copyTranscript}
          aria-label="Copy mission debug log"
          title="Copy mission debug log"
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: copyState === "failed" ? "var(--error)" : copyState === "copied" ? "var(--success)" : "var(--accent)",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "4px 8px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {copyState === "failed" ? "Failed" : copyState === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: "220px",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "10px",
          color: "var(--text-secondary)",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "10px",
          lineHeight: 1.55,
        }}
      >
        {transcript}
      </pre>
    </section>
  );
}

export function buildMissionDebugTranscript({
  mission,
  milestones,
  logs,
  events,
  errors,
  agentLogs,
}: MissionDebugLogProps): string {
  const lines: string[] = [];
  lines.push(`# Aurex Mission Debug Log`);
  lines.push(`generatedAt: ${new Date().toISOString()}`);
  lines.push(`missionId: ${mission.id}`);
  lines.push(`status: ${mission.status}`);
  lines.push(`description: ${mission.description}`);
  lines.push("");

  lines.push("## Milestones");
  if (milestones.length === 0) {
    lines.push("- none yet");
  } else {
    for (const milestone of milestones) {
      lines.push(`- ${milestone.id} [${milestone.status}] ${milestone.title}`);
      if (milestone.description) lines.push(`  description: ${milestone.description}`);
      if (milestone.validationContractId) lines.push(`  contract: ${milestone.validationContractId}`);
    }
  }
  lines.push("");

  lines.push("## Mission Logs");
  if (logs.length === 0) {
    lines.push("- none");
  } else {
    for (const log of logs) {
      lines.push(`${formatTimestamp(log.timestamp)} [${log.phase}] ${log.message}`);
      if (log.data && Object.keys(log.data).length > 0) {
        lines.push(indent(safeJson(log.data)));
      }
    }
  }
  lines.push("");

  lines.push("## Errors");
  if (errors.length === 0) {
    lines.push("- none");
  } else {
    for (const error of errors) {
      lines.push(`${formatTimestamp(error.timestamp)} [${error.code}] ${error.message}`);
      lines.push(`recoverable: ${error.recoverable}`);
      if (error.workerId) lines.push(`workerId: ${error.workerId}`);
      if (error.milestoneId) lines.push(`milestoneId: ${error.milestoneId}`);
      if (error.details && Object.keys(error.details).length > 0) {
        lines.push(indent(safeJson(error.details)));
      }
    }
  }
  lines.push("");

  lines.push("## Websocket Events");
  if (events.length === 0) {
    lines.push("- none");
  } else {
    for (const event of events) {
      lines.push(`[${event.type}] ${summarizeEvent(event)}`);
      lines.push(indent(safeJson(event)));
    }
  }
  lines.push("");

  lines.push("## Agent Output");
  const agentEntries = Object.entries(agentLogs);
  if (agentEntries.length === 0) {
    lines.push("- none");
  } else {
    for (const [agentId, entries] of agentEntries) {
      lines.push(`### ${agentId}`);
      if (entries.length === 0) {
        lines.push("- none");
        continue;
      }
      for (const entry of entries) {
        lines.push(`${entry.timestamp} [${entry.eventType}] ${entry.message}`);
        if (entry.data && Object.keys(entry.data).length > 0) {
          lines.push(indent(safeJson(entry.data)));
        }
      }
    }
  }

  return lines.join("\n");
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 946_684_800_000) return "live";
  return new Date(timestamp).toISOString();
}

function summarizeEvent(event: WsClientEvent): string {
  switch (event.type) {
    case "agent_status":
      return `${event.agentType} ${event.agentId} -> ${event.status}`;
    case "agent_output":
      return `${event.agentType} ${event.agentId} ${event.eventType}: ${event.message}`;
    case "milestone_progress":
      return `${event.milestoneId} -> ${event.status} (${event.completedUnits}/${event.totalUnits})`;
    case "mission_log":
      return `[${event.phase}] ${event.message}`;
    case "mission_error":
      return `${event.code}: ${event.message}`;
    case "mission_status":
      return event.status;
    case "mission_started":
    case "mission_queued":
    case "mission_completed":
    case "cost_update":
    case "escalation":
    case "milestones_set":
    case "scan_started":
    case "scan_completed":
    case "scan_finding":
      return event.missionId;
    case "mutation_progress":
      return `${event.repoName}: ${event.line}`;
    case "quota_update":
      return `${event.providerId} ${event.status}`;
    case "quota_exhausted":
      return `${event.providerId} resets ${event.windowResetsAt}`;
    default: {
      // Exhaustiveness guard: if a new WsClientEvent variant is added
      // without updating this switch, the line still gets a useful label
      // instead of the literal string "undefined". Narrow on `_` to
      // force a type error when the union grows.
      const unknown = event as Extract<WsClientEvent, { type: string }>;
      return `<${unknown.type}>`;
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
