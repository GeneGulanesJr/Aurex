# Mission Control UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Aurex frontend from a bare-bones dashboard into a dense, operational Mission Control console with three selectable color themes, proper empty state, telemetry bar, and wired anime.js animations.

**Architecture:** CSS custom properties for theming (`data-theme` on `<html>`), React hook for theme state with localStorage persistence. All components use inline `style={{}}` with `var(--token)` references — **no Tailwind utility classes for colors** (layout utilities like `flex`, `fixed`, `overflow-y-auto` are kept). Layout is a fixed CSS Grid: topbar → (sidebar | main) → telemetry bar. All animation stubs in `src/animations/` are already partially wired to components — they just need the new DOM structure and proper lifecycle management.

**Tech Stack:** React 19, Vite, Tailwind 4, anime.js v4 (`animejs`), Vitest, TypeScript. Pure unit tests with `vi.fn()` mocks — no `@testing-library/react`.

**Design Spec:** `DESIGN.md` at project root (linted, 0 errors, 49 warnings about multi-theme tokens — all intentional).

**Review fixes applied:** (see `2026-05-29-mission-control-ui-review.md`)
- C1: Removed `@theme` block — components use `var()` directly in inline styles
- C2: Google Fonts via `<link>` in index.html instead of `@import url()` in CSS
- C3: All build commands run from `packages/frontend/`
- C4: Task 10 merged into Task 9 (connecting overlay is part of App.tsx rewrite)
- I2: Added `document` SSR guard in useTheme
- I3: TopBar simplified to single `connected` boolean (all 3 status dots derive from it)
- I4: Added uptime timer hook in App.tsx
- I6: TelemetryBar prop mapping shown explicitly
- I7: Layout Tailwind utilities kept, only color classes replaced

---

## File Structure

### New Files
| File | Purpose |
|---|---|
| `packages/frontend/src/hooks/useTheme.ts` | Theme hook, localStorage persistence, pure resolveTheme function |
| `packages/frontend/src/hooks/useTheme.test.ts` | Tests for resolveTheme pure function |
| `packages/frontend/src/frame/TopBar.tsx` | Status bar with logo, connections, uptime, theme picker |
| `packages/frontend/src/frame/TelemetryBar.tsx` | Bottom bar with tokens, cost, agents, WS status |
| `packages/frontend/src/frame/EmptyState.tsx` | Mission control empty state with logo, steps, examples |
| `packages/frontend/src/frame/ThemePicker.tsx` | Three-dot theme selector component |

### Modified Files
| File | Change |
|---|---|
| `packages/frontend/src/styles.css` | Add 3 theme CSS variable blocks + base resets (no `@theme`, no `@import url()`) |
| `packages/frontend/index.html` | Add Google Fonts `<link>` tags with `display=swap` |
| `packages/frontend/src/App.tsx` | Full rewrite: TopBar + Grid + TelemetryBar + connecting overlay |
| `packages/frontend/src/active/MissionSidebar.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/active/NewMissionForm.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/active/EscalationOverlay.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/active/CheckpointPanel.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/active/DecisionActions.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/active/AttemptHistory.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/passive/StatusBoard.tsx` | Replace "No active mission" div with `<EmptyState />`, CSS vars |
| `packages/frontend/src/passive/AgentGrid.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/passive/AgentNode.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/passive/CostCounter.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/passive/StatusFeed.tsx` | Replace color Tailwind classes with CSS var references |
| `packages/frontend/src/passive/MilestoneBar.tsx` | Replace color Tailwind classes with CSS var references |

---

## Task 1: Theme System (useTheme hook + CSS variables)

**Files:**
- Create: `packages/frontend/src/hooks/useTheme.ts`
- Create: `packages/frontend/src/hooks/useTheme.test.ts`
- Modify: `packages/frontend/src/styles.css`
- Modify: `packages/frontend/index.html`

This is the foundation — everything else depends on CSS custom properties being available.

- [ ] **Step 1: Write failing test for useTheme**

Since we test without jsdom/renderHook, test only the pure logic function:

