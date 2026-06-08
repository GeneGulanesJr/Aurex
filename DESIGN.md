---
version: "alpha"
name: aurex-mission-control
description: >
  Mission Control design system for Aurex — a dense, operational dashboard
  with telemetry bars, status indicators, and three selectable color themes.
  Dark-mode-native with hairline borders and accent-colored glow interactions.

colors:
  # Solar Flare (default)
  sf-accent: "#e8920d"
  sf-accent-bright: "#f5a623"
  sf-accent-dim: "#a66808"
  sf-accent-glow: "#3b2706"
  sf-bg-deep: "#0f0d0a"
  sf-bg-surface: "#1a1714"
  sf-bg-elevated: "#241f19"
  sf-bg-inset: "#0c0a08"
  sf-border: "#3d3529"
  sf-border-bright: "#5a4d3a"
  sf-text-primary: "#e8dcc8"
  sf-text-secondary: "#9b8e7a"
  sf-text-muted: "#6b5f4e"
  # Frost Command
  fc-accent: "#22d3ee"
  fc-accent-bright: "#67e8f9"
  fc-accent-dim: "#0891b2"
  fc-accent-glow: "#071f26"
  fc-bg-deep: "#080c11"
  fc-bg-surface: "#0d1219"
  fc-bg-elevated: "#141c26"
  fc-bg-inset: "#060a0e"
  fc-border: "#1e2d3d"
  fc-border-bright: "#2a4158"
  fc-text-primary: "#d4e3f0"
  fc-text-secondary: "#7a99b5"
  fc-text-muted: "#4a6580"
  # Signal Red
  sr-accent: "#ef4444"
  sr-accent-bright: "#f87171"
  sr-accent-dim: "#b91c1c"
  sr-accent-glow: "#2a0c0c"
  sr-bg-deep: "#0e0c0c"
  sr-bg-surface: "#161313"
  sr-bg-elevated: "#1f1b1b"
  sr-bg-inset: "#0a0909"
  sr-border: "#332c2c"
  sr-border-bright: "#4d4242"
  sr-text-primary: "#e0d6d6"
  sr-text-secondary: "#998888"
  sr-text-muted: "#664f4f"
  # Semantic (shared across themes)
  success: "#4ade80"
  warning: "#facc15"
  error: "#ef4444"
  info: "#818cf8"

typography:
  display-xl:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: 12px
  heading-sm:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 2px
  body:
    fontFamily: "Inter, -apple-system, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: 0
  body-emphasis:
    fontFamily: "Inter, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 2px
  mono-value:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontFamily: "Inter, -apple-system, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  none: 0px
  sm: 3px
  md: 4px
  lg: 6px
  full: 9999px

spacing:
  topbar-height: 44px
  telemetry-height: 36px
  sidebar-width: 280px
  section-padding: 16px
  item-gap: 8px
  card-padding: 12px

components:
  topbar:
    backgroundColor: "var(--bg-surface)"
    border: "1px solid var(--border)"
    height: "{spacing.topbar-height}"
  sidebar:
    backgroundColor: "var(--bg-surface)"
    border: "1px solid var(--border)"
    width: "{spacing.sidebar-width}"
  telemetry-bar:
    backgroundColor: "var(--bg-inset)"
    border: "1px solid var(--border)"
    height: "{spacing.telemetry-height}"
    typography: "{typography.label}"
  status-dot:
    size: 6px
    rounded: "{rounded.full}"
    backgroundColor: "{colors.success}"
    boxShadow: "0 0 6px"
  btn-primary:
    backgroundColor: "var(--accent)"
    textColor: "var(--bg-deep)"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.label}"
    fontWeight: 600
  btn-outline:
    backgroundColor: "transparent"
    textColor: "var(--accent)"
    border: "1px solid var(--accent-dim)"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.label}"
  example-card:
    backgroundColor: "var(--bg-surface)"
    border: "1px solid var(--border)"
    rounded: "{rounded.lg}"
    padding: "{spacing.card-padding}px"
---

# Aurex Mission Control — Design System

## Overview

Aurex's UI treats the screen like a **mission control console**: every pixel earns its place, information density is high but never chaotic, and the operator always knows system status at a glance. The layout is fixed — topbar, sidebar, main content area, and telemetry bar — providing a consistent operational frame. Three selectable color themes (Solar Flare, Frost Command, Signal Red) let the user personalize the atmosphere while maintaining identical layout and component behavior.

The system is dark-mode-native with a 4-step surface ladder, hairline borders, and accent-colored glow on interactive elements. Typography uses Inter for body text and JetBrains Mono for all labels, values, status readouts, and the logo. The visual language borrows from Linear's surface-luminance stacking and Raycast's hairline precision, but adds warmth through theme-specific accent colors and a glow-on-interaction pattern.

