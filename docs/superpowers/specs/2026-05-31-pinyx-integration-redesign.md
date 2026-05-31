# PiNyx Integration Panel Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, ugly PiNyx configuration form with a polished, tabbed integration panel that matches the Aurex Mission Control design system — with live connection health, auto-detect model defaults with per-agent overrides, and a table-based provider manager.

**Why:** The current panel is a kitchen-sink form with no visual hierarchy, no connection feedback, opaque model routing, and raw provider forms. It looks nothing like a mission-grade interface.

---

## Architecture

The panel stays as a slide-out drawer (consistent with the GitHub integration UX) but is completely rebuilt internally with three tabs:

```
┌──────────────────────────────┐
│  INTEGRATIONS            ×   │
│  Configure services          │
│                              │
│  [Connection] [Models] [Keys]│
│  ─────────────────────────── │
│                              │
│  (tab content)               │
│                              │
└──────────────────────────────┘
```

All styling uses DESIGN.md tokens via CSS custom properties. No inline style objects — all styles move to `src/styles.css` as CSS classes. This is a hard requirement for consistency.

---

## Tab 1: Connection

### Layout

```
┌──────────────────────────────┐
│  ● PiNyx Gateway             │
│    LLM orchestration layer    │
│                               │
│  ┌───────────────────────────┐│
│  │ ENDPOINT                  ││
│  │ http://127.0.0.1:7331    ││
│  └───────────────────────────┘│
│                               │
│  [  Test Connection  ]        │
│                               │
│  ┌─ Status ─────────────────┐│
│  │ ● Connected  12ms        ││
│  │ 3 models available       ││
│  │ kilo/kilo-auto/free      ││
│  │ kilo/kilo-auto/pro       ││
│  │ kilo/kilo-auto/enterprise││
│  └───────────────────────────┘│
│                               │
│  [ Save Endpoint ]            │
└──────────────────────────────┘
```

### Behavior

1. **Endpoint input** — pre-filled from saved config. Monospace font, full width.
2. **Test Connection button** — calls `GET {endpoint}/v1/models` with a 5-second timeout. Shows three states:
   - Idle: default btn-outline style
   - Testing: spinner animation, button disabled
   - Success: green accent, shows latency in ms and model count
   - Failure: red error, shows error message (timeout, 502, DNS failure)
3. **Status card** — only visible after a successful test. Shows:
   - Green status dot with glow animation
   - Latency badge (e.g., `12ms`)
   - Model count with expandable list (collapsed by default, click to expand)
4. **Save Endpoint** — saves endpoint to LaPis settings. Disabled until a test succeeds. On save, shows a brief "Saved ✓" confirmation that fades after 2s.

### Design tokens

- Endpoint input: `--bg-inset` background, `--border` border, `--text-primary` text
- Status dot: `--success` color with `box-shadow: 0 0 6px` glow
- Latency badge: `--text-secondary` color, `mono-value` typography
- Test Connection success: `--accent` colored button briefly, then outline again
- Test Connection failure: `--error` colored status text

---

## Tab 2: Models

### Layout

```
┌──────────────────────────────┐
│  Model Routing                │
│  Auto-detect with overrides.  │
│                               │
│  ┌─ Default Model ──────────┐│
│  │ kilo/kilo-auto/free      ││
│  │ ▾ change                  ││
│  └───────────────────────────┘│
│                               │
│  ┌─ Orchestrator ───────────┐│
│  │ Plans missions. Uses      ││
│  │ default model.            ││
│  │ kilo/kilo-auto/free      ││
│  └───────────────────────────┘│
│                               │
│  ┌─ Worker ─────────────────┐│
│  │ Writes code. Uses         ││
│  │ default model.            ││
│  │ kilo/kilo-auto/free      ││
│  └───────────────────────────┘│
│                               │
│  ┌─ Validator ──────────────┐│
│  │ Reviews quality. Uses     ││
│  │ default model.            ││
│  │ kilo/kilo-auto/free      ││
│  └───────────────────────────┘│
│                               │
│  ┌─ Research ───────────────┐│
│  │ Gathers context. Uses     ││
│  │ default model.            ││
│  │ kilo/kilo-auto/free      ││
│  └───────────────────────────┘│
│                               │
│  [ Save Model Routing ]       │
└──────────────────────────────┘
```