```typescript
// packages/frontend/src/hooks/useTheme.test.ts
import { describe, it, expect } from "vitest";
import { resolveTheme, type ThemeId, VALID_THEMES } from "./useTheme";

describe("resolveTheme", () => {
  it("returns solar-flare for null input", () => {
    expect(resolveTheme(null)).toBe("solar-flare");
  });

  it("returns the theme if valid", () => {
    expect(resolveTheme("frost-command")).toBe("frost-command");
    expect(resolveTheme("signal-red")).toBe("signal-red");
    expect(resolveTheme("solar-flare")).toBe("solar-flare");
  });

  it("returns solar-flare for invalid theme", () => {
    expect(resolveTheme("neon-pink")).toBe("solar-flare");
    expect(resolveTheme("")).toBe("solar-flare");
  });
});

describe("VALID_THEMES", () => {
  it("contains exactly three themes", () => {
    expect(VALID_THEMES).toEqual(["solar-flare", "frost-command", "signal-red"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/frontend/src/hooks/useTheme.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useTheme**

```typescript
// packages/frontend/src/hooks/useTheme.ts
import { useState, useCallback, useEffect } from "react";

export type ThemeId = "solar-flare" | "frost-command" | "signal-red";
export const VALID_THEMES: ThemeId[] = ["solar-flare", "frost-command", "signal-red"];

export function resolveTheme(raw: string | null): ThemeId {
  if (raw && (VALID_THEMES as string[]).includes(raw)) return raw as ThemeId;
  return "solar-flare";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("aurex-theme") : null;
    return resolveTheme(stored);
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    localStorage.setItem("aurex-theme", next);
  }, []);

  return { theme, setTheme, themes: VALID_THEMES } as const;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/frontend/src/hooks/useTheme.test.ts`
Expected: PASS

- [ ] **Step 5: Add CSS theme variables to styles.css**

```css
/* packages/frontend/src/styles.css */
@import "tailwindcss";

/* === Solar Flare (default) === */
[data-theme="solar-flare"],
:root {
  --accent: #e8920d;
  --accent-bright: #f5a623;
  --accent-dim: #a66808;
  --accent-glow: rgba(232, 146, 13, 0.15);
  --bg-deep: #0f0d0a;
  --bg-surface: #1a1714;
  --bg-elevated: #241f19;
  --bg-inset: #0c0a08;
  --border: #3d3529;
  --border-bright: #5a4d3a;
  --text-primary: #e8dcc8;
  --text-secondary: #9b8e7a;
  --text-muted: #6b5f4e;
}

/* === Frost Command === */
[data-theme="frost-command"] {
  --accent: #22d3ee;
  --accent-bright: #67e8f9;
  --accent-dim: #0891b2;
  --accent-glow: rgba(34, 211, 238, 0.12);
  --bg-deep: #080c11;
  --bg-surface: #0d1219;
  --bg-elevated: #141c26;
  --bg-inset: #060a0e;
  --border: #1e2d3d;
  --border-bright: #2a4158;
  --text-primary: #d4e3f0;
  --text-secondary: #7a99b5;
  --text-muted: #4a6580;
}

/* === Signal Red === */
[data-theme="signal-red"] {
  --accent: #ef4444;
  --accent-bright: #f87171;
  --accent-dim: #b91c1c;
  --accent-glow: rgba(239, 68, 68, 0.12);
  --bg-deep: #0e0c0c;
  --bg-surface: #161313;
  --bg-elevated: #1f1b1b;
  --bg-inset: #0a0909;
  --border: #332c2c;
  --border-bright: #4d4242;
  --text-primary: #e0d6d6;
  --text-secondary: #998888;
  --text-muted: #664f4f;
}

/* Semantic (shared across all themes) */
:root {
  --success: #4ade80;
  --warning: #facc15;
  --error: #ef4444;
  --info: #818cf8;
}

/* Base resets */
body {
  margin: 0;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: "Inter", -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}

