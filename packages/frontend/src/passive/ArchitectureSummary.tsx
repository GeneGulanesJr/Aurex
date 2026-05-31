import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { animate, stagger } from "animejs";
import type { CodeSummaryResponse } from "../api";

export function ArchitectureSummary({ data, error }: { data: CodeSummaryResponse | null; error?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;
    animate(el.querySelectorAll(".summary-line"), {
      opacity: [0, 1],
      translateY: [8, 0],
      delay: stagger(80),
      duration: 400,
      ease: "outExpo",
    });
  }, [data]);

  if (error) return <Unavailable label="summary" />;
  if (!data) return <LoadingSkeleton />;
  if (data.files === 0) {
    return <div style={textStyle}>No code files found</div>;
  }

  return (
    <div ref={ref} style={{ padding: "12px 0" }}>
      <div className="summary-line" style={textStyle}>
        {data.files} files · {data.symbols} symbols · {data.edges} import edges
      </div>
      <div className="summary-line" style={textStyle}>
        Modules: {data.modules.map((m) => m.name).join(", ") || "none detected"}
      </div>
      <div className="summary-line" style={textStyle}>
        Entry points: {data.entryPoints.join(", ") || "none detected"}
      </div>
      {data.cycles.count > 0 && (
        <div className="summary-line" style={{ ...textStyle, color: "var(--warning)" }}>
          Cycles: {data.cycles.count} detected
        </div>
      )}
    </div>
  );
}

const textStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "12px",
  color: "var(--text-secondary)",
  lineHeight: 1.8,
};

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0" }}>
      {[80, 60, 45].map((w) => (
        <div key={w} style={{ width: `${w}%`, height: "14px", background: "var(--bg-elevated)", borderRadius: "3px" }} />
      ))}
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return <div style={{ ...textStyle, color: "var(--text-muted)", padding: "12px 0" }}>{label} unavailable</div>;
}
