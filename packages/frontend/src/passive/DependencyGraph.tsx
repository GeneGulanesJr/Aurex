import { useEffect, useMemo, useRef } from "react";
import { animate, stagger } from "animejs";
import type { CodeGraphResponse } from "../api";

const COL_WIDTH = 120;
const COL_GAP = 40;
const ROW_HEIGHT = 40;
const NODE_RADIUS_MIN = 6;
const NODE_RADIUS_MAX = 14;
const SVG_PADDING = 24;

export function DependencyGraph({ data, error }: { data: CodeGraphResponse | null; error?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const moduleMap = new Map<string, CodeGraphResponse["nodes"]>();
    for (const node of data.nodes) {
      const list = moduleMap.get(node.module) || [];
      list.push(node);
      moduleMap.set(node.module, list);
    }
    const modules = [...moduleMap.keys()];
    const positions = new Map<string, { x: number; y: number; r: number }>();
    let maxY = 0;

    modules.forEach((mod, colIdx) => {
      const nodes = [...(moduleMap.get(mod) || [])].sort((a, b) => b.importance - a.importance);
      nodes.forEach((node, rowIdx) => {
        const x = SVG_PADDING + colIdx * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2;
        const y = SVG_PADDING + 16 + rowIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
        const r = NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * Math.max(0, Math.min(1, node.importance));
        positions.set(node.id, { x, y, r });
        maxY = Math.max(maxY, y + ROW_HEIGHT / 2);
      });
    });

    return {
      positions,
      modules,
      svgWidth: SVG_PADDING * 2 + modules.length * COL_WIDTH + Math.max(0, modules.length - 1) * COL_GAP,
      svgHeight: SVG_PADDING + maxY,
    };
  }, [data]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout || !data) return;
    animate(svg.querySelectorAll(".graph-node"), {
      opacity: [0, 1],
      scale: [0.6, 1],
      delay: stagger(80),
      duration: 500,
      ease: "outExpo",
      onComplete: () => {
        const edges = svg.querySelectorAll<SVGPathElement>(".graph-edge");
        edges.forEach((edge) => {
          const len = edge.getTotalLength();
          edge.style.strokeDasharray = `${len}`;
          edge.style.strokeDashoffset = `${len}`;
        });
        animate(edges, {
          strokeDashoffset: 0,
          duration: 600,
          delay: stagger(15),
          ease: "linear",
        });
      },
    });
  }, [data, layout]);

  if (error) return <Unavailable label="graph" />;
  if (!data || !layout) return <GraphSkeleton />;
  if (data.nodes.length === 0) return <Unavailable label="no files to graph" />;

  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const cycleEdges = new Set(
    data.cycles.flatMap((cycle) => cycle.slice(0, -1).map((item, i) => `${item}→${cycle[i + 1]}`)),
  );

  return (
    <div style={{ padding: "12px 0", overflowX: "auto" }}>
      <svg ref={svgRef} width={layout.svgWidth} height={layout.svgHeight} viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`} style={{ display: "block", maxWidth: "100%" }}>
        {layout.modules.map((mod, i) => (
          <text key={mod} x={SVG_PADDING + i * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2} y={14} textAnchor="middle" fill="var(--text-muted)" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            {mod}
          </text>
        ))}

        {data.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)).map((edge, i) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2 + (i % 2 === 0 ? 20 : -20);
          const isCycle = cycleEdges.has(`${edge.from}→${edge.to}`);
          return <path key={`${edge.from}-${edge.to}-${i}`} className="graph-edge" d={`M${from.x},${from.y} Q${midX},${(from.y + to.y) / 2} ${to.x},${to.y}`} fill="none" stroke={isCycle ? "var(--error)" : "var(--border)"} strokeWidth={isCycle ? 1.5 : 1} opacity={isCycle ? 0.8 : 0.42} />;
        })}

        {data.nodes.map((node) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const color = node.importance > 0.7 ? "var(--accent)" : node.importance > 0.4 ? "var(--accent-dim)" : "var(--text-muted)";
          return (
            <g key={node.id} className="graph-node" opacity={0}>
              <circle cx={pos.x} cy={pos.y} r={pos.r} fill={color} stroke="var(--border)" strokeWidth={1} />
              <text x={pos.x} y={pos.y + pos.r + 10} textAnchor="middle" fill="var(--text-secondary)" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "8px" }}>
                {node.id.length > 14 ? `${node.id.slice(0, 12)}…` : node.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function GraphSkeleton() {
  return <div style={{ height: "120px", background: "var(--bg-elevated)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", color: "var(--text-muted)", letterSpacing: "2px" }}>LOADING GRAPH…</span></div>;
}

function Unavailable({ label }: { label: string }) {
  return <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>{label} unavailable</div>;
}