*, *::before, *::after {
  box-sizing: border-box;
}
```

**Note:** No `@theme` block needed. All components use `var(--accent)` etc. directly in inline `style={{}}` objects. Tailwind utilities are only used for layout (`flex`, `grid`, `overflow-y-auto`, etc.), not for colors.

- [ ] **Step 6: Add Google Fonts to index.html**

Add `<link>` tags in `packages/frontend/index.html` `<head>`, before the app's `<script>` tag:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
```

This avoids render-blocking `@import` in CSS and uses `display=swap` for non-blocking font loading.

- [ ] **Step 7: Verify build**

Run: `cd packages/frontend && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds, no CSS errors

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/hooks/useTheme.ts packages/frontend/src/hooks/useTheme.test.ts packages/frontend/src/styles.css packages/frontend/index.html
git commit -m "feat(ui): add theme system with 3 palettes and CSS custom properties"
```

---

## Task 2: ThemePicker Component

**Files:**
- Create: `packages/frontend/src/frame/ThemePicker.tsx`

Small component — three colored dots that call `setTheme` on click. Each dot shows its theme's fixed accent color regardless of active theme.

- [ ] **Step 1: Create ThemePicker**

```typescript
// packages/frontend/src/frame/ThemePicker.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/frame/ThemePicker.tsx
git commit -m "feat(ui): add ThemePicker with 3-dot selector"
```

---

## Task 3: TopBar Component

**Files:**
- Create: `packages/frontend/src/frame/TopBar.tsx`

The 44px status bar with logo, connection dots, uptime, and theme picker. Uses a single `connected` boolean — when WS is connected, all three backend services (LaPis, Pinyx) are reachable through it.

- [ ] **Step 1: Create TopBar**

```typescript
// packages/frontend/src/frame/TopBar.tsx
import { ThemePicker } from "./ThemePicker";
import type { ThemeId } from "../hooks/useTheme";

interface TopBarProps {
  connected: boolean;
  missionCount: number;
  uptime: string;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );
}

function StatusItem({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: "11px",
        textTransform: "uppercase" as const,
        letterSpacing: "1px",
        color: "var(--text-secondary)",
      }}
    >
      <StatusDot color={color} />
      {label}
    </span>
  );
}

export function TopBar({ connected, missionCount, uptime, theme, onThemeChange }: TopBarProps) {
  const dotColor = connected ? "var(--success)" : "var(--error)";
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: "44px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 700,
            fontSize: "14px",
            letterSpacing: "3px",
            color: "var(--accent)",
            textShadow: "0 0 20px var(--accent-glow)",
          }}
        >
          AUREX
        </span>
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          v0.1.0
        </span>
      </div>

      {/* Center: Connection status */}
      <div style={{ display: "flex", gap: "20px" }}>
        <StatusItem color={dotColor} label="LAPIS CONNECTED" />
        <StatusItem color={dotColor} label="PINYX CONNECTED" />
        <StatusItem color={connected ? "var(--success)" : "var(--warning)"} label="SYSTEMS NOMINAL" />
      </div>

      {/* Right: Uptime + theme picker */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        <span>UPTIME <span style={{ color: "var(--accent)", fontWeight: 500 }}>{uptime}</span></span>
        <span>MISSIONS <span style={{ color: "var(--accent)", fontWeight: 500 }}>{missionCount}</span> ACTIVE</span>
        <ThemePicker current={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/frame/TopBar.tsx
git commit -m "feat(ui): add TopBar with logo, status dots, uptime, theme picker"
```

---

## Task 4: TelemetryBar Component

**Files:**
- Create: `packages/frontend/src/frame/TelemetryBar.tsx`

The 36px bottom strip showing tokens, cost, agents, WS status.

- [ ] **Step 1: Create TelemetryBar**

