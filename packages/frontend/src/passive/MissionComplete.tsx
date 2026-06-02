import { useRef, useEffect } from "react";
import { animate, stagger } from "animejs";
import type { Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";
import type { MissionError } from "../hooks/useMission";

interface MissionCompleteProps {
  mission: { id: string; description: string; status: string; createdAt?: string };
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  errors: MissionError[];
  onRestart?: () => void;
  onCreateMission?: (text: string) => void;
}

export function MissionComplete({ mission, milestones, workers, cost, events, errors, onRestart, onCreateMission }: MissionCompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const isSuccess = mission.status === "completed";
  const completedMilestones = milestones.filter((m) => m.status === "completed");
  const failedMilestones = milestones.filter((m) => m.status === "failed");
  const completedWorkers = workers.filter((w) => w.status === "completed");
  const failedWorkers = workers.filter((w) => w.status === "failed" || w.status === "timed_out");

  // Elapsed time — use mission.createdAt as start, last event with a timestamp as end
  const createdAt = "createdAt" in mission && typeof mission.createdAt === "string"
    ? new Date(mission.createdAt).getTime()
    : 0;
  const lastEventTs = events.length > 0
    ? (() => {
        // Walk backwards to find the last event with a timestamp
        for (let i = events.length - 1; i >= 0; i--) {
          const evt = events[i];
          if ("timestamp" in evt && typeof (evt as any).timestamp === "string") {
            return new Date((evt as any).timestamp).getTime();
          }
        }
        return 0;
      })()
    : 0;
  const elapsedMs = createdAt > 0 && lastEventTs > 0 ? lastEventTs - createdAt : 0;
  const elapsedStr = elapsedMs > 0
    ? (() => {
        const s = Math.floor(elapsedMs / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        return h > 0 ? `${h}h ${m % 60}m ${s % 60}s` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
      })()
    : null;

  // Entrance animation
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".complete-section");
    animate(items, {
      opacity: [0, 1],
      translateY: [12, 0],
      delay: stagger(80),
      duration: 500,
      ease: "outExpo",
    });
  }, []);

  const statusColor = isSuccess ? "var(--success)" : "var(--error)";
  const statusLabel = isSuccess ? "Mission Complete" : "Mission Failed";
  const statusIcon = isSuccess ? "✓" : "✕";

  return (
    <div ref={containerRef} style={{ padding: "32px 24px", maxWidth: "640px", margin: "0 auto" }}>
      {/* Status banner */}
      <div ref={cardRef} style={{ textAlign: "center", marginBottom: "32px" }} className="complete-section">
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: isSuccess ? "rgba(74, 222, 128, 0.1)" : "rgba(239, 68, 68, 0.1)",
          border: `2px solid ${statusColor}`,
          color: statusColor,
          fontSize: "24px",
          fontWeight: 700,
          marginBottom: "16px",
          boxShadow: `0 0 24px ${isSuccess ? "rgba(74, 222, 128, 0.15)" : "rgba(239, 68, 68, 0.15)"}`,
        }}>
          {statusIcon}
        </div>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "18px",
          fontWeight: 700,
          letterSpacing: "3px",
          textTransform: "uppercase",
          color: statusColor,
          marginBottom: "8px",
        }}>
          {statusLabel}
        </div>
        <div style={{ fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {mission.description}
        </div>
      </div>

      {/* Stats grid */}
      <div className="complete-section" style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "12px",
        marginBottom: "24px",
      }}>
        <StatCard label="Milestones" value={`${completedMilestones.length}/${milestones.length}`} color={failedMilestones.length > 0 ? "var(--warning)" : "var(--success)"} />
        <StatCard label="Workers" value={`${completedWorkers.length}/${workers.length}`} color={failedWorkers.length > 0 ? "var(--warning)" : "var(--success)"} />
        {cost && <StatCard label="Cost" value={`$${cost.totalCost.toFixed(2)}`} color="var(--accent)" sub={`${cost.totalTokens.toLocaleString()} tokens`} />}
        {!cost && <StatCard label="Cost" value="—" color="var(--text-muted)" />}
        {elapsedStr && <StatCard label="Elapsed" value={elapsedStr} color="var(--text-primary)" />}
        {!elapsedStr && <StatCard label="Elapsed" value="—" color="var(--text-muted)" />}
        <StatCard label="Events" value={String(events.length)} color="var(--info)" />
      </div>

      {/* Milestone breakdown */}
      {milestones.length > 0 && (
        <div className="complete-section" style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "16px",
          marginBottom: "24px",
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: "12px",
          }}>
            Milestones
          </div>
          {milestones.map((ms) => {
            const passed = ms.status === "completed";
            return (
              <div key={ms.id} style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}>
                <span style={{
                  fontSize: "13px",
                  color: passed ? "var(--success)" : "var(--error)",
                  width: "16px",
                  textAlign: "center",
                }}>
                  {passed ? "✓" : "✕"}
                </span>
                <span style={{
                  flex: 1,
                  fontSize: "13px",
                  color: passed ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                  {ms.title}
                </span>
                <span style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: "9px",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: passed ? "var(--success)" : "var(--error)",
                }}>
                  {passed ? "PASSED" : ms.status.replace("_", " ")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Errors summary (failed missions) */}
      {!isSuccess && errors.length > 0 && (
        <div className="complete-section" style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--error)",
          borderRadius: "6px",
          padding: "16px",
          marginBottom: "24px",
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--error)",
            marginBottom: "10px",
          }}>
            Errors
          </div>
          {errors.slice(-5).map((err, i) => (
            <div key={i} style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px", lineHeight: 1.5 }}>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", color: "var(--error)" }}>{err.code}</span>
              {" — "}{err.message}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="complete-section" style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
        {onRestart && (
          <button
            onClick={onRestart}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "11px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              background: "var(--bg-elevated)",
              color: "var(--accent)",
              border: "1px solid var(--accent-dim)",
              borderRadius: "4px",
              padding: "10px 24px",
              cursor: "pointer",
            }}
          >
            Restart Mission
          </button>
        )}
        {onCreateMission && (
          <button
            onClick={() => onCreateMission(mission.description)}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "11px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "10px 24px",
              cursor: "pointer",
            }}
          >
            Similar Mission
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      padding: "12px",
      textAlign: "center",
    }}>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: "9px",
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        marginBottom: "6px",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: "16px",
        fontWeight: 600,
        color,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "9px",
          color: "var(--text-muted)",
          marginTop: "2px",
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
