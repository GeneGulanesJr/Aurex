# Frontend UI Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 issues identified in the frontend UI audit to bring Aurex into full DESIGN.md compliance.

**Architecture:** This is a cosmetic/structural fix plan — no new features. Changes span CSS keyframes, hardcoded color tokenization, component spec compliance, bundle hygiene, and accessibility. Each task is independent and can be merged individually.

**Tech Stack:** React 19, TypeScript, anime.js v4, CSS custom properties, Vite

---

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/frontend/src/styles.css` | Add `@keyframes pulse`, add Inter OpenType features, remove unused Tailwind import |
| Modify | `packages/frontend/src/active/EscalationOverlay.tsx` | Fix borderRadius, replace hardcoded `rgba` with CSS vars |
| Modify | `packages/frontend/src/active/MissionSidebar.tsx` | Replace hardcoded `rgba` in statusBadge with CSS vars, add TOTAL SPENT footer |
| Modify | `packages/frontend/src/frame/ThemePicker.tsx` | Derive colors from CSS vars |
| Modify | `packages/frontend/src/passive/MissionPipeline.tsx` | Add milestone progress bar, wire `animateProgress` |
| Modify | `packages/frontend/src/App.tsx` | Pass total cost to sidebar for TOTAL SPENT footer |
| Modify | `packages/frontend/src/active/MissionSidebar.tsx` | Accept + display total cost in footer |

---

### Task 1: Add missing `@keyframes pulse` to styles.css

**Files:**
- Modify: `packages/frontend/src/styles.css`

**Context:** `MissionPipeline.tsx` line 333 uses `animation: "pulse 1.5s infinite"` for the planning-log active indicator, but no `@keyframes pulse` is defined. The animation silently fails — the dot appears static.

- [ ] **Step 1: Add the keyframe animation**

Append to the end of `packages/frontend/src/styles.css`:

```css
/* Pulse animation for active indicators */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.85);
  }
}
```

- [ ] **Step 2: Verify the animation works visually**

Run: `cd packages/frontend && pnpm dev`

Expected: The planning-log active indicator (small dot next to "Mission Log") should now breathe (fade + scale).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/styles.css
git commit -m "fix(ui): add missing @keyframes pulse for planning log indicator"
```

---

### Task 2: Fix EscalationOverlay spec violations

**Files:**
- Modify: `packages/frontend/src/active/EscalationOverlay.tsx`

**Context:** Two violations: (1) `borderRadius: "12px"` exceeds spec max of `6px` (rounded.lg), (2) hardcoded `rgba(0,0,0,0.6)` backdrop and `rgba(0,0,0,0.25)` shadow violate the "use CSS custom properties" rule.

- [ ] **Step 1: Replace hardcoded values with CSS vars and fix border radius**

In `packages/frontend/src/active/EscalationOverlay.tsx`, change the overlay container (line 34):

From:
```tsx
    <div ref={overlayRef} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "12px", padding: "32px", maxWidth: "672px", width: "100%", margin: "0 16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
```

To:
```tsx
    <div ref={overlayRef} style={{ position: "fixed", inset: 0, background: "var(--bg-inset)", opacity: 0.85, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: "6px", padding: "32px", maxWidth: "672px", width: "100%", margin: "0 16px", boxShadow: "0 25px 50px -12px var(--accent-glow)", border: "1px solid var(--border)" }}>
```

Changes:
- Backdrop: `rgba(0,0,0,0.6)` → `var(--bg-inset)` with `opacity: 0.85` (matches design system surface ladder)
- Panel radius: `12px` → `6px` (spec max)
- Shadow: hardcoded rgba → `var(--accent-glow)` (matches "glow on interaction" pattern)
- Added: `1px solid var(--border)` hairline (spec requires hairline borders on structural elements)

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/frontend && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/EscalationOverlay.tsx
git commit -m "fix(ui): EscalationOverlay spec compliance — radius, tokens, border"
```

---

### Task 3: Tokenize hardcoded `rgba` in MissionSidebar statusBadge

**Files:**
- Modify: `packages/frontend/src/styles.css`
- Modify: `packages/frontend/src/active/MissionSidebar.tsx`

**Context:** `statusBadge()` uses hardcoded `rgba(129, 140, 248, 0.2)`, `rgba(74, 222, 128, 0.2)`, `rgba(239, 68, 68, 0.2)` for badge backgrounds. These should use CSS custom properties.

- [ ] **Step 1: Add badge background CSS custom properties**

In `packages/frontend/src/styles.css`, add inside the `:root` semantic block (after `--info: #818cf8;`):