## Colors

### Three Themes

All three themes share identical structure — only the CSS custom properties change. Themes are applied via `data-theme` attribute on `<html>`.

| Role | Solar Flare | Frost Command | Signal Red |
|---|---|---|---|
| Accent | `#e8920d` amber | `#22d3ee` cyan | `#ef4444` crimson |
| Accent Bright | `#f5a623` gold | `#67e8f9` ice | `#f87171` salmon |
| Accent Dim | `#a66808` dark amber | `#0891b2` teal | `#b91c1c` dark red |
| Background Deep | `#0f0d0a` warm black | `#080c11` cool black | `#0e0c0c` neutral black |
| Background Surface | `#1a1714` warm charcoal | `#0d1219` navy charcoal | `#161313` dark rose |
| Background Elevated | `#241f19` warm panel | `#141c26` cool panel | `#1f1b1b` rose panel |
| Background Inset | `#0c0a08` warm well | `#060a0e` cool well | `#0a0909` neutral well |
| Border | `#3d3529` warm gray | `#1e2d3d` steel blue | `#332c2c` warm gray |
| Border Bright | `#5a4d3a` warm light | `#2a4158` steel light | `#4d4242` rose light |
| Text Primary | `#e8dcc8` warm white | `#d4e3f0` cool white | `#e0d6d6` silver |
| Text Secondary | `#9b8e7a` warm tan | `#7a99b5` cool slate | `#998888` rose gray |
| Text Muted | `#6b5f4e` warm dust | `#4a6580` steel dust | `#664f4f` rose dust |

### Semantic Colors (shared)

- **Success** (`#4ade80`): Connection status dots, "systems nominal" indicators
- **Warning** (`#facc15`): Caution states, throttled operations
- **Error** (`#ef4444`): Failure states, disconnected indicators
- **Info** (`#818cf8`): Informational highlights

## Typography

### Font Families

- **Inter** with OpenType features `cv01` + `ss03` for all body and UI text — the geometric alternates give it a cleaner, more engineered character
- **JetBrains Mono** for all labels, status readouts, telemetry values, and the AUREX logo — provides the technical/operational feel

### Hierarchy

| Role | Font | Size | Weight | Tracking | Use |
|---|---|---|---|---|---|
| Display XL | JetBrains Mono | 48px | 700 | 12px | AUREX logo in empty state |
| Heading SM | JetBrains Mono | 11px | 500 | 2px, uppercase | Section headers (MISSIONS, TOKENS) |
| Body | Inter | 15px | 400 | normal | Descriptions, instructions |
| Body Emphasis | Inter | 14px | 500 | normal | Sidebar items, card titles |
| Label | JetBrains Mono | 10px | 500 | 2px, uppercase | Telemetry bar, badges |
| Mono Value | JetBrains Mono | 11px | 500 | normal | Numbers, counts, timestamps |
| Caption | Inter | 13px | 400 | normal | Subtle descriptions, empty states |

## Layout

### Frame Structure

```
┌─────────────────────────────────────────────────┐
│ TOPBAR (44px) — logo, status dots, uptime       │
├──────────┬──────────────────────────────────────┤
│ SIDEBAR  │ MAIN CONTENT                         │
│ (280px)  │ (flex: 1)                            │
│          │                                      │
│ missions │ empty state / mission view            │
│ + button │                                      │
│ cost     │                                      │
├──────────┴──────────────────────────────────────┤
│ TELEMETRY BAR (36px) — tokens, cost, agents, WS │
└─────────────────────────────────────────────────┘
```

### Grid

- CSS Grid with `grid-template-columns: 280px 1fr` and `grid-template-rows: 1fr 36px`
- Sidebar and main fill available height minus topbar
- Telemetry bar spans full width (`grid-column: 1 / -1`)

### Spacing Scale

- Based on 8px grid with 4px half-steps for micro-adjustments
- Section padding: 16px
- Card padding: 12px
- Item gap: 8px
- Topbar/telemetry are fixed height; sidebar is fixed width

## Elevation & Depth

### Surface Ladder

Each theme provides 4 background levels from deepest to most elevated:

1. **bg-inset** — Telemetry bar, deep wells, inset areas. The lowest point.
2. **bg-deep** — Main content background. The void canvas.
3. **bg-surface** — Sidebar, topbar, cards. Structural panels.
4. **bg-elevated** — Hover states, highlighted elements, pop-ups.

