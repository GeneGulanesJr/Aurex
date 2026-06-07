import type { BumblebeeFinding, WsClientEvent } from "@aurex/shared";

export interface MissionSnapshotInput {
  missionStatus: string;
  milestoneStatuses: string[];
  cost: { totalCost: number; totalTokens: number } | null;
  workerStatuses: string[];
}

export interface MissionSnapshot {
  statusLabel: string;
  statusColor: string;
  completedMilestones: number;
  totalMilestones: number;
  progressLabel: string;
  costLabel: string;
  tokensLabel: string;
  activeWorkers: number;
  failedWorkers: number;
}

export interface ActivityLogInput {
  phase: string;
  message: string;
  timestamp: number;
}

export interface ActivityFeedItem {
  id: string;
  kind: "log" | "event" | "cost" | "error" | "scan" | "agent";
  label: string;
  message: string;
  timestamp: number;
  color: string;
}

export function buildMissionSnapshot(input: MissionSnapshotInput): MissionSnapshot {
  const completedMilestones = input.milestoneStatuses.filter((status) => status === "completed").length;
  const totalMilestones = input.milestoneStatuses.length;
  const activeWorkers = input.workerStatuses.filter((status) => ["spawned", "working", "committing"].includes(status)).length;
  const failedWorkers = input.workerStatuses.filter((status) => ["failed", "timed_out"].includes(status)).length;

  return {
    statusLabel: missionStatusLabel(input.missionStatus),
    statusColor: missionStatusColor(input.missionStatus),
    completedMilestones,
    totalMilestones,
    progressLabel: totalMilestones === 0 && input.missionStatus === "planning"
      ? "Planning milestones…"
      : `${completedMilestones}/${totalMilestones} milestones`,
    costLabel: input.cost ? `$${input.cost.totalCost.toFixed(2)}` : "$0.00",
    tokensLabel: `${formatCompactNumber(input.cost?.totalTokens ?? 0)} tokens`,
    activeWorkers,
    failedWorkers,
  };
}

export function buildActivityFeedItems(input: {
  logs: ActivityLogInput[];
  events: WsClientEvent[];
  limit: number;
}): ActivityFeedItem[] {
  const logItems: ActivityFeedItem[] = input.logs.map((log, index) => ({
    id: `log-${index}-${log.timestamp}`,
    kind: "log",
    label: log.phase.toUpperCase(),
    message: log.message,
    timestamp: log.timestamp,
    color: "var(--accent)",
  }));

  const maxLogTimestamp = Math.max(0, ...input.logs.map((log) => log.timestamp));
  const eventItems: ActivityFeedItem[] = input.events.map((event, index) => eventToActivityItem(event, index, maxLogTimestamp));

  return [...logItems, ...eventItems]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, input.limit);
}

export function shouldShowSupplyChainTab(input: { isScanning: boolean; findingCount: number; scanCount: number; hasLatestSummary: boolean }): boolean {
  return input.isScanning || input.findingCount > 0 || (input.scanCount > 0 && input.hasLatestSummary);
}

export function summarizeSupplyChainRisk(findings: Array<Pick<BumblebeeFinding, "severity">>): {
  label: string;
  color: string;
  findingCount: number;
} {
  if (findings.length === 0) return { label: "CLEAN", color: "var(--success)", findingCount: 0 };
  if (findings.some((finding) => finding.severity === "critical")) return { label: "CRITICAL", color: "var(--error)", findingCount: findings.length };
  if (findings.some((finding) => finding.severity === "high")) return { label: "HIGH RISK", color: "var(--warning)", findingCount: findings.length };
  if (findings.some((finding) => finding.severity === "medium")) return { label: "MEDIUM", color: "var(--info)", findingCount: findings.length };
  return { label: "LOW", color: "var(--text-muted)", findingCount: findings.length };
}

function missionStatusLabel(status: string): string {
  if (status === "running") return "EXECUTING";
  if (status === "planning") return "PLANNING";
  if (status === "completed") return "COMPLETE";
  if (status === "failed") return "FAILED";
  return status.toUpperCase();
}

function missionStatusColor(status: string): string {
  if (status === "running" || status === "planning") return "var(--accent)";
  if (status === "completed") return "var(--success)";
  if (status === "failed") return "var(--error)";
  return "var(--text-muted)";
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimTrailingZero(value / 1_000)}K`;
  return value.toLocaleString();
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function eventToActivityItem(event: WsClientEvent, index: number, baseTimestamp: number): ActivityFeedItem {
  const timestamp = eventTimestamp(event, index, baseTimestamp);
  switch (event.type) {
    case "cost_update":
      return { id: `event-${index}-${event.type}`, kind: "cost", label: "COST", message: `$${event.totalCost.toFixed(2)} · ${formatCompactNumber(event.totalTokens)} tokens`, timestamp, color: "var(--text-muted)" };
    case "mission_error":
      return { id: `event-${index}-${event.type}`, kind: "error", label: "ERROR", message: `${event.code}: ${event.message}`, timestamp, color: "var(--error)" };
    case "agent_status":
      return { id: `event-${index}-${event.type}`, kind: "agent", label: "AGENT", message: `${event.agentType} → ${event.status.replace(/_/g, " ")}`, timestamp, color: "var(--accent)" };
    case "agent_output":
      return { id: `event-${index}-${event.type}`, kind: "agent", label: event.eventType === "tool_call" ? "TOOL" : "AGENT", message: event.message, timestamp, color: event.eventType === "failed" ? "var(--error)" : "var(--info)" };
    case "scan_started":
      return { id: `event-${index}-${event.type}`, kind: "scan", label: "SCAN", message: `supply chain scan started (${event.profile})`, timestamp, color: "var(--accent)" };
    case "scan_completed":
      return { id: `event-${index}-${event.type}`, kind: "scan", label: "SCAN", message: `scan complete: ${event.summary.totalFindings} findings`, timestamp, color: "var(--success)" };
    case "scan_finding":
      return { id: `event-${index}-${event.type}`, kind: "scan", label: "FINDING", message: `${event.finding.severity}: ${event.finding.packageName}@${event.finding.version}`, timestamp, color: "var(--error)" };
    case "mission_started":
      return { id: `event-${index}-${event.type}`, kind: "event", label: "START", message: "mission started", timestamp, color: "var(--success)" };
    case "mission_completed":
      return { id: `event-${index}-${event.type}`, kind: "event", label: "DONE", message: `mission ${event.finalState}`, timestamp, color: "var(--success)" };
    case "mission_log":
      return { id: `event-${index}-${event.type}`, kind: "log", label: event.phase.toUpperCase(), message: event.message, timestamp, color: "var(--accent)" };
    case "quota_update":
      return { id: `event-${index}-${event.type}`, kind: "event", label: "QUOTA", message: `${event.providerId}: ${event.status}`, timestamp, color: "var(--warning)" };
    case "quota_exhausted":
      return { id: `event-${index}-${event.type}`, kind: "error", label: "QUOTA", message: `${event.providerId} exhausted`, timestamp, color: "var(--error)" };
    default:
      return { id: `event-${index}-${event.type}`, kind: "event", label: event.type.toUpperCase(), message: event.type.replace(/_/g, " "), timestamp, color: "var(--text-secondary)" };
  }
}

function eventTimestamp(event: WsClientEvent, index: number, baseTimestamp: number): number {
  if (event.type === "agent_output") {
    const parsed = Date.parse(event.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  // Most WsClientEvent variants do not carry timestamps. Place them after the
  // latest log timestamp using deterministic event order instead of Date.now()
  // so keys, sorting, and animations remain stable per render.
  return baseTimestamp + index + 1;
}