### Behavior

1. **Default Model** — top card. Select dropdown populated from PiNyx models (fetched on Connection tab test, or cached from last fetch). When this changes, all agent cards that say "Uses default model" update silently.

2. **Agent cards** (Orchestrator, Worker, Validator, Research) — each shows:
   - Agent role name (heading-sm typography)
   - One-line description of what this agent does
   - Current model assignment — either "Uses default model" (dimmed text, inherits default) or an explicit override (accent-colored)
   - Click to expand: shows a model dropdown to override. Has a "Reset to default" link to clear the override.

3. **Collapsed state** — each card is compact (one line: role name + model). Click to expand into the full card with description and override dropdown.

4. **Override logic** — if an agent has an explicit model set, show it in accent color. If using default, show in muted text. The data model stays the same (`modelHints: Record<AgentType, string>`) — the "default" value is simply whatever the default model dropdown is set to. Agents without explicit overrides store the default value.

5. **Save Model Routing** — saves the full modelHints object. Disabled if no changes from loaded state.

### Agent descriptions

| Agent | Description |
|-------|-------------|
| Orchestrator | Plans missions and decomposes goals into milestones |
| Worker | Writes code and implements working units |
| Validator | Reviews code quality and runs test suites |
| Research | Gathers context and investigates solutions |

### Design tokens

- Cards: `--bg-inset` background, `--border` border, `rounded.lg`
- Agent name: `heading-sm` typography, `--text-primary`
- Description: `caption` typography, `--text-secondary`
- "Uses default": `--text-muted` color
- Override model: `--accent` color
- Expanded state: subtle `--bg-elevated` inset, `--border-bright` border

---

## Tab 3: Keys (Providers)

### Layout

```
┌──────────────────────────────┐
│  Provider Keys                │
│  API keys for LLM providers.  │
│                               │
│  ┌────────────────────────────┤
│  │ openai        ● Saved   ✎ │
│  │ api.openai.com/v1         │
│  ├────────────────────────────┤
│  │ anthropic      ● Saved   ✎ │
│  │ api.anthropic.com/v1      │
│  ├────────────────────────────┤
│  │ kilo           ● Saved   ✎ │
│  │ api.kilo.ai/v1            │
│  └────────────────────────────┘
│                               │
│  [ + Add Provider ]           │
│                               │
│  ── or editing: ──            │
│                               │
│  ┌─ Edit Provider ───────────┐│
│  │ Provider ID               ││
│  │ [openai            ]      ││
│  │                           ││
│  │ Display Name              ││
│  │ [OpenAI             ]     ││
│  │                           ││
│  │ Base URL                  ││
│  │ [https://api.openai... ]  ││
│  │                           ││
│  │ API Key                   ││
│  │ [••••••••••••••••    ]    ││
│  │                           ││
│  │ [ Test ] [ Save ] [ Cancel]│
│  └───────────────────────────┘│
└──────────────────────────────┘
```

### Behavior

1. **Provider table** — rows with three columns:
   - Left: provider ID (mono) + base URL (muted, below)
   - Center: key status badge — "Saved" (green dot) or "No key" (dimmed)
   - Right: edit icon button (`✎`)

2. **Add Provider** — opens an inline form below the table (not a modal). Form has: Provider ID, Display Name, Base URL, API Key. "Save" adds the row. "Cancel" collapses the form.

3. **Edit provider** — clicking `✎` expands that row into the edit form (same form as add, pre-filled). Replaces the table row temporarily.

4. **Test button** (in edit form) — sends a test request to the provider's base URL to verify connectivity. Shows success/failure inline.

5. **API Key field** — if a key is saved (`hasApiKey: true`), show masked (`••••••••`) with placeholder text "Enter new key to replace". Empty if no key saved.

### Design tokens