```typescript
// packages/frontend/src/frame/TelemetryBar.tsx
interface TelemetryBarProps {
  tokens: number;
  cost: number;
  agentCount: number;
  wsConnected: boolean;
  memory?: string;
}

const monoLabel = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "10px",
  letterSpacing: "0.5px",
  color: "var(--text-muted)",
} as const;

export function TelemetryBar({ tokens, cost, agentCount, wsConnected, memory }: TelemetryBarProps) {
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: "36px",
        background: "var(--bg-inset)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", gap: "20px" }}>
        <span style={monoLabel}>
          TOKENS <span style={{ color: "var(--text-secondary)" }}>{tokens.toLocaleString()}</span>
        </span>
        <span style={monoLabel}>
          COST <span style={{ color: "var(--accent)", fontWeight: 500 }}>${cost.toFixed(2)}</span>
        </span>
        <span style={monoLabel}>
          AGENTS <span style={{ color: "var(--text-secondary)" }}>{agentCount}</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        <span style={{ ...monoLabel, display: "flex", alignItems: "center", gap: "4px" }}>
          <span
            style={{
              display: "inline-block",
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: wsConnected ? "var(--success)" : "var(--error)",
            }}
          />
          WS
        </span>
        {memory && (
          <span style={monoLabel}>
            MEM <span style={{ color: "var(--text-secondary)" }}>{memory}</span>
          </span>
        )}
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/frame/TelemetryBar.tsx
git commit -m "feat(ui): add TelemetryBar with tokens, cost, agents, WS status"
```

---

## Task 5: EmptyState Component

**Files:**
- Create: `packages/frontend/src/frame/EmptyState.tsx`

The mission control welcome screen with animated logo, steps, and example cards.

- [ ] **Step 1: Create EmptyState**

```typescript
// packages/frontend/src/frame/EmptyState.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/frame/EmptyState.tsx
git commit -m "feat(ui): add EmptyState with animated logo, steps, example cards"
```

---

## Task 6: Refactor MissionSidebar — CSS Variables

**Files:**
- Modify: `packages/frontend/src/active/MissionSidebar.tsx`

Replace all **color-related** Tailwind classes with `var()` inline styles. **Keep layout Tailwind utilities** (`flex`, `flex-col`, `overflow-y-auto`, `truncate`, `min-w-0`, `cursor-pointer`, etc.). Only replace: `text-gray-*`, `bg-gray-*`, `bg-yellow-*`, `bg-blue-*`, `bg-green-*`, `bg-red-*`, `bg-purple-*`, `border-gray-*`, `hover:bg-*`, `hover:text-*`.

- [ ] **Step 1: Rewrite MissionSidebar with CSS vars**

The full component is ~90 lines. Color replacements:

| Original Tailwind | Replacement inline style |
|---|---|
| `w-64` (sidebar width) | `style={{ width: "280px" }}` |
| `border-r border-gray-800` | `style={{ borderRight: "1px solid var(--border)" }}` |
| `bg-gray-800` (selected item) | `style={{ background: "var(--bg-elevated)" }}` |
| `hover:bg-gray-800/50` | use `onMouseEnter/Leave` or conditional style |
| `text-gray-400` (headers) | `style={{ color: "var(--text-secondary)" }}` |
| `text-gray-600` (empty state) | `style={{ color: "var(--text-muted)" }}` |
| `text-gray-300` (mission desc) | `style={{ color: "var(--text-primary)" }}` |
| `text-gray-500` (queue pos) | `style={{ color: "var(--text-muted)" }}` |
| `text-gray-800/50` (border) | `style={{ borderBottom: "1px solid var(--border)" }}` |
| `bg-yellow-900 text-yellow-300` | `style={{ background: "var(--warning)", color: "var(--bg-deep)" }}` |
| `bg-blue-900 text-blue-300` | `style={{ background: "var(--info)", color: "var(--bg-deep)" }}` |
| `bg-purple-900 text-purple-300` | `style={{ background: "rgba(129, 140, 248, 0.2)", color: "var(--info)" }}` |
| `bg-green-900 text-green-300` | `style={{ background: "rgba(74, 222, 128, 0.2)", color: "var(--success)" }}` |
| `bg-red-900 text-red-300` | `style={{ background: "rgba(239, 68, 68, 0.2)", color: "var(--error)" }}` |
| `bg-gray-800 text-gray-400` (default badge) | `style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}` |
| `hover:text-red-400` (abort) | `onMouseEnter/Leave` toggling `color: "var(--error)"` |