Elevation is communicated through **background luminance stepping**, not shadows. On dark surfaces, traditional dark-on-dark shadows are invisible, so the surface ladder provides the primary depth signal.

### Glow on Interaction

Hover states add `box-shadow: 0 0 16px var(--accent-glow)` — a subtle accent-colored halo. This is the primary "active" signal, replacing traditional shadow elevation. The glow color matches the theme's accent at low opacity.

### Hairline Borders

All structural borders use `var(--border)` at 1px. No 2px borders, no thick separators. Density is achieved through background contrast, not border weight. Bright borders (`var(--border-bright)`) appear only on hover states.

## Shapes

| Token | Radius | Use |
|---|---|---|
| none | 0px | Layout edges, full-bleed sections |
| sm | 3px | Inline badges, code highlights |
| md | 4px | Buttons, inputs |
| lg | 6px | Cards, panels, dropdowns |
| full | 9999px | Status dots, pills |

Status dots are 6px circles with matching-color glow (`box-shadow`). Connected = green, warning = yellow, error = red.

## Frame Components

The persistent frame around every dashboard view — topbar, sidebar, telemetry bar, and the controls they contain.

### Topbar
- Full-width bar at 44px height
- Left: AUREX logo (JetBrains Mono, 700, accent color with text-shadow glow) + version label
- Center: Connection status items with colored dots (LAPIS CONNECTED, PINYX CONNECTED, SYSTEMS NOMINAL)
- Right: Uptime counter, active mission count, elapsed time — all in mono-value style
- Background: `var(--bg-surface)`, bottom hairline border

### Sidebar
- 280px fixed width
- Header: "MISSIONS" label + count (e.g. "0 / 5")
- New Mission button: primary (solid accent bg, dark text) or outline (transparent, accent border) depending on theme
- Empty state: dashed-border icon + "NO ACTIVE MISSIONS" text
- Footer: "TOTAL SPENT" label + cost value in accent color

### Telemetry Bar
- 36px height, spans full width
- Background: `var(--bg-inset)` — the deepest surface
- Left: TOKENS count, COST in accent, AGENTS count
- Right: WebSocket status (dot + "WS"), memory usage
- All values in JetBrains Mono 10px

### Example Cards
- Used in empty state to show clickable mission examples
- Surface background, hairline border, 6px radius
- Hover: border brightens to accent-dim, background elevates, accent glow appears
- Left accent icon + mono-text mission description

### Buttons
- **Primary** (`btn-primary`): Solid accent background, dark text. Used for New Mission CTA. Hover brightens and adds glow.
- **Outline** (`btn-outline`): Transparent with accent-dim border. Used for secondary actions and in Frost Command theme. Hover fills with accent-glow background and adds glow shadow.

### Theme Picker
- Three small colored circles in the topbar (amber, cyan, red)
- Clicking one instantly switches `data-theme` on `<html>`
- Selection persists in `localStorage` (theme preference) and `sessionStorage` (UI return state across OAuth callbacks, per `2026-06-07-oauth-state-preservation`)
- Selection defaults to `solar-flare` if nothing is stored
- React context (`useTheme`) provides current theme and setter

## Mission Control Layout

The active mission experience is a **composed layout** rather than a single monolithic component. Four pieces fit together:

### `MissionPipeline` (passive/MissionPipeline.tsx)
The main composed layout. Splits the work area into a **left rail** (mission status + milestone progress) and a **right inspector** (`MissionInspectorPanel`). Replaces the older single-surface `StatusBoard` for missions that have begun executing.

### `MissionSummaryHeader` (passive/MissionSummaryHeader.tsx)
A compact mission header / status strip. Renders mission id, description, current milestone, elapsed time, and a risk summary. Sits at the top of the left rail.

### `MissionActivityFeed` (passive/MissionActivityFeed.tsx)
A unified live feed that replaces the older separate `PlanningLog` + `EventStream` presentations. Renders agent spawns, tool calls, cost updates, validator verdicts, and checkpoint escalations in a single scannable column. Pure display helpers in `missionUiModel.ts` normalize the event stream into a stable order for the feed.

### `MissionInspectorPanel` (passive/MissionInspectorPanel.tsx)
A right-side **tabbed inspector** with three tabs:
- **Activity** — live agent events for the focused mission
- **Code** — `CodeContextPanel` summary, dependency graph, and hotspot heatmap for the mission's target repo
- **Supply Chain** — `SupplyChainPanel` showing the latest Bumblebee supply-chain scan results

Tab availability is derived from data presence in `missionUiModel.ts` (pure helpers), not from prop drilling.

## Panels

The right inspector and overview surfaces are composed from a set of focused panels. Each panel is small, single-purpose, and reads from a typed hook.