```css
  --badge-info-bg: rgba(129, 140, 248, 0.2);
  --badge-success-bg: rgba(74, 222, 128, 0.2);
  --badge-error-bg: rgba(239, 68, 68, 0.2);
```

- [ ] **Step 2: Update statusBadge in MissionSidebar.tsx**

In `packages/frontend/src/active/MissionSidebar.tsx`, replace the `statusBadge` function's `background` values:

From:
```tsx
    case "waiting_checkpoint":
      return { label: "Checkpoint", style: { background: "rgba(129, 140, 248, 0.2)", color: "var(--info)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "completed":
      return { label: "Done", style: { background: "rgba(74, 222, 128, 0.2)", color: "var(--success)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "failed":
      return { label: "Failed", style: { background: "rgba(239, 68, 68, 0.2)", color: "var(--error)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
```

To:
```tsx
    case "waiting_checkpoint":
      return { label: "Checkpoint", style: { background: "var(--badge-info-bg)", color: "var(--info)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "completed":
      return { label: "Done", style: { background: "var(--badge-success-bg)", color: "var(--success)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
    case "failed":
      return { label: "Failed", style: { background: "var(--badge-error-bg)", color: "var(--error)", fontSize: "10px", padding: "1px 6px", borderRadius: "3px" } };
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/frontend && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/styles.css packages/frontend/src/active/MissionSidebar.tsx
git commit -m "fix(ui): tokenize hardcoded rgba in statusBadge with CSS custom properties"
```

---

### Task 4: ThemePicker — derive colors from CSS variables

**Files:**
- Modify: `packages/frontend/src/frame/ThemePicker.tsx`

**Context:** ThemePicker hardcodes `#e8920d`, `#22d3ee`, `#ef4444` for the three theme swatches. If theme colors change in `styles.css`, the picker won't match. The fix reads colors from a computed style lookup on mount.

- [ ] **Step 1: Replace hardcoded colors with runtime CSS variable reads**

Replace the entire `ThemePicker.tsx`:

```tsx
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

/** Map themeId → CSS variable name for its accent color */
const accentVar: Record<ThemeId, string> = {
  "solar-flare": "--accent",       // active on solar-flare root
  "frost-command": "--accent",
  "signal-red": "--accent",
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/frontend && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/frame/ThemePicker.tsx
git commit -m "fix(ui): ThemePicker reads accent colors from CSS variables"
```

---

### Task 5: Add Inter OpenType features (cv01 + ss03)

**Files:**
- Modify: `packages/frontend/src/styles.css`

**Context:** DESIGN.md specifies Inter should use OpenType features `cv01` + `ss03` for "geometric alternates / engineered character". Currently missing.

- [ ] **Step 1: Add font-feature-settings to body rule**

In `packages/frontend/src/styles.css`, inside the `body { ... }` block, add after `font-family`:

```css
body {
  margin: 0;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: "Inter", -apple-system, sans-serif;
  font-feature-settings: "cv01", "ss03";
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Verify visually**

Run: `cd packages/frontend && pnpm dev`

Expected: Body text in Inter should appear slightly cleaner with more geometric character (e.g., the `a` and `l` shapes may differ subtly).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/styles.css
git commit -m "fix(ui): add Inter OpenType features cv01 + ss03 per DESIGN.md"
```

---

### Task 6: Add milestone progress bar + wire animateProgress

**Files:**
- Modify: `packages/frontend/src/passive/MissionPipeline.tsx`

**Context:** `animateProgress` is imported from `counters.ts` but never called. The spec requires a progress bar that animates on milestone progress updates. Currently milestones have no visual progress indicator. Progress is computed from workers: `completed / total` per milestone.

