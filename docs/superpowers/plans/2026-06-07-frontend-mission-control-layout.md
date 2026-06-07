# Aurex Frontend Mission Control Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Aurex frontend mission experience so the active mission state, next action, risk signals, and live activity are readable at a glance.

**Architecture:** Keep Aurex's existing dark mission-control design language and current data flow, but change presentation hierarchy. `MissionPipeline` becomes a composed layout: primary left rail for mission status and milestones, secondary right inspector for Activity / Code / Supply Chain. Existing panels are reused with small variant props instead of broad rewrites.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, inline style conventions already used in `packages/frontend/src`, Aurex `DESIGN.md` tokens via CSS variables.

---

## File Structure

**Create**
- `packages/frontend/src/passive/missionUiModel.ts` — pure display helpers for progress, stable activity feed normalization, tab availability, risk summaries.
- `packages/frontend/src/passive/missionUiModel.test.ts` — Vitest coverage for the pure helpers.
- `packages/frontend/src/passive/MissionSummaryHeader.tsx` — compact mission header/status strip.
- `packages/frontend/src/passive/MissionActivityFeed.tsx` — unified feed replacing separate `PlanningLog` + `EventStream` presentation once the inspector is wired.
- `packages/frontend/src/passive/MissionInspectorPanel.tsx` — right-side tabbed inspector for Activity, Code Context, and Supply Chain.

**Modify**
- `packages/frontend/src/passive/MissionPipeline.tsx` — convert from vertical stack to mission-control layout, remove duplicated feed rendering only after inspector is present, keep existing milestone/worker subcomponents.
- `packages/frontend/src/passive/CodeContextPanel.tsx` — add variant props so it can render inside the inspector without auto-collapsing into a stray summary line, and show a pending state in inspector mode.
- `packages/frontend/src/passive/SupplyChainPanel.tsx` — add variant props for compact inspector rendering and hide empty low-value content unless scanning/findings/scan summary exist.
- `packages/frontend/src/passive/RepoOverviewPanel.tsx` — reorder to make suggested missions primary and reference data secondary.
- `packages/frontend/src/styles.css` — add responsive classes for mission layout and inspector panel.

**Do not modify**
- Backend APIs, mission websocket contract, mission reducer hooks, supply-chain hook behavior, theme tokens.

---

## Task 1: Add Pure UI Model Helpers

**Files:**
- Create: `packages/frontend/src/passive/missionUiModel.ts`
- Create: `packages/frontend/src/passive/missionUiModel.test.ts`

- [ ] **Step 1: Create failing tests for mission display helpers**