- Table rows: `--bg-inset` background, `--border` bottom border between rows
- Provider ID: `mono-value` typography, `--text-primary`
- Base URL: `mono-value` typography, `--text-muted`
- Key status badge: `label` typography, green `--success` dot or dimmed `--text-muted`
- Edit icon: `--text-muted` hover → `--accent`
- Edit form: `--bg-elevated` background, `--border-bright` border

---

## Shared Components

### Tab Bar

Three tab buttons in a row. Active tab has `--accent` bottom border (2px). Inactive tabs have `--text-muted` text that brightens to `--text-secondary` on hover. Uses `heading-sm` typography.

```
[ Connection ] [ Models ] [ Keys ]
  ═══════════
```

### Save Button Pattern

All three tabs have their own Save button at the bottom. States:
- Default (no changes): `btn-outline`, disabled
- Dirty (unsaved changes): `btn-primary`, enabled
- Saving: spinner, disabled, "Saving..."
- Saved: brief "Saved ✓" text that fades after 2s, returns to default disabled state

### Error Display

Errors appear as a slim bar above the save button:
- Background: `--error` glow (`--accent-glow` equivalent but red-tinted)
- Text: `--error` color
- Dismissible with × or auto-clears after 10s

---

## TopBar Integration

Add a PiNyx status indicator to the TopBar/telemetry bar:

- Small dot (6px) with the PiNyx label
- Green dot = connected (pinged successfully in last 60s)
- Red dot = unreachable
- Dimmed dot = not configured
- Clicking the dot opens the Integrations panel to the Connection tab

---

## Data Flow

### Existing API (no backend changes needed)

The redesign uses the existing API endpoints:

| Endpoint | Method | Used In |
|----------|--------|---------|
| `/api/pinyx/config` | GET | Load config on panel open |
| `/api/pinyx/config` | POST | Save config from any tab |
| `/api/pinyx/models` | GET | Populate model dropdowns |
| `/api/pinyx/status` | GET | TopBar status dot |

The `PinyxConfigResponse` shape stays the same:
```typescript
{
  endpoint: string;
  modelHints: Record<string, string>;
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    hasApiKey?: boolean;
    apiKey?: string;
  }>;
}
```

### New: Connection Test

The "Test Connection" button calls PiNyx directly from the browser:
```
GET {endpoint}/v1/models
```
With a 5-second `AbortController` timeout. No backend endpoint needed — this is a direct browser fetch to the PiNyx gateway (which is typically on localhost anyway).

---

## File Changes

### Files to Create

| File | Purpose |
|------|---------|
| `packages/frontend/src/active/PinyxConnectionTab.tsx` | Tab 1: Connection endpoint + health |
| `packages/frontend/src/active/PinyxModelsTab.tsx` | Tab 2: Model routing with defaults + overrides |
| `packages/frontend/src/active/PinyxKeysTab.tsx` | Tab 3: Provider key management |
| `packages/frontend/src/active/TabBar.tsx` | Reusable tab bar component |

### Files to Modify

| File | Change |
|------|--------|
| `packages/frontend/src/active/IntegrationsPanel.tsx` | Rebuild: add TabBar, import 3 PiNyx tabs, keep GitHub section as-is |
| `packages/frontend/src/styles.css` | Add all new CSS classes for the panel redesign |

### Files Unchanged

| File | Reason |
|------|--------|
| `packages/frontend/src/api.ts` | All existing endpoints cover our needs |
| `packages/backend/src/routes/*` | No backend changes |
| `packages/shared/src/types.ts` | No type changes |

---

## Acceptance Criteria

1. Panel opens as slide-out drawer, shows tabbed navigation
2. Connection tab: endpoint input, Test Connection with latency display, status card with model list
3. Models tab: default model dropdown, collapsible agent cards with role descriptions, override per agent
4. Keys tab: provider table with key status badges, inline edit/add forms
5. All styling uses DESIGN.md tokens via CSS classes (no inline style objects)
6. TopBar shows PiNyx status dot that opens the panel on click
7. All existing tests pass unchanged
8. Save flows work identically to current (same API, same data shapes)
