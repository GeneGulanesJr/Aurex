# OAuth / Integrations Panel State Preservation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent full-page refresh from destroying app state when GitHub OAuth redirect returns the user to Aurex — restore the integrations panel open state and active tab so the user lands back exactly where they were.

**Architecture:** Use `sessionStorage` to persist a "return state" (panel open + active tab) right before navigating away to GitHub OAuth. After the OAuth callback redirects back with `?github=connected`, the `useGitHub` hook detects the param, reads the saved return state, and restores the panel. This avoids a full SPA architecture change (no router needed) and keeps the fix minimal.

**Tech Stack:** React hooks, sessionStorage, Fastify redirect

---

### Task 1: Create a simple session-state helper

**Files:**
- Create: `packages/frontend/src/lib/sessionState.ts`

This is a tiny utility for storing ephemeral UI state that should survive a page reload but not persist across browser sessions.

- [ ] **Step 1: Write the utility**

```typescript
const PREFIX = "aurex_session_";

export function setSessionState<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // sessionStorage unavailable (e.g. incognito overflow) — non-critical
  }
}

export function getSessionState<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearSessionState(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // non-critical
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/lib/sessionState.ts
git commit -m "feat: add sessionStorage utility for ephemeral UI state"
```

---

### Task 2: Persist integrations panel state before OAuth redirect

**Files:**
- Modify: `packages/frontend/src/active/IntegrationsPanel.tsx` (pass `pinyxTab` + panel open state up, or save from `handleConnect`)
- Modify: `packages/frontend/src/hooks/useGitHub.ts` (save return state before `window.location.href`)

The key insight: the `connect()` function in `useGitHub` navigates away. We need to save state *just before* that navigation. Two clean options:

**Option A (chosen):** Save the return state inside `IntegrationsPanel.handleConnect()` before calling `github.connect()`. The panel already knows its own tab state. This keeps the concern local — the panel decides what to remember about itself.

**Option B:** Pass a callback into `useGitHub` to gather state before navigation. More flexible but over-engineered for two values.

- [ ] **Step 1: Import sessionState in IntegrationsPanel**

In `packages/frontend/src/active/IntegrationsPanel.tsx`, add import:

```typescript
import { setSessionState, clearSessionState } from "../lib/sessionState";
```

- [ ] **Step 2: Save return state in handleConnect, clear it on mount when not returning**

Modify the `handleConnect` function inside `IntegrationsPanel`:

```typescript
async function handleConnect() {
  setConnecting(true);
  try {
    // Remember that the integrations panel was open and which PiNyx tab was active
    setSessionState("integrations_return", { open: true, pinyxTab });
    await github.connect();
  } finally {
    setConnecting(false);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/IntegrationsPanel.tsx packages/frontend/src/lib/sessionState.ts
git commit -m "feat: save integrations panel state before GitHub OAuth redirect"
```

---

### Task 3: Restore integrations panel after OAuth redirect

**Files:**
- Modify: `packages/frontend/src/App.tsx` (read return state on mount, open panel if needed, pass initial tab)
- Modify: `packages/frontend/src/active/IntegrationsPanel.tsx` (accept initial tab prop)

When the page reloads after OAuth callback with `?github=connected`, the `useGitHub` useEffect already detects and cleans the URL param. We add logic to read the saved session state and restore the panel.

- [ ] **Step 1: Read return state in App.tsx**

Add import at top of `packages/frontend/src/App.tsx`:

```typescript
import { getSessionState, clearSessionState } from "./lib/sessionState";
```

Change the `integrationsOpen` initialization from simple `useState(false)` to read from session state:

```typescript
// Before OAuth redirect, we save the panel state so we can restore it after the redirect.
const [integrationsOpen, setIntegrationsOpen] = useState(() => {
  const ret = getSessionState<{ open: boolean; pinyxTab: string }>("integrations_return");
  if (ret?.open) {
    return true;
  }
  return false;
});
const [restoredPinyxTab, setRestoredPinyxTab] = useState<string | null>(() => {
  const ret = getSessionState<{ open: boolean; pinyxTab: string }>("integrations_return");
  clearSessionState("integrations_return");
  return ret?.open ? (ret.pinyxTab ?? null) : null;
});
```

- [ ] **Step 2: Pass initial tab to IntegrationsPanel**

Update the `IntegrationsPanel` usage in App.tsx to pass the restored tab:

```tsx
<IntegrationsPanel
  open={integrationsOpen}
  github={github}
  onClose={() => setIntegrationsOpen(false)}
  onPinyxConfigUpdate={() => void pinyxStatus.refresh()}
  initialPinyxTab={restoredPinyxTab ?? undefined}
/>
```

- [ ] **Step 3: Update IntegrationsPanel to accept initialPinyxTab**

In `packages/frontend/src/active/IntegrationsPanel.tsx`, update the interface and default tab:

```typescript
interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
  onPinyxConfigUpdate?: () => void;
  initialPinyxTab?: string;  // <-- add
}
```

Change the `pinyxTab` state initialization:

```typescript
const [pinyxTab, setPinyxTab] = useState(initialPinyxTab ?? "connection");
```

Destructure the new prop:

```typescript
export function IntegrationsPanel({ open, github, onClose, onPinyxConfigUpdate, initialPinyxTab }: IntegrationsPanelProps) {
```

- [ ] **Step 4: Verify the restoration flow end-to-end**

Manual test sequence:
1. Open the integrations panel
2. Click "Login with GitHub"
3. Complete OAuth on GitHub
4. Verify: page loads with integrations panel **already open**, showing GitHub connected status
5. Verify: sessionStorage no longer has `aurex_session_integrations_return` (it was cleared)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/active/IntegrationsPanel.tsx
git commit -m "feat: restore integrations panel state after GitHub OAuth redirect"
```

---

### Task 4: Verify PiNyx tabs don't cause page reloads

**Files:**
- No changes expected — this is a verification step

The PiNyx tabs (Connection, Models, Keys) use `savePinyxConfig()` → `onConfigUpdate(saved)` → `setPinyx(config)` which is pure React state. No `window.location` calls. The `onPinyxConfigUpdate` callback calls `pinyxStatus.refresh()` which is also async state, not navigation.

- [ ] **Step 1: Manual verification of PiNyx tab interactions**

Test each tab:
1. **Connection tab:** Click "Check Gateway" → verify no page reload, just a state update showing latency
2. **Models tab:** Change model dropdown, click "Save Model Routing" → verify no page reload, just "Saved ✓" flash
3. **Keys tab:** Add/edit an API key, click "Save" → verify no page reload, just "Saved ✓" flash

All three should update in-place without any full-page navigation. If any causes a reload, investigate further.

- [ ] **Step 2: If any PiNyx tab causes a reload, investigate**

Run browser dev tools Network tab during each interaction. Look for `document` navigation requests (not XHR/fetch). If found, trace back to any `window.location` assignment or form submission in that tab's code.

- [ ] **Step 3: Commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix: prevent page reload in PiNyx tab operations"
```

---

## Summary

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| GitHub OAuth causes full page reload | Inherent to OAuth redirect flow — `window.location.href` navigates away, backend redirects back | Can't avoid the reload, but **preserve and restore** panel state via `sessionStorage` |
| After OAuth, integrations panel is closed | `useState(false)` resets on mount | Read return state from `sessionStorage` on init to auto-open the panel |
| PiNyx tabs might cause reloads | Investigated: they don't. All use React state + fetch | No fix needed, but verification step included |

**Total new code:** ~40 lines (utility + restoration logic). No architecture changes.