The `statusBadge` function returns inline style objects instead of Tailwind class strings. The props interface and callbacks stay identical.

- [ ] **Step 2: Verify build**

Run: `cd packages/frontend && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/MissionSidebar.tsx
git commit -m "refactor(ui): MissionSidebar uses CSS custom properties"
```

---

## Task 7: Refactor Passive Components — CSS Variables

**Files:**
- Modify: `packages/frontend/src/passive/AgentGrid.tsx`
- Modify: `packages/frontend/src/passive/AgentNode.tsx`
- Modify: `packages/frontend/src/passive/CostCounter.tsx`
- Modify: `packages/frontend/src/passive/StatusFeed.tsx`
- Modify: `packages/frontend/src/passive/MilestoneBar.tsx`
- Modify: `packages/frontend/src/passive/StatusBoard.tsx`

**Rule:** Keep layout Tailwind utilities (`grid`, `grid-cols-4`, `gap-4`, `flex`, `overflow-y-auto`, `rounded-lg`, `p-4`, etc.). Only replace **color-related** classes with inline `style={{}}` using `var()`.

Key changes per file:

**AgentGrid.tsx**: `text-gray-500` → `style={{ color: "var(--text-muted)" }}`. Grid gap and cols stay as Tailwind.

**AgentNode.tsx**: `statusColor` map → CSS vars: `spawned: "var(--warning)"`, `working: "var(--accent)"`, `committing: "var(--info)"`, `completed: "var(--success)"`, `timed_out: "var(--warning)"`, `failed: "var(--error)"`. Card: `bg-surface` → `style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}`. `text-gray-400` → `style={{ color: "var(--text-secondary)" }}`.

**CostCounter.tsx**: `bg-surface` → `style={{ background: "var(--bg-surface)" }}`. `text-gray-400` → `style={{ color: "var(--text-secondary)" }}`. `font-mono text-3xl` → `style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "28px", color: "var(--text-primary)" }}`. `text-gray-500` → `style={{ color: "var(--text-muted)" }}`.

**StatusFeed.tsx**: `bg-surface` → `style={{ background: "var(--bg-surface)" }}`. `text-gray-400` → `style={{ color: "var(--text-secondary)" }}`. `text-gray-300` → `style={{ color: "var(--text-primary)" }}`. `border-gray-800` → `style={{ borderBottom: "1px solid var(--border)" }}`. `text-gray-600` → `style={{ color: "var(--text-muted)" }}`.

**MilestoneBar.tsx**: `bg-surface` → `style={{ background: "var(--bg-surface)" }}`. `text-gray-400` → `style={{ color: "var(--text-secondary)" }}`. `bg-gray-700` (track) → `style={{ background: "var(--bg-elevated)" }}`. `bg-accent` (fill) → `style={{ background: "var(--accent)" }}`. `text-gray-500` → `style={{ color: "var(--text-muted)" }}`.

**StatusBoard.tsx**: When no mission, render `<EmptyState />` instead of `<div className="text-gray-500 text-center py-20">No active mission</div>`. Import `EmptyState` from `../frame/EmptyState`.

- [ ] **Step 1: Refactor all 6 passive components**

Apply CSS variable replacements to each file. Logic and animations unchanged.

- [ ] **Step 2: Verify build**

Run: `cd packages/frontend && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All existing tests pass (263+)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/passive/
git commit -m "refactor(ui): passive components use CSS custom properties"
```

---

## Task 8: Refactor Active Components — CSS Variables

**Files:**
- Modify: `packages/frontend/src/active/NewMissionForm.tsx`
- Modify: `packages/frontend/src/active/EscalationOverlay.tsx`
- Modify: `packages/frontend/src/active/CheckpointPanel.tsx`
- Modify: `packages/frontend/src/active/DecisionActions.tsx`
- Modify: `packages/frontend/src/active/AttemptHistory.tsx`

