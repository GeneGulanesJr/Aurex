import type { ThemeId } from "../hooks/useTheme";

interface ThemePickerProps {
  current: ThemeId;
  onChange: (theme: ThemeId) => void;
}

const themeColors: Record<ThemeId, { bg: string; label: string }> = {
  "solar-flare": { bg: "#e8920d", label: "Solar Flare" },
  "frost-command": { bg: "#22d3ee", label: "Frost Command" },
  "signal-red": { bg: "#ef4444", label: "Signal Red" },
};

export function ThemePicker({ current, onChange }: ThemePickerProps) {
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      {(Object.entries(themeColors) as [ThemeId, { bg: string; label: string }][]).map(([id, { bg, label }]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={label}
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
      ))}
    </div>
  );
}