- [ ] **Step 1: Add MilestoneProgressBar component inside MissionPipeline.tsx**

Add this function component after the existing `MilestoneDot` function (around line 250):

```tsx
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
```

- [ ] **Step 2: Wire MilestoneProgressBar into the milestone content section**

Find the milestone content rendering block (inside `milestones.map`), after the worker chips section. Currently the content div ends with:

```tsx
                  {/* Workers under active milestone */}
                  {isActive && msWorkers.length > 0 && (
                    <div ref={workerContainerRef} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {msWorkers.map((w) => (
                        <WorkerChip key={w.id} worker={w} />
                      ))}
                    </div>
                  )}
```

After this block, before the closing `</div>` of the milestone-node, add:

```tsx
                  {/* Progress bar for active/in-progress milestones */}
                  {(isActive || milestone.status === "validating") && (
                    <MilestoneProgressBar milestone={milestone} workers={workers} />
                  )}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/frontend && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Verify the import is now used**

The existing `import { animateProgress } from "../animations/counters";` on line 5 is now used by `MilestoneProgressBar`. No import changes needed.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/passive/MissionPipeline.tsx
git commit -m "feat(ui): add animated milestone progress bar, wire animateProgress"
```

---

### Task 7: Add sidebar "TOTAL SPENT" footer

**Files:**
- Modify: `packages/frontend/src/active/MissionSidebar.tsx`
- Modify: `packages/frontend/src/App.tsx`

**Context:** DESIGN.md specifies the sidebar should have a footer section showing "TOTAL SPENT" label + cost value in accent color. Currently missing.

- [ ] **Step 1: Update MissionSidebar props to accept cost**

In `packages/frontend/src/active/MissionSidebar.tsx`, update the interface:

From:
```tsx
interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onRemove: (missionId: string) => void;
  onRestart: (missionId: string) => void;
  onCreateMission: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  systemReady?: boolean;
}
```

To:
```tsx
interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onRemove: (missionId: string) => void;
  onRestart: (missionId: string) => void;
  onCreateMission: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  systemReady?: boolean;
  totalCost?: number;
}
```

Update the function signature:

From:
```tsx
export function MissionSidebar({ missions, selectedMissionId, onSelect, onRemove, onRestart, onCreateMission, github, systemReady }: MissionSidebarProps) {
```

To:
```tsx
export function MissionSidebar({ missions, selectedMissionId, onSelect, onRemove, onRestart, onCreateMission, github, systemReady, totalCost }: MissionSidebarProps) {
```

- [ ] **Step 2: Add the footer to both sidebar branches (empty and populated)**

For the **empty state sidebar** (when `missions.length === 0`), add before the closing `</aside>`:

```tsx
        {/* Footer: Total Spent */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", marginTop: "auto" }}>
          <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "4px" }}>
            Total Spent
          </div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace' }}>
            ${(totalCost ?? 0).toFixed(2)}
          </div>
        </div>
```

For the **populated sidebar**, add before the closing `</aside>` (after the mission list scrollable div):

```tsx
      {/* Footer: Total Spent */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "4px" }}>
          Total Spent
        </div>
        <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--accent)", fontFamily: '"JetBrains Mono", monospace' }}>
          ${(totalCost ?? 0).toFixed(2)}
        </div>
      </div>
```

- [ ] **Step 3: Pass totalCost from App.tsx**

In `packages/frontend/src/App.tsx`, update the `<MissionSidebar>` call to pass `totalCost`:

From:
```tsx
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
          onRestart={markMissionRestarted}
          onCreateMission={handleCreateMission}
          github={github}
          systemReady={systemReady}
        />
```

To:
```tsx
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
          onRestart={markMissionRestarted}
          onCreateMission={handleCreateMission}
          github={github}
          systemReady={systemReady}
          totalCost={state.cost?.totalCost}
        />
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd packages/frontend && pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/active/MissionSidebar.tsx packages/frontend/src/App.tsx
git commit -m "feat(ui): add TOTAL SPENT footer to sidebar per DESIGN.md"
```

---

### Task 8: Remove unused Tailwind CSS import