**Rule:** Keep layout Tailwind utilities (`flex`, `items-center`, `gap-*`, `fixed`, `inset-0`, `z-50`, `max-w-*`, `w-full`, `rounded-xl`, `p-8`, etc.). Only replace **color-related** classes.

**EscalationOverlay.tsx**: `bg-black/60` stays (fixed overlay color, not theme-dependent). `bg-gray-800` → `style={{ background: "var(--bg-surface)" }}`. `shadow-2xl` stays. `text-gray-500` → `style={{ color: "var(--text-muted)" }}`. `hover:text-gray-300` → `onMouseEnter/Leave` toggling color.

**NewMissionForm.tsx**, **CheckpointPanel.tsx**, **DecisionActions.tsx**, **AttemptHistory.tsx**: Same pattern — keep layout classes, replace color classes with `var()` inline styles.

- [ ] **Step 1: Refactor all 5 active components**

- [ ] **Step 2: Verify build**

Run: `cd packages/frontend && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/
git commit -m "refactor(ui): active components use CSS custom properties"
```

---

## Task 9: Wire App.tsx — Full Mission Control Layout

**Files:**
- Modify: `packages/frontend/src/App.tsx`

This is the integration task. Full rewrite of App.tsx with: connecting overlay, TopBar, CSS Grid layout, TelemetryBar, uptime timer. (Former Task 10 merged here.)

- [ ] **Step 1: Rewrite App.tsx**

Key changes:
1. Import `useTheme`, `TopBar`, `TelemetryBar`
2. Call `useTheme()` at top of App
3. Add uptime timer using `useState` + `useEffect` with `setInterval`
4. Replace the `if (!connected)` branch with styled Mission Control connecting overlay
5. Replace `<header>` with `<TopBar>` passing `connected`, mission count, uptime, theme props
6. Wrap sidebar + main in a CSS Grid: `grid-template-columns: 280px 1fr; grid-template-rows: 1fr 36px`
7. Add `<TelemetryBar>` spanning bottom of the grid with data from `useMission` state
8. When StatusBoard has no mission, it renders EmptyState (done in Task 7)

**Connecting overlay** (replaces current `if (!connected)` branch):

```tsx
if (!connected) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--bg-deep)",
      color: "var(--text-muted)",
      fontFamily: '"JetBrains Mono", monospace',
      letterSpacing: "4px",
      fontSize: "13px",
    }}>
      <div style={{
        fontSize: "48px",
        fontWeight: 700,
        letterSpacing: "12px",
        color: "var(--accent)",
        marginBottom: "16px",
      }}>AUREX</div>
      CONNECTING...
    </div>
  );
}
```

**Uptime timer** (add inside App, after `useTheme()`):

```tsx
const [uptime, setUptime] = useState("00:00:00");
useEffect(() => {
  if (!connected) return;
  const start = Date.now();
  const fmt = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };
  setUptime(fmt());
  const id = setInterval(() => setUptime(fmt()), 1000);
  return () => clearInterval(id);
}, [connected]);
```

**Main layout** (replaces current return):

```tsx
return (
  <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
    <TopBar
      connected={connected}
      missionCount={missionsState.missions.filter(m =>
        ["queued", "planning", "executing", "waiting_checkpoint"].includes(m.state)
      ).length}
      uptime={uptime}
      theme={theme}
      onThemeChange={setTheme}
    />
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gridTemplateRows: "1fr 36px", flex: 1, overflow: "hidden" }}>
      <MissionSidebar
        missions={missionsState.missions}
        selectedMissionId={missionsState.selectedMissionId}
        onSelect={selectMission}
        onRemove={removeMission}
        onCreateMission={handleCreateMission}
      />
      <main style={{ overflowY: "auto", background: "var(--bg-deep)" }}>
        <StatusBoard
          mission={state.mission}
          milestones={state.milestones}
          workers={state.activeWorkers}
          cost={state.cost}
          events={eventsRef.current}
          blurred={!!state.escalation}
        />
      </main>
      <TelemetryBar
        tokens={state.cost?.totalTokens ?? 0}
        cost={state.cost?.totalCost ?? 0}
        agentCount={state.activeWorkers.length}
        wsConnected={connected}
      />
    </div>
    {state.escalation?.type === "escalation" && (
      <EscalationOverlay
        event={state.escalation}
        onDecision={handleDecision}
        onDismiss={() => dispatch({ type: "CLEAR_ESCALATION" })}
      />
    )}
  </div>
);
```

