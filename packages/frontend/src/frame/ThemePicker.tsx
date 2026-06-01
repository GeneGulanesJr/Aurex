import { useLayoutEffect, useRef, useState } from "react";
import type { ThemeId } from "../hooks/useTheme";

interface ThemePickerProps {
  current: ThemeId;
  onChange: (theme: ThemeId) => void;
}

const themeIds: ThemeId[] = ["solar-flare", "frost-command", "signal-red"];
const themeLabels: Record<ThemeId, string> = {
  "solar-flare": "Solar Flare",
  "frost-command": "Frost Command",
  "signal-red": "Signal Red",
};

export function ThemePicker({ current, onChange }: ThemePickerProps) {
  const [colors, setColors] = useState<Record<ThemeId, string>>({
    "solar-flare": "#e8920d",
    "frost-command": "#22d3ee",
    "signal-red": "#ef4444",
  });
  const measured = useRef(false);

  // Read actual accent colors from each theme's CSS variables once
  useLayoutEffect(() => {
    if (measured.current) return;
    measured.current = true;

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);

    const resolved: Record<string, string> = {};
    for (const id of themeIds) {
      probe.setAttribute("data-theme", id);
      const raw = getComputedStyle(probe).getPropertyValue("--accent").trim();
      if (raw) resolved[id] = raw;
    }

    document.body.removeChild(probe);
    if (Object.keys(resolved).length === themeIds.length) {
      setColors(resolved as Record<ThemeId, string>);
    }
  }, []);

  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      {themeIds.map((id) => {
        const bg = colors[id];
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            title={themeLabels[id]}
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: bg,
              border: id === current ? `2px solid ${bg}` : "2px solid transparent",
              boxShadow: id === current ? `0 0 8px ${bg}` : "none",
              cursor: "pointer",
              padding: 0,
              outline: "none",
              opacity: id === current ? 1 : 0.5,
              transition: "opacity 0.15s, box-shadow 0.15s",
            }}
          />
        );
      })}
    </div>
  );
}
