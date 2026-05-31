import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import type { CodeHotspotsResponse } from "../api";

export function HotspotHeatmap({ data, error }: { data: CodeHotspotsResponse | null; error?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data || data.files.length === 0) return;
    animate(el.querySelectorAll(".hotspot-row"), {
      opacity: [0, 1],
      translateX: [-12, 0],
      delay: stagger(50),
      duration: 400,
      ease: "outExpo",
    });
  }, [data]);

  if (error) return <Unavailable label="hotspots" />;
  if (!data) return <HeatmapSkeleton />;
  if (data.files.length === 0) return <Unavailable label="no complexity data" />;

  const maxComplexity = Math.max(...data.files.map((f) => f.complexity), 1);
  const grouped = new Map<string, CodeHotspotsResponse["files"]>();
  for (const file of data.files) {
    const list = grouped.get(file.module) || [];
    if (list.length < 5) list.push(file);
    grouped.set(file.module, list);
  }

  return (
    <div ref={ref} style={{ padding: "12px 0" }}>
      {[...grouped.entries()].map(([mod, files]) => (
        <div key={mod} style={{ marginBottom: "12px" }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
            {mod}
          </div>
          {files.map((file) => {
            const ratio = file.complexity / maxComplexity;
            const color = ratio > 0.7 ? "var(--accent)" : ratio > 0.4 ? "var(--accent-dim)" : "var(--bg-elevated)";
            return (
              <div key={file.path} className="hotspot-row" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", opacity: 0 }}>
                <div style={{ width: `${Math.max(4, ratio * 120)}px`, height: "12px", background: color, borderRadius: "2px" }} />
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path.split("/").pop()}
                </span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", minWidth: "28px", textAlign: "right" }}>
                  {file.complexity}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "12px 0" }}>
      {[100, 80, 60, 45, 30].map((w) => (
        <div key={w} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: `${w}px`, height: "12px", background: "var(--bg-elevated)", borderRadius: "2px" }} />
          <div style={{ width: "60px", height: "12px", background: "var(--bg-elevated)", borderRadius: "2px" }} />
        </div>
      ))}
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>{label} unavailable</div>;
}