Create `packages/frontend/src/passive/missionUiModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WsClientEvent } from "@aurex/shared";
import {
  buildActivityFeedItems,
  buildMissionSnapshot,
  shouldShowSupplyChainTab,
  summarizeSupplyChainRisk,
} from "./missionUiModel";

describe("missionUiModel", () => {
  it("builds a compact mission snapshot", () => {
    const snapshot = buildMissionSnapshot({
      missionStatus: "running",
      milestoneStatuses: ["completed", "in_progress", "planned"],
      cost: { totalCost: 1.234, totalTokens: 45200 },
      workerStatuses: ["working", "completed", "failed"],
    });

    expect(snapshot.statusLabel).toBe("EXECUTING");
    expect(snapshot.completedMilestones).toBe(1);
    expect(snapshot.totalMilestones).toBe(3);
    expect(snapshot.progressLabel).toBe("1/3 milestones");
    expect(snapshot.costLabel).toBe("$1.23");
    expect(snapshot.tokensLabel).toBe("45.2K tokens");
    expect(snapshot.activeWorkers).toBe(1);
    expect(snapshot.failedWorkers).toBe(1);
  });

  it("uses a planning progress label before milestones exist", () => {
    const snapshot = buildMissionSnapshot({
      missionStatus: "planning",
      milestoneStatuses: [],
      cost: null,
      workerStatuses: [],
    });

    expect(snapshot.statusLabel).toBe("PLANNING");
    expect(snapshot.progressLabel).toBe("Planning milestones…");
  });

  it("merges mission logs and websocket events into stable newest-first activity items", () => {
    const events: WsClientEvent[] = [
      { type: "mission_started", missionId: "m1" } as WsClientEvent,
      { type: "cost_update", missionId: "m1", totalCost: 0.25, totalTokens: 2000, delta: 0.25 } as WsClientEvent,
      { type: "agent_output", missionId: "m1", agentId: "a1", agentType: "implementer", eventType: "tool_call", message: "read src/App.tsx", timestamp: "2026-06-07T12:00:05.000Z" } as WsClientEvent,
    ];

    const items = buildActivityFeedItems({
      logs: [{ phase: "planning", message: "Created plan", timestamp: 1_000 }],
      events,
      limit: 4,
    });

    expect(items.map((item) => item.kind)).toEqual(["agent", "cost", "event", "log"]);
    expect(items[0].label).toBe("TOOL");
    expect(items[0].timestamp).toBe(Date.parse("2026-06-07T12:00:05.000Z"));
    expect(items[1].timestamp).toBe(3);
    expect(items[2].timestamp).toBe(2);
    expect(items[3].timestamp).toBe(1_000);
    expect(items.map((item) => item.id)).toEqual(["event-2-agent_output", "event-1-cost_update", "event-0-mission_started", "log-0-1000"]);
  });

  it("only shows supply chain tab when it has useful content", () => {
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 0, hasLatestSummary: false })).toBe(false);
    expect(shouldShowSupplyChainTab({ isScanning: true, findingCount: 0, scanCount: 0, hasLatestSummary: false })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 2, scanCount: 1, hasLatestSummary: true })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 1, hasLatestSummary: true })).toBe(true);
    expect(shouldShowSupplyChainTab({ isScanning: false, findingCount: 0, scanCount: 1, hasLatestSummary: false })).toBe(false);
  });

  it("summarizes supply chain risk with severity priority", () => {
    expect(summarizeSupplyChainRisk([])).toEqual({ label: "CLEAN", color: "var(--success)", findingCount: 0 });
    expect(summarizeSupplyChainRisk([
      { id: "1", severity: "medium" } as any,
      { id: "2", severity: "critical" } as any,
    ])).toEqual({ label: "CRITICAL", color: "var(--error)", findingCount: 2 });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm vitest run packages/frontend/src/passive/missionUiModel.test.ts
```

Expected: fails because `missionUiModel.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `packages/frontend/src/passive/missionUiModel.ts`:

```ts
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

  const eventItems: ActivityFeedItem[] = input.events.map((event, index) => eventToActivityItem(event, index));

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

