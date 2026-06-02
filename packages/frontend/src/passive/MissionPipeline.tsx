import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { animate, stagger } from "animejs";
import { createPulse, createSpin, createIdle } from "../animations/agent-animations";
import { staggerEntrance } from "../animations/stagger";
import { animateProgress } from "../animations/counters";
import type { Milestone, WorkingUnit, WsClientEvent, MilestoneStatus } from "@aurex/shared";
import type { MissionError, AgentLogEntry } from "../hooks/useMission";
import { CodeContextPanel } from "./CodeContextPanel";

interface MissionPipelineProps {
  mission: { id: string; description: string; status: string };
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: { totalCost: number; totalTokens: number } | null;
  events: WsClientEvent[];
  logs: Array<{ phase: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  errors: MissionError[];
  agentLogs: Record<string, AgentLogEntry[]>;
  eventStreamCount?: number;
  onRetry?: () => void;
}

const statusConfig: Record<string, { color: string; label: string; icon: string }> = {
  planned: { color: "var(--text-muted)", label: "PLANNED", icon: "○" },
  in_progress: { color: "var(--accent)", label: "IN PROGRESS", icon: "●" },
  validating: { color: "var(--info)", label: "VALIDATING", icon: "◈" },
  completed: { color: "var(--success)", label: "COMPLETED", icon: "✓" },
  failed: { color: "var(--error)", label: "FAILED", icon: "✕" },
};

const workerStatusColor: Record<string, string> = {
  spawned: "var(--warning)",
  working: "var(--accent)",
  committing: "var(--info)",
  completed: "var(--success)",
  timed_out: "var(--warning)",
  failed: "var(--error)",
};

const logEventColor: Record<string, string> = {
  spawned: "var(--warning)",
  prompt_sent: "var(--text-muted)",
  tool_call: "var(--accent)",
  cost_update: "var(--text-muted)",
  completed: "var(--success)",
  timed_out: "var(--warning)",
  failed: "var(--error)",
  aborted: "var(--text-muted)",
};

export function MissionPipeline({ mission, milestones, workers, cost, events, logs, errors, agentLogs, eventStreamCount = 8, onRetry }: MissionPipelineProps) {
  const pipelineRef = useRef<HTMLDivElement>(null);
  const prevMilestoneCountRef = useRef(0);

  // Animate milestone nodes on entrance
  useEffect(() => {
    const el = pipelineRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>(".milestone-node");
    if (nodes.length > prevMilestoneCountRef.current) {
      const newNodes = Array.from(nodes).slice(prevMilestoneCountRef.current);
      animate(newNodes, {
        opacity: [0, 1],
        scale: [0.85, 1],
        delay: stagger(80),
        duration: 500,
        ease: "outExpo",
      });
    }
    prevMilestoneCountRef.current = nodes.length;
  }, [milestones.length]);

  // Group workers by milestone
  const workersByMilestone = useMemo(() => {
    const map = new Map<string, WorkingUnit[]>();
    for (const w of workers) {
      const list = map.get(w.milestoneId) || [];
      list.push(w);
      map.set(w.milestoneId, list);
    }
    return map;
  }, [workers]);

  const workerContainerRef = useRef<HTMLDivElement>(null);
  const prevWorkerCountRef = useRef(0);

  useEffect(() => {
    const el = workerContainerRef.current;
    if (!el) return;
    const chips = el.querySelectorAll<HTMLElement>(".worker-chip");
    if (chips.length > prevWorkerCountRef.current) {
      const newChips = Array.from(chips).slice(prevWorkerCountRef.current);
      staggerEntrance(newChips);
    }
    prevWorkerCountRef.current = chips.length;
  }, [workers.length]);

  const activeMilestone = milestones.find((m) => m.status === "in_progress" || m.status === "validating");
  const completedCount = milestones.filter((m) => m.status === "completed").length;

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* Mission header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: mission.status === "running" || mission.status === "planning" ? "var(--accent)" : "var(--text-muted)",
              background: "var(--bg-elevated)",
              padding: "3px 8px",
              borderRadius: "3px",
              border: "1px solid var(--border)",
            }}
          >
            {mission.status === "running" ? "EXECUTING" : mission.status === "planning" ? "PLANNING" : mission.status.toUpperCase()}
          </span>
          {cost && (
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)" }}>
              {completedCount}/{milestones.length} milestones · ${cost.totalCost.toFixed(2)} · {cost.totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        <div style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.4 }}>
          {mission.description}
        </div>
      </div>

      {/* Code Context Panel */}
      <CodeContextPanel
        missionId={mission.id}
        logs={logs}
        milestones={milestones}
      />

      {/* Milestone pipeline */}
      <div ref={pipelineRef} style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {milestones.length === 0 && (
          <PlanningPhase missionStatus={mission.status} errors={errors} onRetry={onRetry} />
        )}
        {milestones.map((milestone, i) => {
          const cfg = statusConfig[milestone.status] || statusConfig.planned;
          const msWorkers = workersByMilestone.get(milestone.id) || [];
          const isActive = milestone.id === activeMilestone?.id;
          const isLast = i === milestones.length - 1;

          return (
            <div key={milestone.id} style={{ display: "flex" }}>
              {/* Rail: connector line + node dot */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "28px", flexShrink: 0 }}>
                {/* Connector above */}
                {i > 0 && (
                  <div
                    style={{
                      width: "2px",
                      height: "12px",
                      background: milestones[i - 1]?.status === "completed" ? "var(--success)" : "var(--border)",
                      transition: "background 0.3s",
                    }}
                  />
                )}
                {/* Node dot */}
                <MilestoneDot status={milestone.status} active={isActive} />
                {/* Connector below */}
                {!isLast && (
                  <div
                    style={{
                      width: "2px",
                      flex: 1,
                      minHeight: "24px",
                      background: milestone.status === "completed" ? "var(--success)" : "var(--border)",
                      transition: "background 0.3s",
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingBottom: isLast ? "0" : "16px", minWidth: 0 }}>
                <div
                  className="milestone-node"
                  style={{
                    background: isActive ? "var(--bg-surface)" : "transparent",
                    border: isActive ? "1px solid var(--border)" : "1px solid transparent",
                    borderRadius: "6px",
                    padding: isActive ? "12px 16px" : "4px 16px",
                    transition: "background 0.2s, border-color 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: isActive && msWorkers.length > 0 ? "12px" : 0 }}>
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: cfg.color, letterSpacing: "1px" }}>
                      {cfg.icon}
                    </span>
                    <span style={{ fontSize: "14px", fontWeight: 500, color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                      {milestone.title}
                    </span>
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "9px",
                        letterSpacing: "1.5px",
                        textTransform: "uppercase",
                        color: cfg.color,
                        marginLeft: "auto",
                        opacity: 0.8,
                      }}
                    >
                      {cfg.label}
                    </span>
                  </div>

                  {/* Workers under active milestone */}
                  {isActive && msWorkers.length > 0 && (
                    <div ref={workerContainerRef} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {msWorkers.map((w) => (
                        <WorkerChip key={w.id} worker={w} errors={errors} logs={getWorkerLogs(w.id, agentLogs)} />
                      ))}
                    </div>
                  )}

                  {/* Progress bar for active/in-progress milestones */}
                  {(isActive || milestone.status === "validating") && (
                    <MilestoneProgressBar milestone={milestone} workers={workers} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Planning log — shown when mission is in planning phase or has planning logs */}
      {(mission.status === "planning" || logs.length > 0) && (
        <PlanningLog logs={logs} active={mission.status === "planning" || mission.status === "running"} />
      )}

      {/* Live event stream */}
      <EventStream events={events} eventStreamCount={eventStreamCount} />
    </div>
  );
}

function MilestoneDot({ status, active }: { status: MilestoneStatus; active: boolean }) {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dotRef.current;
    if (!el) return;
    if (active && (status === "in_progress" || status === "validating")) {
      const anim = createPulse(el);
      return () => { anim.pause(); };
    }
    if (status === "completed") {
      el.style.boxShadow = "0 0 8px var(--success)";
    }
  }, [status, active]);

  const color = statusConfig[status]?.color || "var(--text-muted)";

  return (
    <div
      ref={dotRef}
      style={{
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        border: active ? "2px solid var(--accent-bright, var(--accent))" : "2px solid transparent",
        transition: "background 0.3s",
      }}
    />
  );
}

function MilestoneProgressBar({ milestone, workers }: { milestone: Milestone; workers: WorkingUnit[] }) {
  const barRef = useRef<HTMLDivElement>(null);
  const prevPercentRef = useRef(0);

  const msWorkers = workers.filter((w) => w.milestoneId === milestone.id);
  const total = msWorkers.length;
  const completed = msWorkers.filter((w) => w.status === "completed").length;
  const percent = total > 0 ? (completed / total) * 100 : 0;

  useEffect(() => {
    if (barRef.current && prevPercentRef.current !== percent) {
      animateProgress(barRef.current, prevPercentRef.current, percent);
      prevPercentRef.current = percent;
    }
  }, [percent]);

  if (total === 0) return null;

  return (
    <div
      style={{
        width: "100%",
        height: "3px",
        background: "var(--border)",
        borderRadius: "2px",
        marginTop: "8px",
        overflow: "hidden",
      }}
    >
      <div
        ref={barRef}
        style={{
          height: "100%",
          width: `${percent}%`,
          background: "var(--accent)",
          borderRadius: "2px",
          transition: "background 0.3s",
        }}
      />
    </div>
  );
}

function getWorkerLogs(workerId: string, agentLogs: Record<string, AgentLogEntry[]>): AgentLogEntry[] {
  return agentLogs[workerId] ?? agentLogs[`worker-${workerId}`] ?? [];
}

function WorkerChip({ worker, errors, logs }: { worker: WorkingUnit; errors: MissionError[]; logs: AgentLogEntry[] }) {
  const chipRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const isFailed = worker.status === "failed" || worker.status === "timed_out";
  const workerError = errors.find((e) => e.workerId === worker.id || e.workerId === `worker-${worker.id}`);

  useEffect(() => {
    const el = chipRef.current;
    if (!el) return;
    let anim: ReturnType<typeof createPulse> | undefined;
    if (worker.status === "working") anim = createPulse(el);
    else if (worker.status === "spawned") anim = createSpin(el);
    else createIdle(el);
    return () => { anim?.pause(); };
  }, [worker.status]);

  useEffect(() => {
    if (expanded && detailRef.current) detailRef.current.scrollTop = detailRef.current.scrollHeight;
  }, [expanded, logs.length]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div style={{ width: "100%" }}>
      <div ref={chipRef} className="worker-chip" onClick={toggle} style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-elevated)", border: `1px solid ${isFailed ? "var(--error)" : "var(--border)"}`, borderRadius: "4px", padding: "6px 10px", cursor: "pointer", userSelect: "none", transition: "border-color 0.2s" }}>
        <div className="status-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: workerStatusColor[worker.status] || "var(--text-muted)", boxShadow: worker.status === "working" ? `0 0 6px ${workerStatusColor[worker.status] || "var(--text-muted)"}` : "none", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{worker.description}</span>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: workerStatusColor[worker.status] || "var(--text-muted)" }}>{worker.status.replace("_", " ")}</span>
        {logs.length > 0 && <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "8px", color: "var(--text-muted)", background: "var(--bg-inset)", padding: "1px 5px", borderRadius: "3px" }}>{logs.length}</span>}
        {isFailed && <span style={{ fontSize: "9px", color: "var(--error)" }}>!</span>}
        <span style={{ fontSize: "9px", color: "var(--text-muted)", transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▸</span>
      </div>
      {expanded && (
        <div style={{ marginLeft: "14px", borderLeft: `2px solid ${isFailed ? "var(--error)" : "var(--border)"}`, marginTop: "2px", marginBottom: "4px" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {worker.taskBranch && <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--info)" }}>↎ {worker.taskBranch}</span>}
            {worker.declaredPaths.length > 0 && <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--text-muted)" }}>{worker.declaredPaths.length} path{worker.declaredPaths.length !== 1 ? "s" : ""}</span>}
          </div>
          {workerError && <div style={{ padding: "8px 10px", background: "var(--bg-inset)", borderBottom: "1px solid var(--error)", fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5 }}><div style={{ color: "var(--error)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginBottom: "4px" }}>{workerError.code}</div><div>{workerError.message}</div>{workerError.details && <pre style={{ marginTop: "6px", fontSize: "10px", color: "var(--text-muted)", whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(workerError.details, null, 2)}</pre>}</div>}
          {logs.length > 0 ? <div ref={detailRef} style={{ maxHeight: "180px", overflowY: "auto", padding: "6px 10px", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", lineHeight: 1.6 }}>{logs.map((log, i) => <div key={i} style={{ display: "flex", gap: "6px", padding: "2px 0", color: i === logs.length - 1 ? "var(--text-primary)" : "var(--text-secondary)" }}><span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: "9px", paddingTop: "2px" }}>{new Date(log.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span style={{ fontSize: "8px", textTransform: "uppercase", letterSpacing: "0.5px", color: logEventColor[log.eventType] ?? "var(--text-muted)", flexShrink: 0, paddingTop: "2px", minWidth: "60px" }}>{log.eventType.replace("_", " ")}</span><span style={{ wordBreak: "break-word" }}>{log.message}</span></div>)}</div> : <div style={{ padding: "8px 10px", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>No activity yet</div>}
        </div>
      )}
    </div>
  );
}

function PlanningLog({ logs, active }: { logs: Array<{ phase: string; message: string; timestamp: number }>; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState("");

  // Elapsed timer — counts from first log timestamp
  useEffect(() => {
    if (!active || logs.length === 0) { setElapsed(""); return; }
    const start = logs[0].timestamp;
    const tick = () => {
      const diff = Date.now() - start;
      const s = Math.floor(diff / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      setElapsed(h > 0 ? `${h}h ${m % 60}m ${s % 60}s` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, logs.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  if (logs.length === 0) return null;

  const lastIdx = logs.length - 1;
  const lastTimestamp = logs[lastIdx].timestamp;
  const timeSinceLast = Math.floor((Date.now() - lastTimestamp) / 1000);
  const lastRelative = timeSinceLast < 5 ? "just now" : timeSinceLast < 60 ? `${timeSinceLast}s ago` : `${Math.floor(timeSinceLast / 60)}m ago`;

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Mission Log
        </span>
        {active && (
          <>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.5s infinite" }} />
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--accent)", letterSpacing: "1px" }}>
              {elapsed}
            </span>
          </>
        )}
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", color: "var(--text-muted)", marginLeft: "auto" }}>
          last: {active ? lastRelative : new Date(lastTimestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
      <div
        ref={containerRef}
        style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "12px 16px",
          maxHeight: "300px",
          overflowY: "auto",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        {logs.map((log, i) => {
          const isLatest = i === lastIdx;
          return (
            <div key={i} style={{
              display: "flex",
              gap: "8px",
              padding: isLatest ? "6px 8px" : "2px 0",
              borderRadius: "3px",
              background: isLatest ? "var(--bg-elevated)" : "transparent",
              border: isLatest ? "1px solid var(--border)" : "1px solid transparent",
              color: isLatest ? "var(--text-primary)" : "var(--text-secondary)",
              wordBreak: "break-word",
              transition: "background 0.2s, border-color 0.2s",
            }}>
              <span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: "10px", paddingTop: "3px" }}>
                {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span>
                <span style={{ color: "var(--accent)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "1px", marginRight: "4px" }}>
                  {log.phase}
                </span>
                {log.message}
                {isLatest && active && (
                  <span style={{ color: "var(--accent)", fontSize: "9px", marginLeft: "8px", letterSpacing: "1px" }}>● LATEST</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningSpinner() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = animate(el, {
      rotate: "1turn",
      duration: 2000,
      loop: true,
      ease: "linear",
    });
    return () => { anim.pause(); };
  }, []);

  return (
    <div ref={ref} style={{ display: "inline-block", fontSize: "20px", color: "var(--accent)" }}>
      ◈
    </div>
  );
}

const PLANNING_TIMEOUT_MS = 5 * 60 * 1000;

function PlanningPhase({ missionStatus, errors, onRetry }: { missionStatus: string; errors: MissionError[]; onRetry?: () => void }) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (missionStatus !== "planning") return;
    const id = setTimeout(() => setTimedOut(true), PLANNING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [missionStatus]);

  const hasFailed = missionStatus === "failed";
  const plannerErrors = errors.filter((e) => e.code.startsWith("planner") || e.code === "mission_crash");
  const lastError = plannerErrors[plannerErrors.length - 1];

  if (hasFailed || (timedOut && lastError && !lastError.recoverable)) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "13px", color: "var(--error)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
          Planning Failed
        </div>
        {lastError && (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px", maxWidth: "480px", margin: "0 auto 16px" }}>
            {lastError.message}
          </div>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "11px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              background: "var(--bg-elevated)",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "4px",
              padding: "8px 20px",
              cursor: "pointer",
            }}
          >
            Retry Mission
          </button>
        )}
      </div>
    );
  }

  if (timedOut) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--warning)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
          Planning is taking longer than expected…
        </div>
        {lastError && (
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "12px" }}>
            {lastError.message}
          </div>
        )}
        {onRetry && lastError?.recoverable && (
          <button
            onClick={onRetry}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              background: "transparent",
              color: "var(--warning)",
              border: "1px solid var(--warning)",
              borderRadius: "4px",
              padding: "6px 16px",
              cursor: "pointer",
            }}
          >
            Retry Planning
          </button>
        )}
        <PlanningSpinner />
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
        Planning milestones…
      </div>
      <PlanningSpinner />
    </div>
  );
}

function EventStream({ events, eventStreamCount = 8 }: { events: WsClientEvent[]; eventStreamCount?: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  const recentEvents = events.slice(-eventStreamCount);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".evt-item");
    const newItems = Array.from(items).slice(-3);
    if (newItems.length > 0) {
      animate(newItems, {
        opacity: [0, 1],
        translateX: [-8, 0],
        delay: stagger(40),
        duration: 300,
        ease: "outExpo",
      });
    }
  }, [events.length]);

  if (recentEvents.length === 0) return null;

  const eventTypeLabel: Record<string, string> = {
    agent_status: "AGENT",
    milestone_progress: "MILESTONE",
    cost_update: "COST",
    escalation: "ESCALATION",
    mission_queued: "QUEUE",
    mission_started: "START",
    mission_completed: "DONE",
    mission_error: "ERROR",
    agent_output: "OUTPUT",
  };

  const eventTypeColor: Record<string, string> = {
    agent_status: "var(--accent)",
    milestone_progress: "var(--info)",
    cost_update: "var(--text-muted)",
    escalation: "var(--warning)",
    mission_queued: "var(--text-muted)",
    mission_started: "var(--success)",
    mission_completed: "var(--success)",
    mission_error: "var(--error)",
    agent_output: "var(--info)",
  };

  return (
    <div style={{ marginTop: "24px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "12px" }}>
        Live Feed
      </div>
      <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {recentEvents.map((evt, i) => (
          <div
            key={i}
            className="evt-item"
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", fontSize: "12px" }}
          >
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1px", color: eventTypeColor[evt.type] || "var(--text-muted)", minWidth: "72px" }}>
              {eventTypeLabel[evt.type] || evt.type.toUpperCase()}
            </span>
            <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <EventSummary event={evt} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventSummary({ event }: { event: WsClientEvent }) {
  switch (event.type) {
    case "agent_status":
      return <>{event.agentType} → {event.status.replace("_", " ")}</>;
    case "milestone_progress":
      return <>progress: {event.completedUnits}/{event.totalUnits} units</>;
    case "cost_update":
      return <>${event.totalCost.toFixed(2)} ({event.totalTokens.toLocaleString()} tokens)</>;
    case "escalation":
      return <>checkpoint: {event.trigger.kind.replace(/_/g, " ")}</>;
    case "mission_started":
      return <>mission started</>;
    case "mission_completed":
      return <>mission {event.finalState}</>;
    case "mission_queued":
      return <>queued #{event.queuePosition}</>;
    case "mission_error":
      return <>{event.code}: {event.message}</>;
    case "agent_output":
      return <>{event.agentId}: {event.message}</>;
  }
}
