# Plan Review: Mission Control UI Redesign

**Reviewer:** Self-review against DESIGN.md spec + codebase reality check
**Plan:** `docs/superpowers/plans/2026-05-29-mission-control-ui.md`

---

## Critical Issues (must fix before execution)

### C1. Tailwind v4 `@theme` syntax is wrong — will break CSS

**File:** Task 1, Step 5 (styles.css)
**Problem:** The plan uses `@theme { --color-bg-deep: var(--bg-deep); }` but Tailwind v4 docs are explicit: **when referencing other CSS variables inside `@theme`, you MUST use `@theme inline`**. Without `inline`, the utility classes resolve `var(--bg-deep)` at the `:root` level where `--bg-deep` may not yet be defined by the `data-theme` selector, causing them to fall through to the default or be empty.

**Fix:** Change `@theme {` to `@theme inline {` in the styles.css block. This makes Tailwind emit `var(--bg-deep)` directly in utility class output rather than the intermediate `--color-bg-deep` variable.

Additionally, since the plan uses `style={{}}` inline styles everywhere (not Tailwind utility classes), the `@theme` block may be **entirely unnecessary**. The plan never uses classes like `bg-bg-deep` — it uses `background: "var(--bg-deep)"` inline. So the `@theme` block adds complexity for zero benefit.

**Recommendation:** Remove the `@theme` block entirely. Components use `var(--bg-deep)` directly in inline styles. The `:root` and `[data-theme]` blocks provide the CSS custom properties. Tailwind utilities aren't needed for colors.

### C2. `@import url()` for Google Fonts will fail in production build

**File:** Task 1, Step 5 (styles.css)
**Problem:** `@import url('https://fonts.googleapis.com/...')` in CSS causes a render-blocking network request. In production, if the user is offline or the CDN is slow, the entire app blocks on font loading. For a "mission control" dashboard that should work locally, this is a reliability issue.

**Fix:** Either:
- (a) Use a `<link>` tag in `index.html` with `rel="preconnect"` + `font-display: swap`, OR
- (b) Self-host the fonts (best for local/offline use)

Since Aurex runs locally and may be behind firewalls, option (a) with a `<link>` tag is the pragmatic minimum, with a local fallback.

### C3. Build commands run from wrong directory

**File:** Multiple tasks (Steps saying `npx vite build`)
**Problem:** All build commands assume running from the monorepo root (`/home/.../Aurex/`), but `vite build` must run from `packages/frontend/`. Running from root gives "Could not resolve entry module index.html".

**Fix:** Change all build commands to either:
- `cd packages/frontend && npx vite build --mode development`, OR
- `npx vite build --mode development --outDir packages/frontend/dist` (if vite config allows)

Verified: `cd packages/frontend && npx vite build --mode development` works correctly.

### C4. Task 10 is a subset of Task 9 — will cause merge conflicts

**File:** Tasks 9 and 10 both modify App.tsx
**Problem:** Task 10 replaces the `if (!connected)` block in App.tsx, but Task 9 already rewrites the entire App.tsx component (including that block). Task 10 would try to find old code that was already replaced.

**Fix:** Merge Task 10 into Task 9. The connecting overlay should be part of the App.tsx rewrite, not a separate task.

---

## Important Issues (should fix before execution)

### I1. `StatusDot color` uses `var()` in `boxShadow` — may not work

**File:** Task 3 (TopBar.tsx), `StatusDot` component
**Problem:** `boxShadow: \`0 0 6px ${color}\`` where `color` is `"var(--success)"`. CSS `box-shadow` does support `var()`, but string interpolation produces `boxShadow: "0 0 6px var(--success)"`. This actually works in React's inline styles — it's a valid CSS value. **Not a bug**, but fragile. If the var resolves to a non-color, it silently fails.

**Verdict:** Works, but worth noting.

### I2. `useTheme` has no SSR guard for `localStorage`

**File:** Task 1, Step 3 (useTheme.ts)
**Problem:** The plan already handles this with `typeof localStorage !== "undefined"` check, but `typeof document !== "undefined"` is missing for the `useEffect` that calls `document.documentElement.setAttribute`. If the component renders server-side (unlikely for a Vite SPA, but defensive coding), this would throw.

**Fix:** Add a guard in the useEffect:
```typescript
useEffect(() => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}, [theme]);
```

### I3. TopBar props include `lapisConnected` and `pinyxConnected` but App has no source for these

**File:** Task 3 (TopBar), Task 9 (App.tsx)
**Problem:** The current App.tsx only has `connected` from `useWebSocket`. There's no `lapisConnected` or `pinyxConnected` state anywhere in the frontend. The TopBar component accepts these props but App.tsx would need to synthesize them or just pass `connected` for all three.

**Fix:** Either:
- (a) Show all three as `connected` from WebSocket status (the WS connects to the backend which connects to both), OR
- (b) Derive lapis/pinyx status from specific WS events (e.g., `system_status` event)