**Files:**
- Modify: `packages/frontend/src/styles.css`
- Modify: `packages/frontend/package.json` (optional cleanup)

**Context:** `styles.css` starts with `@import "tailwindcss"` but literally every component uses inline styles — zero Tailwind utility classes are used anywhere. The import adds ~50-100KB of dead CSS to the bundle.

- [ ] **Step 1: Remove the Tailwind import**

In `packages/frontend/src/styles.css`, remove line 1:

From:
```css
@import "tailwindcss";

/* === Solar Flare (default) === */
```

To:
```css
/* === Solar Flare (default) === */
```

- [ ] **Step 2: Verify build still works**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds. Bundle size should decrease.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/styles.css
git commit -m "chore: remove unused @import tailwindcss — all components use inline styles"
```

---

### Task 9: Add focus-visible outlines for accessibility

**Files:**
- Modify: `packages/frontend/src/styles.css`

**Context:** No interactive elements have focus-visible outlines. Keyboard navigation is invisible. DESIGN.md doesn't prohibit this — it's a baseline accessibility requirement.

- [ ] **Step 1: Add global focus-visible styles**

In `packages/frontend/src/styles.css`, add after the `*, *::before, *::after` block:

```css
/* Accessibility: focus-visible outlines */
button:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

textarea:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: -1px;
}
```

- [ ] **Step 2: Verify visually**

Run: `cd packages/frontend && pnpm dev`

Tab through the interface. Every interactive element (buttons, textarea, tabs, theme picker) should show a visible accent-colored outline.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/styles.css
git commit -m "a11y: add focus-visible outlines for keyboard navigation"
```

---

### Task 10: Reindex stale code entries

**Files:**
- No file changes — index maintenance

**Context:** The code index lists `passive/AgentGrid.tsx` and `passive/AgentNode.tsx` which no longer exist on disk. These were merged into `MissionPipeline.tsx`. Stale entries cause phantom search results.

- [ ] **Step 1: Reindex the aurex repo**

Run:
```bash
memory-store.js reindex --repo aurex
```

Expected: Index rebuilds. `AgentGrid.tsx` and `AgentNode.tsx` should no longer appear in outlines.

- [ ] **Step 2: Verify phantom entries are gone**

Run:
```bash
memory-store.js outline --repo aurex --file packages/frontend/src/passive/AgentGrid.tsx
```

Expected: "File not found"

---

## Self-Review Checklist

### 1. Spec Coverage

| DESIGN.md Requirement | Task |
|---|---|
| `@keyframes pulse` referenced in MissionPipeline | Task 1 |
| Escalation overlay: max 6px radius | Task 2 |
| All colors via CSS custom properties | Tasks 2, 3, 4 |
| Inter OpenType features cv01 + ss03 | Task 5 |
| Milestone progress animation (animateProgress) | Task 6 |
| Sidebar "TOTAL SPENT" footer | Task 7 |
| No unused CSS framework imports | Task 8 |
| Hairline borders on structural elements | Task 2 (overlay border) |
| Focus-visible for accessibility | Task 9 |
| Stale index entries cleaned | Task 10 |

### 2. Placeholder Scan

No TBD, TODO, "implement later", "add validation", "similar to Task N" found. All steps contain exact code.

### 3. Type Consistency

- `MissionSidebarProps` updated with `totalCost?: number` — matches `state.cost?.totalCost` (number | undefined) from App.tsx ✅
- `MilestoneProgressBar` uses imported `Milestone` and `WorkingUnit` types from `@aurex/shared` ✅
- `animateProgress` signature: `(bar: HTMLElement, fromPercent: number, toPercent: number)` — called with `(barRef.current, prevPercentRef.current, percent)` ✅
- `ThemePicker` uses `ThemeId` from `../hooks/useTheme` ✅

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-06-01-frontend-ui-audit-fixes.md`.**

**Which execution approach?**

- **Sequential mode** (subagents) — I dispatch a fresh subagent per task, two-stage review (spec then quality). Fast iteration.
- **Direct mode** (no subagents) — Execute tasks in this session with checkpoint reviews. Same quality discipline, no agent delegation.