| Panel | File | Purpose |
|---|---|---|
| `RepoOverviewPanel` | `passive/RepoOverviewPanel.tsx` | First-paint view of a repo (size, languages, last commit, mission suggestions) |
| `CodeContextPanel` | `passive/CodeContextPanel.tsx` | Code summary + graph hotspots for the focused mission |
| `SupplyChainPanel` | `passive/SupplyChainPanel.tsx` | Latest Bumblebee supply-chain scan with severity counts |
| `DependencyGraph` | `passive/DependencyGraph.tsx` | Lightweight graph view of repo dependencies |
| `HotspotHeatmap` | `passive/HotspotHeatmap.tsx` | File-level churn heatmap from code-context data |
| `ArchitectureSummary` | `passive/ArchitectureSummary.tsx` | High-level architecture read-out for the repo |
| `MissionComplete` | `passive/MissionComplete.tsx` | Terminal-state celebration panel for completed missions |
| `StatusBoard` | `passive/StatusBoard.tsx` | Legacy empty-state board; kept for the no-mission landing state |

## Integrations Panel

A tabbed panel for configuring the gateway and external services, accessed from the sidebar.

| Tab | File | Purpose |
|---|---|---|
| **Connection** | `active/PinyxConnectionTab.tsx` | PiNyx reachability check, configured provider list, "test" button per provider |
| **Keys** | `active/PinyxKeysTab.tsx` | Per-provider API key entry for the three built-ins (Kilo Code, Z.AI Coding, MiniMax) plus custom OpenAI-compatible providers |
| **Models** | `active/PinyxModelsTab.tsx` | Model catalog per provider with the model used for orchestrator / worker / validator / research hints |
| **Settings** | `active/SettingsPanel.tsx` | Workspace-level toggles |
| **Quota** | `active/QuotaPanel.tsx` | Coding-plan quota state — burn vs window — with manual reset |
| **Mutation** | `active/MutationPanel.tsx` | Stryker run history + diff mutation score for the focused repo |

The Integrations panel is reached via the sidebar and renders inside the main content area; the topbar/sidebar/telemetry frame is unchanged.

## Components

Components are organized by directory under `packages/frontend/src/`.

### Frame (`frame/`)
- **TopBar** — logo, connection status dots, uptime, active mission count, theme picker
- **TelemetryBar** — live tokens, cost, agents, WebSocket status
- **ThemePicker** — three colored circles that switch `data-theme` on `<html>`

### Passive (`passive/`)
- **MissionPipeline** — composed main layout (left rail + right inspector)
- **MissionSummaryHeader** — compact mission status strip
- **MissionActivityFeed** — unified live feed
- **MissionInspectorPanel** — tabbed right inspector (Activity / Code / Supply Chain)
- **RepoOverviewPanel**, **CodeContextPanel**, **SupplyChainPanel**, **DependencyGraph**, **HotspotHeatmap**, **ArchitectureSummary** — focused panels
- **StatusBoard** — legacy empty-state board
- **MissionComplete** — terminal-state celebration
- **missionUiModel.ts** — pure display helpers (progress, feed normalization, tab availability, risk summaries)

### Active (`active/`)
- **EscalationOverlay**, **CheckpointPanel**, **DecisionActions**, **AttemptHistory** — escalation flow
- **IntegrationsPanel** + **TabBar** — gateway/external-services configuration shell
- **PinyxConnectionTab**, **PinyxKeysTab**, **PinyxModelsTab** — PiNyx tabs
- **QuotaPanel**, **SettingsPanel**, **MutationPanel** — operational tabs
- **RepoPicker**, **RepoPrepareModal**, **MissionCreationView**, **MissionSidebar** — mission creation flow
- **mutation-score.ts** — pure helpers for the mutation panel

### Hooks (`hooks/`)
14 typed hooks back the components above, including `useMission`, `useMissions`, `useWebSocket`, `useTheme`, `useGitHub`, `usePinyxStatus`, `useNotifications`, `useQuota`, `useSettings`, `useSupplyChain`, `useTabBadge`, `useKeyboardShortcuts`, and `useBreakpoint`.

## Do's and Don'ts

## Motion & Animation (anime.js v4)

Aurex uses anime.js v4 (`animejs` package) as its sole animation engine. All motion follows the mission control metaphor — animations are subtle, precise, and convey system state changes. Nothing bounces, nothing is playful. Motion = information.

### Animation Inventory

The following animation modules exist in `packages/frontend/src/animations/` and must be wired into their target components:

| Module | Functions | Target Component | Trigger |
|---|---|---|---|
| `counters.ts` | `animateCounter` | TelemetryBar, CostCounter | Number change (cost, tokens, agents) |
| `counters.ts` | `animateProgress` | MissionSummaryHeader | Milestone progress update |
| `state-transitions.ts` | `enterActive` | MissionPipeline | Mission focused / state → active |
| `state-transitions.ts` | `exitActive` | MissionPipeline | Mission unfocused / state → inactive |
| `state-transitions.ts` | `dimPassive` | MissionPipeline | Mission goes idle/backgrounded |
| `state-transitions.ts` | `restorePassive` | MissionPipeline | Mission resumes foreground |
| `agent-animations.ts` | `createPulse` | MissionActivityFeed | Agent spawns or sends update |
| `agent-animations.ts` | `createSpin` | MissionActivityFeed | Agent enters working state |
| `agent-animations.ts` | `createIdle` | MissionActivityFeed | Agent waiting/idle |
| `stagger.ts` | `staggerEntrance` | MissionInspectorPanel | Tab or agent appears (mission start, new agent spawned) |

### Animation Principles

1. **Counter animations** use `outExpo` easing — numbers count up smoothly, decelerating to their final value. Duration 600ms for counters, 600ms for progress bars. Never instant number jumps.
2. **State transitions** use `outExpo` for enter (300ms) and `inExpo` for exit (200ms). Enter scales from 0.9→1.0 + fades in; exit scales from 1.0→0.9 + fades out. This gives panels a subtle "materializing" feel.
3. **Agent animations** — pulse is a continuous loop (`loop: true`) on the status dot with accent-colored glow. Spin rotates an icon while the agent works. Idle is a slow breathing opacity animation.
4. **Stagger entrance** — when agents appear, they enter with a 50ms stagger delay between each. This creates a cascade effect that reads as "systems coming online" rather than a wall of content appearing.
5. **Theme transitions** — when switching themes, CSS custom properties change and any running anime.js instances should complete before the new theme's colors take visual effect. A brief 200ms crossfade on the `<html>` element handles this.
6. **Empty state entrance** — the AUREX logo, subtitle, steps, and example cards enter with a staggered timeline (logo first, then each section with 100ms delay).

### Integration Pattern

```typescript
// In component — use useRef + useEffect to wire animations
const counterRef = useRef<HTMLElement>(null);
useEffect(() => {
  if (counterRef.current && prevValue !== value) {
    animateCounter(counterRef.current, prevValue, value);
  }
}, [value]);
```

All animation functions return the anime.js instance so callers can `.pause()`, `.restart()`, or chain `.then()`.

### Do's and Don'ts

#### Do
- Use CSS custom properties for all colors — never hardcode hex values in components
- Use JetBrains Mono for all labels, values, and status readouts to maintain the operational feel
- Apply the surface ladder consistently — bg-inset < bg-deep < bg-surface < bg-elevated
- Use hairline borders (1px solid var(--border)) for structure — they create density without visual noise
- Add accent glow (`box-shadow: 0 0 16px var(--accent-glow)`) on hover for interactive feedback
- Keep button styles minimal — solid accent for primary, outline for secondary
- Use 10–11px mono text for telemetry and labels — it's small but readable and fits the control-panel aesthetic
- Default to Solar Flare theme; let users switch without page reload
- Test all three themes for contrast and readability
- Wire every animation function to its target component — the stubs exist, they need callers
- Use `useRef<HTMLElement>` + `useEffect` to connect anime.js to React components
- Use `outExpo` for all entrance/counter animations — it's the signature easing
- Return anime instances from animation functions so components can control lifecycle

#### Don't
- Don't hardcode Tailwind color classes (`bg-gray-900`, `text-green-400`) — use CSS custom properties
- Don't use 2px+ borders — the system relies on 1px hairlines for density
- Don't use traditional box-shadow elevation on dark surfaces — use background luminance stepping instead
- Don't mix theme tokens — each theme is a complete, self-consistent palette
- Don't use Inter for labels or telemetry values — JetBrains Mono provides the technical identity
- Don't make the telemetry bar taller than 36px — it should feel like an instrument readout, not a toolbar
- Don't use pure white (`#ffffff`) for text — use `var(--text-primary)` which has theme-appropriate warmth/coolness
- Don't add colored backgrounds to body text areas — the deep background IS the whitespace
- Don't use CSS transitions or framer-motion — anime.js is the sole animation engine
- Don't use bouncy/playful easings (spring, bounce, elastic) — all motion is precise and engineered
- Don't trigger animations on mount for static content — animate state transitions only
- Don't leave animation stubs unwired — every function in `animations/` must have at least one caller