For now, option (a) is correct — if the WebSocket is connected, both LaPis and Pinyx are reachable through the backend. Update TopBar to just take `connected: boolean` and show all three dots based on that single boolean. The "lapisConnected/pinyxConnected" granularity can be added later when the backend reports individual service health.

### I4. `uptime` prop has no source

**File:** Task 3 (TopBar), Task 9 (App.tsx)
**Problem:** The TopBar accepts an `uptime: string` prop, but nowhere in the current codebase is uptime tracked. App.tsx would need to compute it from a start timestamp.

**Fix:** Add a simple `useEffect` + `setInterval` in App.tsx that tracks time since connection:
```typescript
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

This should be added to the plan's Task 9 App.tsx rewrite.

### I5. Task 6, 7, 8 use vague descriptions instead of actual code

**File:** Tasks 6, 7, 8
**Problem:** The writing-plans skill says "No Placeholders" and "every step must contain the actual content." Tasks 6-8 describe what to change ("replace all `text-gray-*` with `var()`") but don't show the actual rewritten component code. An engineer following the plan would have to figure out the exact JSX themselves.

**Fix:** For each file in these tasks, show the complete rewritten JSX. This is a significant expansion but follows the plan quality standard. At minimum, show the key `style={{}}` patterns that replace the Tailwind classes.

### I6. TelemetryBar needs data from `state.cost` and `state.activeWorkers`

**File:** Task 9 (App.tsx)
**Problem:** TelemetryBar needs `tokens`, `cost`, `agentCount`, `wsConnected`. App.tsx gets `state` from `useMission()` which has `cost: CostSummary | null` and `activeWorkers: WorkingUnit[]`. The plan doesn't show how these map to TelemetryBar props.

**Fix:** In Task 9, show the prop mapping:
```typescript
<TelemetryBar
  tokens={state.cost?.totalTokens ?? 0}
  cost={state.cost?.totalCost ?? 0}
  agentCount={state.activeWorkers.length}
  wsConnected={connected}
/>
```

### I7. `EscalationOverlay` uses Tailwind classes but plan says convert to inline styles

**File:** Task 8 (EscalationOverlay)
**Problem:** Current EscalationOverlay uses `className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"` and `className="bg-gray-800 rounded-xl p-8 max-w-2xl w-full mx-4 shadow-2xl"`. These are layout utilities (`fixed`, `inset-0`, `flex`, `z-50`) mixed with color utilities. The plan says "replace all `bg-gray-*`" but shouldn't replace layout utilities like `fixed inset-0`.

**Fix:** Be explicit: keep layout/position Tailwind utilities (`flex`, `grid`, `fixed`, `inset-0`, `overflow-y-auto`, etc.), only replace **color-related** classes (`bg-*`, `text-*`, `border-gray-*`) with CSS var inline styles.

---

## Minor Issues (nice to fix)

### M1. `animate` import may need curly braces or default depending on anime.js v4 API

**File:** Task 5 (EmptyState)
**Problem:** The animation files use `import { animate } from "animejs"` which works for the existing code. But verify this is the correct v4 API — some v4 docs show `import animate from "animejs"` (default export).

**Verdict:** Existing code uses `import { animate } from "animejs"` and it works, so this is fine.

### M2. No `font-display: swap` for Google Fonts

**File:** Task 1 (styles.css)
**Problem:** The `@import url()` doesn't specify `display=swap` in the URL.

**Fix:** If keeping the `@import`, add `&display=swap` to the URL. But this is moot if switching to `<link>` in index.html per C2.

### M3. EmptyState `onExampleClick` callback not wired to NewMissionForm

**File:** Task 5 (EmptyState), Task 9 (App.tsx)
**Problem:** EmptyState accepts `onExampleClick` which should populate the NewMissionForm with the clicked example text. But the plan doesn't show this wiring — it would need a `description` state in App that flows to both EmptyState and NewMissionForm.

**Fix:** Either implement the wiring in Task 9 (adds complexity) or note it as a follow-up. For now, examples could just call `handleCreateMission(text)` directly.

### M4. ThemePicker uses hardcoded hex colors instead of CSS vars

**File:** Task 2 (ThemePicker)
**Problem:** `bg: "#e8920d"` etc. are hardcoded. If the accent colors ever change, ThemePicker would be out of sync. But since these are the **fixed theme identifiers** (not the current theme's tokens), this is actually correct — each dot must always show its own theme's accent regardless of active theme.

**Verdict:** Correct as-is.

---

## Summary

| Severity | Count | Key Items |
|---|---|---|
| **Critical** | 4 | @theme syntax wrong, Google Fonts blocking, wrong build dir, Task 9/10 overlap |
| **Important** | 7 | uptime/lapis sources missing, tasks 6-8 lack code, telemetry prop mapping |
| **Minor** | 4 | font-display, example wiring, anime import |

**Recommendation:** Fix C1-C4 and I3-I4 before execution. C1 (remove @theme, use inline styles) and C4 (merge Task 10 into Task 9) are quick wins. C3 (build dir) is a find-replace. I3/I4 (prop sources) need small additions to Task 9.