function eventToActivityItem(event: WsClientEvent, index: number): ActivityFeedItem {
  const timestamp = eventTimestamp(event, index);
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

function eventTimestamp(event: WsClientEvent, index: number): number {
  if (event.type === "agent_output") {
    const parsed = Date.parse(event.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  // Most WsClientEvent variants do not carry timestamps. Use 1-based event order
  // instead of Date.now() so keys, sorting, and animations remain stable per render.
  return index + 1;
}
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm vitest run packages/frontend/src/passive/missionUiModel.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
git add packages/frontend/src/passive/missionUiModel.ts packages/frontend/src/passive/missionUiModel.test.ts
git commit -m "test: add frontend mission ui model helpers"
```

---

## Task 2: Add Compact Mission Summary Header

**Files:**
- Create: `packages/frontend/src/passive/MissionSummaryHeader.tsx`
- Modify: `packages/frontend/src/passive/MissionPipeline.tsx`

- [ ] **Step 1: Create `MissionSummaryHeader.tsx`**

```tsx
import type { CSSProperties } from "react";
import { buildMissionSnapshot } from "./missionUiModel";

interface MissionSummaryHeaderProps {
  mission: { description: string; status: string };
  milestones: Array<{ status: string }>;
  workers: Array<{ status: string }>;
  cost: { totalCost: number; totalTokens: number } | null;
}

const labelStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const valueStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "11px",
  color: "var(--text-secondary)",
};

export function MissionSummaryHeader({ mission, milestones, workers, cost }: MissionSummaryHeaderProps) {
  const snapshot = buildMissionSnapshot({
    missionStatus: mission.status,
    milestoneStatuses: milestones.map((milestone) => milestone.status),
    workerStatuses: workers.map((worker) => worker.status),
    cost,
  });

  return (
    <section style={{ border: "1px solid var(--border)", background: "var(--bg-surface)", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
        <span style={{ ...labelStyle, color: snapshot.statusColor, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "3px", padding: "3px 8px" }}>
          {snapshot.statusLabel}
        </span>
        <span style={valueStyle}>{snapshot.progressLabel}</span>
        <span style={valueStyle}>{snapshot.costLabel}</span>
        <span style={valueStyle}>{snapshot.tokensLabel}</span>
        <span style={valueStyle}>workers {snapshot.activeWorkers} active</span>
        {snapshot.failedWorkers > 0 && <span style={{ ...valueStyle, color: "var(--error)" }}>{snapshot.failedWorkers} failed</span>}
      </div>
      <div style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: 500, lineHeight: 1.4 }}>
        {mission.description}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Replace the existing mission header block in `MissionPipeline.tsx`**

Add import:

```tsx
import { MissionSummaryHeader } from "./MissionSummaryHeader";
```

Replace the current `{/* Mission header */}` block with:

```tsx
<MissionSummaryHeader
  mission={mission}
  milestones={milestones}
  workers={workers}
  cost={cost}
/>
```

Do not remove `CodeContextPanel`, `SupplyChainPanel`, `PlanningLog`, or `EventStream` in this task.

- [ ] **Step 3: Typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/passive/MissionSummaryHeader.tsx packages/frontend/src/passive/MissionPipeline.tsx
git commit -m "feat: add compact mission summary header"
```

---

## Task 3: Add Unified Activity Feed Component Without Changing Existing Render Path

**Files:**
- Create: `packages/frontend/src/passive/MissionActivityFeed.tsx`

- [ ] **Step 1: Create `MissionActivityFeed.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import type { WsClientEvent } from "@aurex/shared";
import { buildActivityFeedItems } from "./missionUiModel";

interface MissionActivityFeedProps {
  logs: Array<{ phase: string; message: string; timestamp: number }>;
  events: WsClientEvent[];
  active: boolean;
  limit?: number;
}

export function MissionActivityFeed({ logs, events, active, limit = 12 }: MissionActivityFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = buildActivityFeedItems({ logs, events, limit });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>(".activity-feed-item");
    const newNodes = Array.from(nodes).slice(0, 3);
    if (newNodes.length === 0) return;
    animate(newNodes, { opacity: [0, 1], translateX: [8, 0], delay: stagger(35), duration: 250, ease: "outExpo" });
  }, [items.length]);

  return (
    <section style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Activity
        </span>
        {active && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.5s infinite" }} />}
        <span style={{ marginLeft: "auto", fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)" }}>{items.length} latest</span>
      </div>
      <div ref={listRef} style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: "6px", paddingRight: "2px" }}>
        {items.length === 0 ? (
          <div style={{ border: "1px dashed var(--border)", borderRadius: "6px", padding: "16px", textAlign: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}>
            Awaiting mission activity…
          </div>
        ) : items.map((item) => (
          <div key={item.id} className="activity-feed-item" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px", padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1px", color: item.color, minWidth: "58px" }}>{item.label}</span>
              <span style={{ marginLeft: "auto", fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)" }}>
                {new Date(item.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.45, wordBreak: "break-word" }}>{item.message}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/passive/MissionActivityFeed.tsx
git commit -m "feat: add unified mission activity feed"
```

---

## Task 4: Add Inspector Variants for Code Context and Supply Chain

**Files:**
- Modify: `packages/frontend/src/passive/CodeContextPanel.tsx`
- Modify: `packages/frontend/src/passive/SupplyChainPanel.tsx`

- [ ] **Step 1: Update `CodeContextPanel` props**

Change the props interface to:

```tsx
interface CodeContextPanelProps {
  missionId: string;
  logs: LogEntry[];
  milestones: { status?: string }[];
  variant?: "inline" | "inspector";
  autoCollapse?: boolean;
  showCollapsedSummary?: boolean;
}
```

Change the function signature to:

```tsx
export function CodeContextPanel({
  missionId,
  logs,
  milestones,
  variant = "inline",
  autoCollapse = true,
  showCollapsedSummary = true,
}: CodeContextPanelProps) {
```

Change the auto-collapse effect guard:

```tsx
useEffect(() => {
  if (autoCollapse && milestones.length > 0 && indexingDone && !collapsed) {
    setCollapsed(true);
  }
}, [autoCollapse, milestones.length, indexingDone, collapsed]);
```

Replace the current `if (!indexingDone) return null;` with:

```tsx
if (!indexingDone) {
  if (variant === "inspector") {
    return (
      <div style={{ border: "1px dashed var(--border)", borderRadius: "6px", padding: "16px", textAlign: "center", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", lineHeight: 1.5 }}>
        Code context pending indexing…
      </div>
    );
  }
  return null;
}
```

Change collapsed rendering:

```tsx
if (collapsed && showCollapsedSummary) {
  return (
    <div style={COLLAPSED_BG} onClick={toggleCollapse}>
      ▸ Code Context ({indexCounts.files} files, {indexCounts.symbols} symbols)
    </div>
  );
}

if (collapsed && !showCollapsedSummary) return null;
```

Change root style to use inspector spacing:

```tsx
const rootStyle: CSSProperties = variant === "inspector"
  ? { opacity: 0 }
  : { borderBottom: "1px solid var(--border)", marginBottom: "16px", opacity: 0 };
```

Then use:

```tsx
<div ref={panelRef} style={rootStyle}>
```

- [ ] **Step 2: Update `SupplyChainPanel` props**

Change the props interface to:

```tsx
interface SupplyChainPanelProps {
  findings: BumblebeeFinding[];
  scans: BumblebeeScanResult[];
  isScanning: boolean;
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
  variant?: "inline" | "inspector";
  hideWhenEmpty?: boolean;
}
```

Change function signature:

```tsx
export function SupplyChainPanel({ findings, scans, isScanning, onTriggerScan, variant = "inline", hideWhenEmpty = false }: SupplyChainPanelProps) {
```

After `hasFindings` is computed, add:

```tsx
if (hideWhenEmpty && !isScanning && !hasFindings && !latestScan?.summary) return null;
```

Change root margin:

```tsx
<div style={{ marginTop: variant === "inspector" ? 0 : "20px" }}>
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/passive/CodeContextPanel.tsx packages/frontend/src/passive/SupplyChainPanel.tsx
git commit -m "feat: support inspector variants for mission side panels"
```

---

## Task 5: Build Mission Inspector and Split Mission Pipeline Layout

**Files:**
- Create: `packages/frontend/src/passive/MissionInspectorPanel.tsx`
- Modify: `packages/frontend/src/passive/MissionPipeline.tsx`
- Modify: `packages/frontend/src/styles.css`

- [ ] **Step 1: Create `MissionInspectorPanel.tsx`**

```tsx
import { useMemo, useState } from "react";
import type { BumblebeeFinding, BumblebeeScanResult, Milestone, WsClientEvent } from "@aurex/shared";
import { CodeContextPanel } from "./CodeContextPanel";
import { MissionActivityFeed } from "./MissionActivityFeed";
import { SupplyChainPanel } from "./SupplyChainPanel";
import { shouldShowSupplyChainTab, summarizeSupplyChainRisk } from "./missionUiModel";

interface MissionInspectorPanelProps {
  missionId: string;
  missionStatus: string;
  milestones: Milestone[];
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  events: WsClientEvent[];
  eventStreamCount: number;
  scanFindings: BumblebeeFinding[];
  isScanning: boolean;
  scans: BumblebeeScanResult[];
  onTriggerScan?: (profile?: "baseline" | "project" | "deep") => void;
}

type TabId = "activity" | "code" | "supply";

export function MissionInspectorPanel(props: MissionInspectorPanelProps) {
  const latestScan = props.scans.length > 0 ? props.scans[props.scans.length - 1] : null;
  const showSupply = shouldShowSupplyChainTab({
    isScanning: props.isScanning,
    findingCount: props.scanFindings.length,
    scanCount: props.scans.length,
    hasLatestSummary: Boolean(latestScan?.summary),
  });
  const risk = summarizeSupplyChainRisk(props.scanFindings);
  const tabs = useMemo(() => [
    { id: "activity" as const, label: "Activity", badge: String(Math.min(props.eventStreamCount, props.events.length + props.logs.length)) },
    { id: "code" as const, label: "Code", badge: null },
    ...(showSupply ? [{ id: "supply" as const, label: "Supply", badge: risk.findingCount > 0 ? String(risk.findingCount) : risk.label }] : []),
  ], [props.eventStreamCount, props.events.length, props.logs.length, showSupply, risk.findingCount, risk.label]);
  const [activeTab, setActiveTab] = useState<TabId>("activity");
  const safeActiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : "activity";

  return (
    <aside className="mission-inspector-panel">
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "12px", flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: safeActiveTab === tab.id ? "var(--bg-elevated)" : "transparent",
              border: "none",
              borderBottom: `2px solid ${safeActiveTab === tab.id ? "var(--accent)" : "transparent"}`,
              color: safeActiveTab === tab.id ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "8px 10px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {tab.label}{tab.badge && <span style={{ marginLeft: "6px", color: tab.id === "supply" ? risk.color : "var(--text-secondary)" }}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div style={{ minHeight: 0, flex: 1, overflow: "hidden" }}>
        {safeActiveTab === "activity" && (
          <MissionActivityFeed logs={props.logs} events={props.events} active={props.missionStatus === "planning" || props.missionStatus === "running"} limit={props.eventStreamCount} />
        )}
        {safeActiveTab === "code" && (
          <div style={{ overflowY: "auto", height: "100%" }}>
            <CodeContextPanel missionId={props.missionId} logs={props.logs} milestones={props.milestones} variant="inspector" autoCollapse={false} showCollapsedSummary={false} />
          </div>
        )}
        {safeActiveTab === "supply" && (
          <div style={{ overflowY: "auto", height: "100%" }}>
            <SupplyChainPanel findings={props.scanFindings} scans={props.scans} isScanning={props.isScanning} onTriggerScan={props.onTriggerScan} variant="inspector" hideWhenEmpty />
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add responsive CSS**

Append to `packages/frontend/src/styles.css`:

```css
/* === Mission Control Layout === */
.mission-pipeline-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  padding: 20px 24px;
  min-height: 100%;
}

.mission-primary-column {
  min-width: 0;
}

.mission-inspector-panel {
  position: sticky;
  top: 16px;
  align-self: start;
  height: calc(100vh - 44px - 36px - 40px);
  min-height: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  overflow: hidden;
}

@media (max-width: 1100px) {
  .mission-pipeline-shell {
    grid-template-columns: 1fr;
  }

  .mission-inspector-panel {
    position: static;
    height: 360px;
    min-height: 280px;
  }
}

@media (max-width: 640px) {
  .mission-pipeline-shell {
    padding: 16px;
    gap: 12px;
  }

  .mission-inspector-panel {
    height: 320px;
  }
}
```

- [ ] **Step 3: Convert `MissionPipeline` render shell exactly**

Add import:

```tsx
import { MissionInspectorPanel } from "./MissionInspectorPanel";
```

Remove these imports from `MissionPipeline.tsx` after JSX is converted:

```tsx
import { CodeContextPanel } from "./CodeContextPanel";
import { SupplyChainPanel } from "./SupplyChainPanel";
```

In `MissionPipeline`, replace the whole current top-level returned JSX shape:

```tsx
return (
  <div style={{ padding: "20px 24px" }}>
    <MissionSummaryHeader ... />
    <CodeContextPanel ... />
    <SupplyChainPanel ... />
    <div ref={pipelineRef} ...>
      ...milestone pipeline...
    </div>
    {(mission.status === "planning" || logs.length > 0) && <PlanningLog ... />}
    <EventStream ... />
  </div>
);
```

with this shape:

```tsx
return (
  <div className="mission-pipeline-shell">
    <div className="mission-primary-column">
      <MissionSummaryHeader
        mission={mission}
        milestones={milestones}
        workers={workers}
        cost={cost}
      />

      <div ref={pipelineRef} style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {milestones.length === 0 && (
          <PlanningPhase missionStatus={mission.status} errors={errors} onRetry={onRetry} />
        )}
        {milestones.map((milestone, i) => {
          // Keep the existing milestone mapping body unchanged.
        })}
      </div>
    </div>

    <MissionInspectorPanel
      missionId={mission.id}
      missionStatus={mission.status}
      milestones={milestones}
      logs={logs}
      events={events}
      eventStreamCount={eventStreamCount}
      scanFindings={scanFindings}
      isScanning={isScanning}
      scans={scans}
      onTriggerScan={onTriggerScan}
    />
  </div>
);
```

Important constraints for this edit:
- Move no milestone/worker JSX into the inspector.
- Keep the entire existing `milestones.map(...)` implementation intact.
- Remove the standalone `CodeContextPanel` and `SupplyChainPanel` above the milestones.
- Remove the bottom `PlanningLog` and `EventStream` render calls only in this task, because `MissionInspectorPanel` now owns activity rendering.
- Keep `PlanningPhase`, `PlanningSpinner`, `MilestoneDot`, `MilestoneProgressBar`, `WorkerChip`, and `getWorkerLogs`.

- [ ] **Step 4: Delete unused code from `MissionPipeline.tsx`**

Remove these functions after confirming no references remain:
- `PlanningLog`
- `EventStream`
- `EventSummary`

Remove these now-unused constants/imports after confirming no references remain:
- `logEventColor`, if only `EventSummary`/`WorkerChip` no longer needs it. If `WorkerChip` still uses it, keep it.
- `CodeContextPanel`
- `SupplyChainPanel`

- [ ] **Step 5: Run typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/passive/MissionInspectorPanel.tsx packages/frontend/src/passive/MissionPipeline.tsx packages/frontend/src/styles.css
git commit -m "feat: split mission pipeline into primary timeline and inspector"
```

---

## Task 6: Reprioritize Repo Overview Around Suggested Missions

**Files:**
- Modify: `packages/frontend/src/passive/RepoOverviewPanel.tsx`

- [ ] **Step 1: Reorder the overview render sections**

In `RepoOverviewPanel.tsx`, move the entire `{suggestions.length > 0 && (() => { ... })()}` block so it appears immediately after the header block and before the `{/* Readiness + package scan */}` block.

The resulting order in the returned JSX must be:

```tsx
{/* Header */}
<div className="overview-section" ...>...</div>

{/* Suggestions grouped by tier */}
{suggestions.length > 0 && (() => { ... })()}

{/* Readiness + package scan */}
<div className="overview-section" ...>...</div>

{/* Modules + Hotspots grid */}
<div className="overview-section" ...>...</div>

{/* Structure */}
{summary && (...)}
```

- [ ] **Step 2: Change only the suggestions header copy**

Within the moved suggestions block, change:

```tsx
<span>SUGGESTED MISSIONS</span>
```

to:

```tsx
<span>NEXT BEST MISSIONS</span>
```

Change the adjacent summary expression from:

```tsx
{suggestions.length} FOUND · {activeTiers.length} TIERS
```

to:

```tsx
{suggestions.length} actionable · {activeTiers.length} priority bands
```

- [ ] **Step 3: De-emphasize only reference section labels**

For exactly these five label blocks, change the label style color from `var(--text-muted)` to `var(--text-secondary)`:

1. The `READINESS PROFILE` label.
2. The `PACKAGE SCAN` label.
3. The `MODULES` label.
4. The `HOTSPOTS` label.
5. The `STRUCTURE` label.

Do not change body text, suggestion text, tier labels, badges, warnings, or the `REPO MAP` header label.

- [ ] **Step 4: Make Start Mission buttons visually primary**

In the suggestion item button, replace only the button style object with:

```tsx
style={{
  color: "var(--bg-deep)",
  background: "var(--accent)",
  border: "1px solid var(--accent)",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "10px",
  padding: "6px 10px",
  fontFamily: '"JetBrains Mono", monospace',
  textTransform: "uppercase",
  letterSpacing: "1px",
  whiteSpace: "nowrap" as const,
  flexShrink: 0,
  fontWeight: 600,
}}
```

- [ ] **Step 5: Typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/passive/RepoOverviewPanel.tsx
git commit -m "feat: prioritize suggested missions in repo overview"
```

---

## Task 7: Final Verification and Visual Smoke Test

**Files:**
- Verify only; no expected edits unless a previous task introduced failures.

- [ ] **Step 1: Run focused frontend tests**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm vitest run packages/frontend/src/passive/missionUiModel.test.ts packages/frontend/src/api.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend typecheck**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run frontend build**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run build
```

Expected: Vite build completes successfully.

- [ ] **Step 4: Manual visual smoke test**

Start the app:

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm --filter @aurex/frontend run dev
```

Open the Vite URL and verify:

1. Running mission: mission summary + milestones are visible before Code/Supply details.
2. Inspector defaults to Activity tab.
3. Activity tab shows both planning logs and websocket events in one feed.
4. Activity feed items do not reshuffle or get new keys while idle.
5. Code tab shows `Code context pending indexing…` before indexing and full Code Context after indexing.
6. Supply tab is absent when there are no scans/findings and not scanning.
7. Supply tab appears for active scans, findings, or a completed scan with summary; clean scans are labeled `CLEAN`.
8. On viewport width below 1100px, inspector stacks below the mission timeline.
9. On mobile width below 640px, mission content remains readable and does not overflow horizontally.
10. Repo overview shows `NEXT BEST MISSIONS` before reference cards.

- [ ] **Step 5: Run full test suite if frontend build passes**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Final commit if any verification fixes were needed**

```bash
git status --short
git add <changed-files>
git commit -m "fix: polish frontend mission control layout"
```

Skip this commit if `git status --short` shows no changes after verification.

---

## Self-Review

**Spec coverage:**
- Active mission at-a-glance readability: Tasks 2, 5.
- Avoid vertical feature stacking: Task 5.
- Merge duplicate log/feed surfaces without temporary regression: Tasks 3 and 5.
- Keep Code Context and Supply Chain available but secondary: Task 4 and Task 5.
- Stable activity ordering despite timestamp-less `WsClientEvent` variants: Task 1 and Task 7.
- Code tab pending state: Task 4 and Task 7.
- Make Repo Overview more action-oriented: Task 6.
- Responsive behavior: Task 5 CSS and Task 7 smoke checks.

**Placeholder scan:** No TBD/TODO/later placeholders remain. Each task has concrete files, commands, and expected results.

**Type consistency:** New helper names are used consistently: `buildMissionSnapshot`, `buildActivityFeedItems`, `shouldShowSupplyChainTab`, `summarizeSupplyChainRisk`. New component names are consistent: `MissionSummaryHeader`, `MissionActivityFeed`, `MissionInspectorPanel`.