**New imports needed at top of App.tsx:**

```tsx
import { useState } from "react";
import { useTheme } from "./hooks/useTheme";
import { TopBar } from "./frame/TopBar";
import { TelemetryBar } from "./frame/TelemetryBar";
```

(Remove the `useCallback, useRef` import if no longer needed, or keep if other hooks still use them. `useRef` is still needed for `eventsRef`. `useCallback` is still needed for `combinedHandler`, `handleDecision`, `handleCreateMission`.)

- [ ] **Step 2: Verify build + all tests**

Run: `cd packages/frontend && npx vite build --mode development 2>&1 | tail -5`
Run: `npx vitest run`
Expected: Build succeeds, all tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "feat(ui): wire Mission Control layout with TopBar, TelemetryBar, Grid, connecting overlay"
```

---

## Task 10: Final Verification — Build, Tests, Docker E2E

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (263+ including new useTheme tests)

- [ ] **Step 2: Run type check**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run production build**

Run: `cd packages/frontend && npx vite build`
Expected: Build succeeds with no warnings

- [ ] **Step 4: Run Docker E2E tests**

Run: `docker compose -f docker-compose.e2e.yml up --build -d && sleep 5 && bash scripts/e2e-docker.sh`
Expected: 18/18 assertions pass

- [ ] **Step 5: Visual verification**

Run: `cd packages/frontend && npx vite dev` and open browser. Verify:
- Default theme is Solar Flare (amber accent)
- Theme picker dots in topbar switch themes instantly
- TopBar shows connection status with colored dots (all green when connected)
- Sidebar shows "NO ACTIVE MISSIONS" with styled empty state
- Main area shows EmptyState with animated entrance
- TelemetryBar shows at bottom with WS status
- All hover states show accent glow
- Connecting overlay shows styled AUREX logo when WS is disconnected

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(ui): final adjustments after visual verification"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: DESIGN.md covers themes, typography, layout, components, motion, do's/don'ts. Plan implements all sections.
- [x] **Placeholder scan**: No TBD, TODO, or "implement later". Every step has code or exact commands.
- [x] **Type consistency**: `ThemeId` type used consistently across all files. `useTheme` returns `{ theme, setTheme, themes }`.
- [x] **Animation wiring**: AgentNode → createPulse/createSpin/createIdle (already wired). CostCounter → animateCounter (already wired). MilestoneBar → animateProgress (already wired). StatusFeed → staggerEntrance (already wired). EmptyState → anime.js stagger entrance (new). EscalationOverlay → enterActive/exitActive (already wired). StatusBoard → dimPassive/restorePassive (already wired).
- [x] **No new dependencies**: All packages already in package.json (animejs, react, tailwindcss).
- [x] **Test strategy**: Pure unit tests with vi.fn() mocks. New test only for useTheme pure logic (resolveTheme). No jsdom needed.
- [x] **Review fixes**: C1-C4 (critical) and I2-I7 (important) all applied inline.
- [x] **Build commands**: All run from `packages/frontend/` (C3 fix verified).
- [x] **No @theme block**: Components use `var()` directly (C1 fix).
- [x] **No @import url()**: Fonts via `<link>` in index.html (C2 fix).
- [x] **Task 10 merged**: Connecting overlay is part of Task 9 App.tsx rewrite (C4 fix).
- [x] **TopBar simplified**: Single `connected` prop, not lapisConnected/pinyxConnected (I3 fix).
- [x] **Uptime timer added**: useState + useEffect with setInterval (I4 fix).
- [x] **TelemetryBar props mapped**: Shows exact data flow from state (I6 fix).
- [x] **Layout utilities kept**: Only color Tailwind classes replaced (I7 fix).
