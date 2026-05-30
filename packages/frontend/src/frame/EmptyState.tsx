import { useRef, useEffect } from "react";
import { animate, stagger } from "animejs";

const examples = [
  '"Add OAuth2 login with Google and GitHub"',
  '"Write tests for the payment module"',
  '"Refactor the API to use Fastify"',
];

const steps = [
  { text: "Click", highlight: "+ NEW MISSION", after: "in the sidebar" },
  { text: "Describe what you want built" },
  { text: "Watch agents plan and execute" },
  { text: "Approve checkpoints when escalated" },
];

export function EmptyState({ onExampleClick }: { onExampleClick?: (text: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>(".empty-section");
    animate(sections, {
      opacity: [0, 1],
      translateY: [20, 0],
      delay: stagger(120),
      duration: 500,
      ease: "outExpo",
    });
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "600px",
        margin: "0 auto",
        padding: "40px",
        textAlign: "center",
      }}
    >
      {/* Logo */}
      <div
        className="empty-section"
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "48px",
          fontWeight: 700,
          letterSpacing: "12px",
          color: "var(--accent)",
          textShadow: "0 0 40px var(--accent-glow), 0 0 80px var(--accent-glow)",
          marginBottom: "4px",
          opacity: 0,
        }}
      >
        AUREX
      </div>

      {/* Subtitle */}
      <div
        className="empty-section"
        style={{
          fontSize: "13px",
          letterSpacing: "4px",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontFamily: '"JetBrains Mono", monospace',
          marginBottom: "32px",
          opacity: 0,
        }}
      >
        Autonomous Mission Control
      </div>

      {/* Description */}
      <div
        className="empty-section"
        style={{
          fontSize: "15px",
          lineHeight: 1.7,
          color: "var(--text-secondary)",
          marginBottom: "36px",
          opacity: 0,
        }}
      >
        Describe what you want built. Aurex breaks it into milestones,
        spawns autonomous agents, and orchestrates the work —
        escalating to you only when decisions matter.
      </div>

      {/* Steps */}
      <div className="empty-section" style={{ textAlign: "left", marginBottom: "40px", width: "100%", opacity: 0 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "10px 0", fontSize: "14px", color: "var(--text-secondary)" }}>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--accent)", paddingTop: "2px", minWidth: "16px" }}>❯</span>
            <span>
              {step.text}
              {step.highlight && (
                <>
                  {" "}
                  <span
                    style={{
                      background: "var(--bg-elevated)",
                      padding: "1px 6px",
                      borderRadius: "3px",
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "12px",
                      color: "var(--accent)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {step.highlight}
                  </span>
                  {" "}
                  {step.after}
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Example cards */}
      <div className="empty-section" style={{ width: "100%", textAlign: "left", opacity: 0 }}>
        <div
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "2px",
            color: "var(--text-muted)",
            fontFamily: '"JetBrains Mono", monospace',
            marginBottom: "12px",
          }}
        >
          EXAMPLE MISSIONS
        </div>
        {examples.map((text) => (
          <div
            key={text}
            onClick={() => onExampleClick?.(text.replace(/^"|"$/g, ""))}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px 16px",
              marginBottom: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent-dim)";
              e.currentTarget.style.background = "var(--bg-elevated)";
              e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.background = "var(--bg-surface)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <span style={{ color: "var(--accent)" }}>◈</span>
            <span style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>
              {text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
