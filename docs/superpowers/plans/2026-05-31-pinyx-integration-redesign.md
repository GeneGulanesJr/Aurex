# PiNyx Integration Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat PiNyx configuration form with a polished, tabbed integration panel matching the Mission Control design system.

**Architecture:** Frontend-only redesign with one backend fix. Three new tab components (Connection, Models, Keys) replace the inline PiNyx section in IntegrationsPanel. All styling via CSS classes. TopBar gets a clickable PiNyx status.

**Tech Stack:** React (functional components + hooks), CSS custom properties (DESIGN.md tokens), existing `/api/pinyx/*` endpoints.

**Spec:** `docs/superpowers/specs/2026-05-31-pinyx-integration-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/backend/src/routes/pinyx.ts` | Modify | Fix stale defaultModelHints |
| `packages/frontend/src/styles.css` | Modify | Add all PiNyx panel CSS classes |
| `packages/frontend/src/active/TabBar.tsx` | Create | Reusable tab navigation |
| `packages/frontend/src/active/PinyxConnectionTab.tsx` | Create | Connection endpoint + health |
| `packages/frontend/src/active/PinyxModelsTab.tsx` | Create | Model routing with defaults + overrides |
| `packages/frontend/src/active/PinyxKeysTab.tsx` | Create | Provider key management table |
| `packages/frontend/src/active/IntegrationsPanel.tsx` | Modify | Wire TabBar + 3 tabs, keep GitHub section |
| `packages/frontend/src/frame/TopBar.tsx` | Modify | Make PiNyx StatusItem clickable |

---

### Task 1: Fix backend stale defaultModelHints

**Files:**
- Modify: `packages/backend/src/routes/pinyx.ts:51-56`
- Test: `packages/backend/__tests__/planner.test.ts` (verify existing still passes)

- [ ] **Step 1: Update defaultModelHints in pinyx.ts**

In `packages/backend/src/routes/pinyx.ts`, replace the stale defaults:

```typescript
const defaultModelHints: Record<AgentType, string> = {
  orchestrator: "kilo/kilo-auto/free",
  worker: "kilo/kilo-auto/free",
  validator_scrutiny: "kilo/kilo-auto/free",
  validator_user_testing: "kilo/kilo-auto/free",
  research: "kilo/kilo-auto/free",
};
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All 311 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/pinyx.ts
git commit -m "fix: sync defaultModelHints in pinyx.ts to use real Kilo model IDs"
```

---

### Task 2: Add CSS classes for the PiNyx panel

**Files:**
- Modify: `packages/frontend/src/styles.css`

- [ ] **Step 1: Add all PiNyx panel CSS classes to styles.css**

Append after the existing `*, *::before, *::after` block in `packages/frontend/src/styles.css`:

```css
/* === Integrations Panel (PiNyx tabs) === */

/* Drawer */
.integrations-drawer {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  justify-content: flex-end;
}
.integrations-drawer-content {
  width: 420px;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  box-shadow: -24px 0 80px rgba(0, 0, 0, 0.35);
  padding: 16px;
  overflow-y: auto;
}
.integrations-drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.integrations-drawer-title {
  margin: 0;
  color: var(--text-primary);
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.integrations-drawer-subtitle {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}
.integrations-drawer-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
}

/* Tab bar */
.pinyx-tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.pinyx-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 12px;
  color: var(--text-muted);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.pinyx-tab:hover {
  color: var(--text-secondary);
}
.pinyx-tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Section card */
.pinyx-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-inset);
  margin-bottom: 12px;
}
.pinyx-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.pinyx-section-title {
  margin: 0;
  color: var(--text-primary);
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  letter-spacing: 1px;
}
.pinyx-section-desc {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11px;
}
.pinyx-section-badge {
  color: var(--text-muted);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
}

/* Form elements */
.pinyx-label {
  display: block;
  color: var(--text-muted);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 1px;
  margin-top: 10px;
  margin-bottom: 4px;
  text-transform: uppercase;
}
.pinyx-input {
  width: 100%;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 12px;
  font-family: "JetBrains Mono", monospace;
  outline: none;
  box-sizing: border-box;
}
.pinyx-input:focus {
  border-color: var(--accent-dim);
}
.pinyx-input::placeholder {
  color: var(--text-muted);
}

/* Buttons */
.pinyx-btn-primary {
  background: var(--accent);
  color: var(--bg-deep);
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: opacity 0.15s;
}
.pinyx-btn-primary:disabled {
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: default;
}
.pinyx-btn-primary:not(:disabled):hover {
  opacity: 0.85;
}
.pinyx-btn-outline {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: background 0.15s;
}
.pinyx-btn-outline:hover {
  background: var(--accent-glow);
}
.pinyx-btn-danger {
  background: transparent;
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  text-transform: uppercase;
}
.pinyx-btn-group {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* Status */
.pinyx-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.pinyx-status-dot--success {
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
}
.pinyx-status-dot--error {
  background: var(--error);
  box-shadow: 0 0 6px var(--error);
}
.pinyx-status-dot--muted {
  background: var(--text-muted);
}

/* Status card */
.pinyx-status-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-inset);
  margin-top: 12px;
}
.pinyx-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-secondary);
}
.pinyx-status-latency {
  color: var(--text-secondary);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
}
.pinyx-status-models-toggle {
  background: none;
  border: none;
  color: var(--accent);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  cursor: pointer;
  padding: 0;
}
.pinyx-status-model-list {
  margin-top: 8px;
  padding-left: 14px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
}

/* Model cards */
.pinyx-model-default {
  border: 1px solid var(--border-bright);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-elevated);
  margin-bottom: 12px;
}
.pinyx-model-default-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.pinyx-model-default select {
  width: 100%;
  background: var(--bg-inset);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  outline: none;
  cursor: pointer;
}
.pinyx-agent-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--bg-inset);
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.pinyx-agent-card:hover {
  border-color: var(--border-bright);
}
.pinyx-agent-card--expanded {
  border-color: var(--border-bright);
  background: var(--bg-elevated);
}
.pinyx-agent-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pinyx-agent-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text-primary);
}
.pinyx-agent-model {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
}
.pinyx-agent-model--default {
  color: var(--text-muted);
}
.pinyx-agent-model--override {
  color: var(--accent);
}
.pinyx-agent-desc {
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 6px;
  line-height: 1.5;
}
.pinyx-agent-override {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.pinyx-agent-override select {
  flex: 1;
  background: var(--bg-inset);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  outline: none;
  cursor: pointer;
}
.pinyx-agent-reset {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  font-family: "Inter", sans-serif;
}
.pinyx-agent-reset:hover {
  color: var(--accent);
}

/* Provider table */
.pinyx-provider-table {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.pinyx-provider-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-inset);
  border-bottom: 1px solid var(--border);
}
.pinyx-provider-row:last-child {
  border-bottom: none;
}
.pinyx-provider-id {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}
.pinyx-provider-url {
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}
.pinyx-provider-key-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-muted);
}
.pinyx-provider-key-badge--saved {
  color: var(--success);
}
.pinyx-provider-edit-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  transition: color 0.15s;
}
.pinyx-provider-edit-btn:hover {
  color: var(--accent);
}

/* Provider edit form */
.pinyx-provider-form {
  border: 1px solid var(--border-bright);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-elevated);
  margin-top: 8px;
}

/* Error bar */
.pinyx-error-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 4px;
  padding: 8px 12px;
  margin-top: 12px;
  color: var(--error);
  font-size: 12px;
}
.pinyx-error-bar-close {
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  font-size: 14px;
}

/* Confirmation flash */
.pinyx-saved-flash {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--success);
  margin-top: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/styles.css
git commit -m "style: add CSS classes for PiNyx integration panel tabs"
```

---

### Task 3: Create TabBar component

**Files:**
- Create: `packages/frontend/src/active/TabBar.tsx`

- [ ] **Step 1: Create TabBar.tsx**

Create `packages/frontend/src/active/TabBar.tsx`:

```tsx
interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div className="pinyx-tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`pinyx-tab${tab.id === active ? " pinyx-tab--active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/active/TabBar.tsx
git commit -m "feat: add TabBar component for PiNyx integration panel"
```

---

### Task 4: Create PinyxConnectionTab

**Files:**
- Create: `packages/frontend/src/active/PinyxConnectionTab.tsx`
- Reference: `packages/frontend/src/api.ts` (uses `getPinyxModels`, `savePinyxConfig`, `PinyxConfigResponse`)

- [ ] **Step 1: Create PinyxConnectionTab.tsx**

Create `packages/frontend/src/active/PinyxConnectionTab.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import { getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxConnectionTabProps {
  config: PinyxConfigResponse;
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  modelCount: number;
  models: Array<{ id?: string; name?: string }>;
}

export function PinyxConnectionTab({ config, onConfigUpdate }: PinyxConnectionTabProps) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setEndpoint(config.endpoint);
  }, [config.endpoint]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function handleTestAndSave() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    const start = performance.now();

    try {
      // First update endpoint in config so backend proxies to the right place
      const updatedConfig = { ...config, endpoint };
      await savePinyxConfig(updatedConfig);
      const latencyMs = Math.round(performance.now() - start);

      // Now fetch models through the backend proxy (which uses the saved endpoint)
      const modelStart = performance.now();
      const modelsRes = await getPinyxModels();
      const modelsLatency = Math.round(performance.now() - modelStart);
      const totalLatency = latencyMs + modelsLatency;

      const result: TestResult = {
        success: true,
        latencyMs: totalLatency,
        modelCount: modelsRes.models.length,
        models: modelsRes.models,
      };
      setTestResult(result);
      onConfigUpdate({ ...updatedConfig });
      setSavedFlash(true);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg.includes("502") ? "PiNyx endpoint is unreachable" : msg);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <div className="pinyx-section">
        <div className="pinyx-section-header">
          <div>
            <h3 className="pinyx-section-title">PiNyx Gateway</h3>
            <p className="pinyx-section-desc">LLM orchestration layer</p>
          </div>
        </div>

        <label className="pinyx-label">Endpoint</label>
        <input
          className="pinyx-input"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="http://127.0.0.1:7331"
        />

        <div className="pinyx-btn-group">
          <button
            className="pinyx-btn-outline"
            onClick={() => void handleTestAndSave()}
            disabled={testing || !endpoint.trim()}
          >
            {testing ? "Testing..." : "Test & Save"}
          </button>
        </div>

        {savedFlash && (
          <div className="pinyx-saved-flash">
            Saved ✓ {testResult ? `${testResult.latencyMs}ms` : ""}
          </div>
        )}

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
            <button className="pinyx-error-bar-close" onClick={() => setError(null)}>×</button>
          </div>
        )}
      </div>

      {testResult && (
        <div className="pinyx-status-card">
          <div className="pinyx-status-row">
            <span className="pinyx-status-dot pinyx-status-dot--success" />
            <span>Connected</span>
            <span className="pinyx-status-latency">{testResult.latencyMs}ms</span>
          </div>
          <div style={{ marginTop: "8px" }}>
            <button
              className="pinyx-status-models-toggle"
              onClick={() => setModelsExpanded(!modelsExpanded)}
            >
              {testResult.modelCount} models available {modelsExpanded ? "▾" : "▸"}
            </button>
            {modelsExpanded && (
              <div className="pinyx-status-model-list">
                {testResult.models.map((m, i) => (
                  <div key={m.id ?? m.name ?? i}>{m.id ?? m.name ?? "unknown"}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/active/PinyxConnectionTab.tsx
git commit -m "feat: add PinyxConnectionTab with Test & Save and status card"
```

---

### Task 5: Create PinyxModelsTab

**Files:**
- Create: `packages/frontend/src/active/PinyxModelsTab.tsx`
- Reference: `packages/frontend/src/api.ts` (uses `getPinyxModels`, `savePinyxConfig`, `PinyxConfigResponse`)

- [ ] **Step 1: Create PinyxModelsTab.tsx**

Create `packages/frontend/src/active/PinyxModelsTab.tsx`:

```tsx
import { useState, useEffect } from "react";
import { getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxModelsTabProps {
  config: PinyxConfigResponse;
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

const AGENT_CARDS = [
  { key: "orchestrator", name: "Orchestrator", description: "Plans missions and decomposes goals into milestones", types: ["orchestrator"] },
  { key: "worker", name: "Worker", description: "Writes code and implements working units", types: ["worker"] },
  { key: "validator", name: "Validator", description: "Reviews code quality and runs test suites", types: ["validator_scrutiny", "validator_user_testing"] },
  { key: "research", name: "Research", description: "Gathers context and investigates solutions", types: ["research"] },
] as const;

export function PinyxModelsTab({ config, onConfigUpdate }: PinyxModelsTabProps) {
  const [modelHints, setModelHints] = useState(config.modelHints);
  const [defaultModel, setDefaultModel] = useState(
    config.modelHints.orchestrator ?? "kilo/kilo-auto/free",
  );
  const [models, setModels] = useState<Array<{ id?: string; name?: string }>>([]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which agents have explicit overrides (different from default)
  const [overrides, setOverrides] = useState<Record<string, string | null>>(() => {
    const result: Record<string, string | null> = {};
    for (const card of AGENT_CARDS) {
      const agentModel = config.modelHints[card.types[0] as keyof typeof config.modelHints];
      result[card.key] = agentModel === defaultModel ? null : agentModel;
    }
    return result;
  });

  const dirty = JSON.stringify(modelHints) !== JSON.stringify(config.modelHints);

  useEffect(() => {
    getPinyxModels()
      .then((res) => setModels(res.models))
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    setModelHints(config.modelHints);
    setDefaultModel(config.modelHints.orchestrator ?? "kilo/kilo-auto/free");
  }, [config.modelHints]);

  function handleDefaultChange(newDefault: string) {
    setDefaultModel(newDefault);
    // Update all non-overridden agents to use the new default
    const updated = { ...modelHints };
    for (const card of AGENT_CARDS) {
      if (!overrides[card.key]) {
        for (const t of card.types) {
          (updated as Record<string, string>)[t] = newDefault;
        }
      }
    }
    setModelHints(updated);
  }

  function handleOverride(cardKey: string, value: string | null) {
    const card = AGENT_CARDS.find((c) => c.key === cardKey);
    if (!card) return;
    const updatedOverrides = { ...overrides, [cardKey]: value };
    setOverrides(updatedOverrides);
    const updated = { ...modelHints };
    const model = value ?? defaultModel;
    for (const t of card.types) {
      (updated as Record<string, string>)[t] = model;
    }
    setModelHints(updated);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await savePinyxConfig({ ...config, modelHints });
      onConfigUpdate(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function getCardModel(cardKey: string): string {
    const card = AGENT_CARDS.find((c) => c.key === cardKey);
    if (!card) return defaultModel;
    return modelHints[card.types[0] as keyof typeof modelHints] ?? defaultModel;
  }

  const modelOptions = models.map((m) => m.id ?? m.name ?? "").filter(Boolean);

  return (
    <div>
      <div className="pinyx-section">
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "12px" }}>
          Model routing — auto-detect with per-agent overrides.
        </p>

        {/* Default model */}
        <div className="pinyx-model-default">
          <div className="pinyx-model-default-label">Default Model</div>
          <select
            value={defaultModel}
            onChange={(e) => handleDefaultChange(e.target.value)}
          >
            {modelOptions.length > 0 ? (
              modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))
            ) : (
              <option value={defaultModel}>{defaultModel}</option>
            )}
          </select>
        </div>

        {/* Agent cards */}
        {AGENT_CARDS.map((card) => {
          const model = getCardModel(card.key);
          const hasOverride = overrides[card.key] !== null;
          const isExpanded = expandedCard === card.key;

          return (
            <div
              key={card.key}
              className={`pinyx-agent-card${isExpanded ? " pinyx-agent-card--expanded" : ""}`}
              onClick={() => setExpandedCard(isExpanded ? null : card.key)}
            >
              <div className="pinyx-agent-card-header">
                <span className="pinyx-agent-name">{card.name}</span>
                <span className={`pinyx-agent-model${hasOverride ? " pinyx-agent-model--override" : " pinyx-agent-model--default"}`}>
                  {model}
                </span>
              </div>

              {isExpanded && (
                <>
                  <p className="pinyx-agent-desc">{card.description}</p>
                  <div className="pinyx-agent-override" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={hasOverride ? overrides[card.key]! : ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          handleOverride(card.key, null);
                        } else {
                          handleOverride(card.key, e.target.value);
                        }
                      }}
                    >
                      <option value="">Use default ({defaultModel})</option>
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {hasOverride && (
                      <button
                        className="pinyx-agent-reset"
                        onClick={() => handleOverride(card.key, null)}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="pinyx-btn-group">
          <button
            className="pinyx-btn-primary"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving..." : "Save Model Routing"}
          </button>
        </div>

        {savedFlash && <div className="pinyx-saved-flash">Saved ✓</div>}

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
            <button className="pinyx-error-bar-close" onClick={() => setError(null)}>×</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/active/PinyxModelsTab.tsx
git commit -m "feat: add PinyxModelsTab with default model + per-agent override cards"
```

---

### Task 6: Create PinyxKeysTab

**Files:**
- Create: `packages/frontend/src/active/PinyxKeysTab.tsx`
- Reference: `packages/frontend/src/api.ts` (uses `savePinyxConfig`, `PinyxConfigResponse`, `PinyxProviderConfigResponse`)

- [ ] **Step 1: Create PinyxKeysTab.tsx**

Create `packages/frontend/src/active/PinyxKeysTab.tsx`:

```tsx
import { useState } from "react";
import { savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxKeysTabProps {
  config: PinyxConfigResponse;
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

interface ProviderDraft {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_DRAFT: ProviderDraft = { id: "", name: "", baseUrl: "", apiKey: "" };

export function PinyxKeysTab({ config, onConfigUpdate }: PinyxKeysTabProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(index: number) {
    const p = config.providers[index];
    setDraft({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "",
    });
    setEditingIndex(index);
    setAdding(false);
  }

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setAdding(true);
    setEditingIndex(null);
  }

  function cancel() {
    setDraft(EMPTY_DRAFT);
    setEditingIndex(null);
    setAdding(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let providers = [...config.providers];
      if (adding) {
        providers.push({
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey || undefined,
        });
      } else if (editingIndex !== null) {
        providers[editingIndex] = {
          ...providers[editingIndex],
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        };
      }
      const saved = await savePinyxConfig({ ...config, providers });
      onConfigUpdate(saved);
      cancel();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const isEditing = editingIndex !== null || adding;

  return (
    <div>
      <div className="pinyx-section">
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "12px" }}>
          API keys for LLM providers.
        </p>

        {/* Provider table */}
        {config.providers.length > 0 && (
          <div className="pinyx-provider-table">
            {config.providers.map((provider, index) => (
              <div key={`${provider.id}-${index}`} className="pinyx-provider-row">
                <div>
                  <div className="pinyx-provider-id">{provider.id}</div>
                  <div className="pinyx-provider-url">{provider.baseUrl}</div>
                </div>
                <div className={`pinyx-provider-key-badge${provider.hasApiKey ? " pinyx-provider-key-badge--saved" : ""}`}>
                  <span className={`pinyx-status-dot ${provider.hasApiKey ? "pinyx-status-dot--success" : "pinyx-status-dot--muted"}`} />
                  {provider.hasApiKey ? "Saved" : "No key"}
                </div>
                <button
                  className="pinyx-provider-edit-btn"
                  onClick={() => startEdit(index)}
                  title="Edit provider"
                >
                  ✎
                </button>
              </div>
            ))}
          </div>
        )}

        {!isEditing && (
          <div className="pinyx-btn-group">
            <button className="pinyx-btn-outline" onClick={startAdd}>
              + Add Provider
            </button>
          </div>
        )}

        {/* Edit / Add form */}
        {isEditing && (
          <div className="pinyx-provider-form">
            <label className="pinyx-label">Provider ID</label>
            <input
              className="pinyx-input"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              placeholder="openai"
            />

            <label className="pinyx-label">Display Name</label>
            <input
              className="pinyx-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="OpenAI"
            />

            <label className="pinyx-label">Base URL</label>
            <input
              className="pinyx-input"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />

            <label className="pinyx-label">API Key</label>
            <input
              className="pinyx-input"
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder={
                editingIndex !== null && config.providers[editingIndex!]?.hasApiKey
                  ? "Enter new key to replace"
                  : "API key"
              }
            />

            <div className="pinyx-btn-group">
              <button
                className="pinyx-btn-primary"
                disabled={saving || !draft.id.trim() || !draft.baseUrl.trim()}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button className="pinyx-btn-outline" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {savedFlash && <div className="pinyx-saved-flash">Saved ✓</div>}

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
            <button className="pinyx-error-bar-close" onClick={() => setError(null)}>×</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/active/PinyxKeysTab.tsx
git commit -m "feat: add PinyxKeysTab with provider table and inline edit/add"
```

---

### Task 7: Rebuild IntegrationsPanel

**Files:**
- Modify: `packages/frontend/src/active/IntegrationsPanel.tsx`

- [ ] **Step 1: Rewrite IntegrationsPanel.tsx**

Replace the entire content of `packages/frontend/src/active/IntegrationsPanel.tsx` with:

```tsx
import { useState, useEffect } from "react";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { saveGitHubConfig, getPinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";
import { TabBar } from "./TabBar";
import { PinyxConnectionTab } from "./PinyxConnectionTab";
import { PinyxModelsTab } from "./PinyxModelsTab";
import { PinyxKeysTab } from "./PinyxKeysTab";

interface IntegrationsPanelProps {
  open: boolean;
  github: UseGitHubReturn;
  onClose: () => void;
}

const PINYX_TABS = [
  { id: "connection", label: "Connection" },
  { id: "models", label: "Models" },
  { id: "keys", label: "Keys" },
];

export function IntegrationsPanel({ open, github, onClose }: IntegrationsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:5173");

  const [pinyxTab, setPinyxTab] = useState("connection");
  const [pinyx, setPinyx] = useState<PinyxConfigResponse | null>(null);
  const [pinyxError, setPinyxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getPinyxConfig().then(setPinyx).catch(() => setPinyxError("Failed to load PiNyx config"));
  }, [open]);

  useEffect(() => {
    if (open) { setEditing(false); setPinyxTab("connection"); }
  }, [open]);

  if (!open) return null;

  async function handleSaveConfig() {
    if (!appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()) return;
    setSaving(true);
    try {
      await saveGitHubConfig({
        appId: appId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        privateKey: privateKey.trim(),
        callbackUrl: callbackUrl.trim(),
        frontendUrl: frontendUrl.trim(),
      });
      setEditing(false);
      window.location.reload();
    } catch {
      // Error surfaces via config state
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    await github.connect();
  }

  // Derive GitHub section state
  const configured = github.config?.configured ?? false;
  const showConfigForm = !configured || editing;

  return (
    <div className="integrations-drawer" onClick={onClose}>
      <section className="integrations-drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="integrations-drawer-header">
          <div>
            <h2 className="integrations-drawer-title">Integrations</h2>
            <p className="integrations-drawer-subtitle">Configure services Aurex can use.</p>
          </div>
          <button className="integrations-drawer-close" onClick={onClose}>×</button>
        </div>

        {/* GitHub Section — unchanged */}
        <div className="pinyx-section">
          <div className="pinyx-section-header">
            <div>
              <h3 className="pinyx-section-title">GitHub</h3>
              <p className="pinyx-section-desc">
                {showConfigForm
                  ? "Register a GitHub App at github.com/settings/developers"
                  : "Connect via GitHub App OAuth."}
              </p>
            </div>
            <span style={{
              color: github.connected ? "var(--success)" : configured ? "var(--accent)" : "var(--text-muted)",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
            }}>
              {github.connected ? "CONNECTED" : configured ? "CONFIGURED" : "OFFLINE"}
            </span>
          </div>

          {github.connected && github.user && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
              <img src={github.user.avatar_url} alt={github.user.login} style={{ width: "24px", height: "24px", borderRadius: "50%" }} />
              <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>{github.user.login}</span>
            </div>
          )}

          {showConfigForm && (
            <>
              <label className="pinyx-label">App ID</label>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456" className="pinyx-input" />

              <label className="pinyx-label">Client ID</label>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Iv1.xxxxx" className="pinyx-input" />

              <label className="pinyx-label">Client Secret</label>
              <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GitHub App client secret" type="password" className="pinyx-input" />

              <label className="pinyx-label">Private Key (.pem)</label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                style={{ ...textInputStyle(), minHeight: "80px", resize: "vertical" }}
                className="pinyx-input"
              />

              <label className="pinyx-label">Callback URL</label>
              <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="http://localhost:3000/api/github/callback" className="pinyx-input" />

              <label className="pinyx-label">Frontend URL</label>
              <input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} placeholder="http://localhost:5173" className="pinyx-input" />

              <button
                onClick={() => void handleSaveConfig()}
                disabled={saving || !appId.trim() || !clientId.trim() || !clientSecret.trim() || !callbackUrl.trim() || !frontendUrl.trim()}
                className="pinyx-btn-primary"
                style={{ marginTop: "8px" }}
              >
                {saving ? "Saving..." : editing ? "Update Configuration" : "Save Configuration"}
              </button>
            </>
          )}

          {configured && !showConfigForm && (
            <>
              <div style={{ padding: "8px", background: "var(--bg-elevated)", borderRadius: "4px", marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Client ID</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.client_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Callback</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>{github.config?.callback_url}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>Secrets</span>
                  <span style={{ color: "var(--success)", fontSize: "11px" }}>✓ Saved</span>
                </div>
              </div>

              {!github.connected && (
                <div className="pinyx-btn-group">
                  <button className="pinyx-btn-outline" onClick={() => setEditing(true)}>Edit</button>
                  <button className="pinyx-btn-primary" onClick={() => void handleConnect()}>Connect</button>
                </div>
              )}
            </>
          )}

          {github.error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "8px" }}>{github.error}</p>}

          {github.connected && (
            <button className="pinyx-btn-danger" style={{ marginTop: "8px" }} onClick={() => void github.disconnect()}>
              Disconnect
            </button>
          )}
        </div>

        {/* PiNyx Section — tabbed */}
        <div style={{ marginTop: "16px" }}>
          <TabBar tabs={PINYX_TABS} active={pinyxTab} onChange={setPinyxTab} />

          {pinyxError && (
            <div className="pinyx-error-bar">
              <span>{pinyxError}</span>
              <button className="pinyx-error-bar-close" onClick={() => setPinyxError(null)}>×</button>
            </div>
          )}

          {pinyx && pinyxTab === "connection" && (
            <PinyxConnectionTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
          {pinyx && pinyxTab === "models" && (
            <PinyxModelsTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
          {pinyx && pinyxTab === "keys" && (
            <PinyxKeysTab config={pinyx} onConfigUpdate={setPinyx} />
          )}
        </div>
      </section>
    </div>
  );
}

function textInputStyle() {
  return { fontFamily: '"JetBrains Mono", monospace', fontSize: "10px" } as React.CSSProperties;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/active/IntegrationsPanel.tsx
git commit -m "feat: rebuild IntegrationsPanel with TabBar and 3 PiNyx tabs"
```

---

### Task 8: Make TopBar PiNyx status clickable

**Files:**
- Modify: `packages/frontend/src/frame/TopBar.tsx`

- [ ] **Step 1: Make the PiNyx StatusItem clickable**

In `packages/frontend/src/frame/TopBar.tsx`, find the PiNyx StatusItem line:

```tsx
<StatusItem color={pinyxConfigured ? "var(--success)" : "var(--warning)"} label={pinyxConfigured ? "PINYX CONNECTED" : "PINYX OFFLINE"} />
```

Replace it with a clickable wrapper:

```tsx
<button
  onClick={onOpenIntegrations}
  style={{
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  }}
  title="Open PiNyx settings"
>
  <StatusItem color={pinyxConfigured ? "var(--success)" : "var(--warning)"} label={pinyxConfigured ? "PINYX CONNECTED" : "PINYX OFFLINE"} />
</button>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p packages/frontend/tsconfig.json 2>&1 | head -20`
Expected: No errors (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/frame/TopBar.tsx
git commit -m "feat: make TopBar PiNyx status clickable to open integrations"
```

---

### Task 9: Verify everything works

- [ ] **Step 1: Run all backend tests**

Run: `npx vitest run`
Expected: All tests pass (311+)

- [ ] **Step 2: Verify frontend builds**

Run: `npx vite build --config packages/frontend/vite.config.ts 2>&1 | tail -5`
Expected: Build succeeds with no errors

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration polish for PiNyx panel redesign"
```
