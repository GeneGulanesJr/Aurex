# New Mission Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New Mission" form to the MissionSidebar so users can create missions directly from the UI instead of using curl.

**Architecture:** The form lives inside `MissionSidebar` as a collapsible panel at the top. It calls the existing `createMission()` API function (with a new error-check guard). On success, the `useMissions` hook's WebSocket handler picks up the `mission_queued` event and adds it to the list — but without a description (the WS event only carries `missionId` + `queuePosition`). To avoid showing a raw ID like `m-1780053468613-9y3yej` in the sidebar, the `useMissions` reducer gets a new `MISSION_CREATED` action that optimistically stores the description before the WS event arrives.

**Tech Stack:** React (useState/useCallback), Vitest, existing Tailwind dark theme, existing `createMission` API function. Tests use the project's existing pattern — pure unit tests with `vi.fn()` mocks, no `@testing-library/react` (not installed, no jsdom env).

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/frontend/src/api.ts:20-28` | Add `res.ok` check to `createMission` |
| Create | `packages/frontend/src/active/useNewMissionForm.ts` | Form state logic hook (pure, testable) |
| Create | `packages/frontend/src/active/useNewMissionForm.test.ts` | Tests for the hook |
| Create | `packages/frontend/src/active/NewMissionForm.tsx` | The form UI component (thin, no logic) |
| Modify | `packages/frontend/src/hooks/useMissions.ts` | Add `MISSION_CREATED` action for optimistic description |
| Modify | `packages/frontend/src/active/MissionSidebar.tsx` | Integrate NewMissionForm into sidebar header |
| Modify | `packages/frontend/src/App.tsx` | Wire `createMission` + optimistic dispatch into sidebar |

---

### Task 1: Fix `createMission` error handling in `api.ts`

The current `createMission` function does not check `res.ok`, so a 400 response from the backend ("description is required") silently resolves with the error JSON body instead of throwing. Every other API function (`getCurrentMission`, `getActiveMissions`, `getMission`, `abortMission`) checks `res.ok`. This brings `createMission` in line.

**Files:**
- Modify: `packages/frontend/src/api.ts:20-28`
- Modify: `packages/frontend/src/api.test.ts` (add 2 tests)

- [ ] **Step 1: Write the failing tests**

Add these tests to `packages/frontend/src/api.test.ts`:

```ts
it("createMission throws on non-OK response", async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: "description is required" }),
  });

  await expect(createMission("")).rejects.toThrow("Failed to create mission: 400");
});

it("createMission returns missionId on success", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ missionId: "m-1", status: "queued" }),
  });

  const result = await createMission("Build a login page");
  expect(result).toEqual({ missionId: "m-1", status: "queued" });
  expect(mockFetch).toHaveBeenCalledWith(
    "/api/missions",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
      body: JSON.stringify({ description: "Build a login page" }),
    }),
  );
});
```

Add import at top of test file:
```ts
import { createMission } from "./api";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/api.test.ts 2>&1 | tail -20`
Expected: The `createMission throws on non-OK response` test FAILS (it resolves instead of throwing). The `createMission returns missionId on success` test FAILS (function not imported yet — actually it is exported, but the import needs adding; or it passes because the function works for happy path already). Actually: the throw test fails because `createMission` doesn't throw on `!res.ok`. The success test passes.

- [ ] **Step 3: Fix `createMission` to check `res.ok`**

In `packages/frontend/src/api.ts`, change `createMission` from:

```ts
export async function createMission(description: string): Promise<CreateMissionResponse> {
  const res = await apiFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json() as Promise<CreateMissionResponse>;
}
```

to:

```ts
export async function createMission(description: string): Promise<CreateMissionResponse> {
  const res = await apiFetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`Failed to create mission: ${res.status}`);
  return res.json() as Promise<CreateMissionResponse>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/api.test.ts 2>&1 | tail -20`
Expected: All tests PASS (4 total — 2 existing + 2 new)

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/api.test.ts
git commit -m "fix(frontend): add error handling to createMission API call"
```

---

### Task 2: `useNewMissionForm` hook (pure logic, tested)

Extract form state logic into a pure hook so it can be tested without `@testing-library/react` (not installed, no jsdom env). The hook manages `open`, `description`, `submitting`, `error` states and exposes `open`, `close`, `setDescription`, `handleSubmit`, `handleKeyDown`, `canSubmit`.

**Files:**
- Create: `packages/frontend/src/active/useNewMissionForm.ts`
- Create: `packages/frontend/src/active/useNewMissionForm.test.ts`

- [ ] **Step 1: Write the failing tests**

The tests call the hook's logic directly by testing the reducer (same pattern as `useMission.test.ts` which tests `missionReducer` directly).

```ts
// packages/frontend/src/active/useNewMissionForm.test.ts
import { describe, it, expect, vi } from "vitest";
import { formReducer, initialFormState } from "./useNewMissionForm";
import type { FormState, FormAction } from "./useNewMissionForm";

describe("formReducer", () => {
  it("opens the form", () => {
    const state = formReducer(initialFormState, { type: "OPEN" });
    expect(state.open).toBe(true);
    expect(state.description).toBe("");
    expect(state.error).toBeNull();
  });

  it("closes and resets the form", () => {
    const state: FormState = { open: true, description: "some text", submitting: false, error: null };
    const next = formReducer(state, { type: "CLOSE" });
    expect(next.open).toBe(false);
    expect(next.description).toBe("");
    expect(next.error).toBeNull();
  });

  it("updates description", () => {
    const state = formReducer(initialFormState, { type: "SET_DESCRIPTION", value: "Build login" });
    expect(state.description).toBe("Build login");
  });

  it("sets submitting and clears error", () => {
    const state: FormState = { open: true, description: "test", submitting: false, error: "old error" };
    const next = formReducer(state, { type: "SUBMIT_START" });
    expect(next.submitting).toBe(true);
    expect(next.error).toBeNull();
  });

  it("sets error and clears submitting on failure", () => {
    const state: FormState = { open: true, description: "test", submitting: true, error: null };
    const next = formReducer(state, { type: "SUBMIT_ERROR", error: "Server error" });
    expect(next.submitting).toBe(false);
    expect(next.error).toBe("Server error");
    expect(next.open).toBe(true);
  });

  it("resets and closes on submit success", () => {
    const state: FormState = { open: true, description: "test", submitting: true, error: null };
    const next = formReducer(state, { type: "SUBMIT_SUCCESS" });
    expect(next.open).toBe(false);
    expect(next.description).toBe("");
    expect(next.submitting).toBe(false);
  });
});

describe("submitIfValid", () => {
  it("calls onSubmit with trimmed description and dispatches SUBMIT_SUCCESS", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn();
    await submitIfValid("  Build login  ", false, onSubmit, dispatch);
    expect(onSubmit).toHaveBeenCalledWith("Build login");
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_START" });
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_SUCCESS" });
  });

  it("does nothing when description is empty", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn();
    const dispatch = vi.fn();
    await submitIfValid("   ", false, onSubmit, dispatch);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when already submitting", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn();
    const dispatch = vi.fn();
    await submitIfValid("valid", true, onSubmit, dispatch);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches SUBMIT_ERROR when onSubmit rejects", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockRejectedValue(new Error("Server error"));
    const dispatch = vi.fn();
    await submitIfValid("valid", false, onSubmit, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_START" });
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_ERROR", error: "Server error" });
  });

  it("uses fallback message for non-Error rejections", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockRejectedValue("string error");
    const dispatch = vi.fn();
    await submitIfValid("valid", false, onSubmit, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_ERROR", error: "Failed to create mission" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/active/useNewMissionForm.test.ts 2>&1 | tail -20`
Expected: FAIL — module `./useNewMissionForm` not found

- [ ] **Step 3: Implement the hook logic**

```ts
// packages/frontend/src/active/useNewMissionForm.ts
import { useReducer, useCallback } from "react";

export interface FormState {
  open: boolean;
  description: string;
  submitting: boolean;
  error: string | null;
}

export type FormAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; error: string };

export const initialFormState: FormState = {
  open: false,
  description: "",
  submitting: false,
  error: null,
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "OPEN":
      return { ...initialFormState, open: true };
    case "CLOSE":
      return initialFormState;
    case "SET_DESCRIPTION":
      return { ...state, description: action.value };
    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };
    case "SUBMIT_SUCCESS":
      return initialFormState;
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.error };
    default:
      return state;
  }
}

export async function submitIfValid(
  description: string,
  submitting: boolean,
  onSubmit: (description: string) => Promise<void>,
  dispatch: React.Dispatch<FormAction>,
): Promise<void> {
  const trimmed = description.trim();
  if (!trimmed || submitting) return;
  dispatch({ type: "SUBMIT_START" });
  try {
    await onSubmit(trimmed);
    dispatch({ type: "SUBMIT_SUCCESS" });
  } catch (err) {
    dispatch({ type: "SUBMIT_ERROR", error: err instanceof Error ? err.message : "Failed to create mission" });
  }
}

export function useNewMissionForm(onSubmit: (description: string) => Promise<void>) {
  const [state, dispatch] = useReducer(formReducer, initialFormState);

  const handleSubmit = useCallback(() => {
    submitIfValid(state.description, state.submitting, onSubmit, dispatch);
  }, [state.description, state.submitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const open = useCallback(() => dispatch({ type: "OPEN" }), []);
  const close = useCallback(() => dispatch({ type: "CLOSE" }), []);
  const setDescription = useCallback((value: string) => dispatch({ type: "SET_DESCRIPTION", value }), []);

  return {
    state,
    open,
    close,
    setDescription,
    handleSubmit,
    handleKeyDown,
    canSubmit: state.description.trim().length > 0 && !state.submitting,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/active/useNewMissionForm.test.ts 2>&1 | tail -20`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/active/useNewMissionForm.ts packages/frontend/src/active/useNewMissionForm.test.ts
git commit -m "feat(frontend): add useNewMissionForm hook with reducer logic and tests"
```

---

### Task 3: NewMissionForm UI component

Thin React component that renders the form using the `useNewMissionForm` hook. No logic to test — all logic is in the hook (Task 2).

**Files:**
- Create: `packages/frontend/src/active/NewMissionForm.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/frontend/src/active/NewMissionForm.tsx
import { useNewMissionForm } from "./useNewMissionForm";

interface NewMissionFormProps {
  onSubmit: (description: string) => Promise<void>;
}

export function NewMissionForm({ onSubmit }: NewMissionFormProps) {
  const { state, open, close, setDescription, handleSubmit, handleKeyDown, canSubmit } = useNewMissionForm(onSubmit);

  if (!state.open) {
    return (
      <button
        onClick={open}
        className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors text-left"
      >
        + New Mission
      </button>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2 border-b border-gray-800">
      <textarea
        value={state.description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want done..."
        className="w-full bg-gray-900 text-sm text-gray-200 rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none resize-none placeholder-gray-600"
        rows={3}
        autoFocus
        disabled={state.submitting}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
        >
          {state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={close}
          className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm -F frontend exec tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/NewMissionForm.tsx
git commit -m "feat(frontend): add NewMissionForm UI component"
```

---

### Task 4: Optimistic description in `useMissions`

The `mission_queued` WebSocket event only has `missionId` + `queuePosition` — no `description`. When the user creates a mission and it appears in the sidebar, they'd see a raw ID like `m-1780053468613-9y3yej` instead of "Build a login page". Fix by adding a `MISSION_CREATED` action that stores the description optimistically before the WS event arrives. When the WS `mission_queued` event arrives, it matches by `missionId` and updates state/queuePosition but preserves the description.

**Files:**
- Modify: `packages/frontend/src/hooks/useMissions.ts` (add `MISSION_CREATED` action type + reducer case + `addOptimisticMission` callback)
- Create: `packages/frontend/src/hooks/useMissions.test.ts` (new test file for the missions reducer)

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/hooks/useMissions.test.ts
import { describe, it, expect } from "vitest";
import { missionsReducer, initialMissionsState } from "./useMissions";

describe("missionsReducer", () => {
  it("adds a mission with optimistic description on MISSION_CREATED", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "MISSION_CREATED",
      missionId: "m-1",
      description: "Build a login page",
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0]).toEqual({
      missionId: "m-1",
      state: "planning",
      description: "Build a login page",
    });
    expect(state.selectedMissionId).toBe("m-1");
  });

  it("preserves description when WS_MISSION_QUEUED arrives for same mission", () => {
    const withCreated = missionsReducer(initialMissionsState, {
      type: "MISSION_CREATED",
      missionId: "m-1",
      description: "Build a login page",
    });
    const state = missionsReducer(withCreated, {
      type: "WS_MISSION_QUEUED",
      missionId: "m-1",
      queuePosition: 1,
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0].description).toBe("Build a login page");
    expect(state.missions[0].state).toBe("queued");
    expect(state.missions[0].queuePosition).toBe(1);
  });

  it("adds new mission from WS_MISSION_QUEUED when no MISSION_CREATED was dispatched", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "WS_MISSION_QUEUED",
      missionId: "m-1",
      queuePosition: 1,
    });
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0].missionId).toBe("m-1");
    expect(state.missions[0].description).toBeUndefined();
  });

  it("selects first non-completed mission on SET_MISSIONS", () => {
    const state = missionsReducer(initialMissionsState, {
      type: "SET_MISSIONS",
      missions: [
        { missionId: "m-1", state: "completed" },
        { missionId: "m-2", state: "queued" },
        { missionId: "m-3", state: "planning" },
      ],
    });
    expect(state.selectedMissionId).toBe("m-2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/hooks/useMissions.test.ts 2>&1 | tail -20`
Expected: FAIL — `missionsReducer` is not exported (it's currently an unexported local function called `reducer`)

- [ ] **Step 3: Modify `useMissions.ts` — export reducer, add `MISSION_CREATED`, preserve description on WS events**

Changes needed in `packages/frontend/src/hooks/useMissions.ts`:

**a) Export the initial state and rename `reducer` to `missionsReducer` for external testability:**

Change:
```ts
function reducer(state: MissionsState, action: Action): MissionsState {
```
To:
```ts
export function missionsReducer(state: MissionsState, action: Action): MissionsState {
```

Change:
```ts
const initial: MissionsState = {
```
To:
```ts
export const initialMissionsState: MissionsState = {
```

Update the `useReducer` call inside `useMissions()`:
```ts
const [state, dispatch] = useReducer(missionsReducer, initialMissionsState);
```

**b) Add `MISSION_CREATED` to the `Action` union:**

```ts
type Action =
  | { type: "SET_MISSIONS"; missions: MissionListItem[] }
  | { type: "SELECT"; missionId: string }
  | { type: "MISSION_CREATED"; missionId: string; description: string }
  | { type: "WS_MISSION_QUEUED"; missionId: string; queuePosition: number }
  | { type: "WS_MISSION_STARTED"; missionId: string }
  | { type: "WS_MISSION_COMPLETED"; missionId: string; finalState: string }
  | { type: "REMOVE"; missionId: string };
```

**c) Add `MISSION_CREATED` case to the reducer (after `SELECT` case):**

```ts
    case "MISSION_CREATED": {
      const exists = state.missions.some((m) => m.missionId === action.missionId);
      if (exists) return state;
      const newMissions = [...state.missions, { missionId: action.missionId, state: "planning" as const, description: action.description }];
      const selectedMissionId = state.selectedMissionId ?? action.missionId;
      return { ...state, missions: newMissions, selectedMissionId };
    }
```

**d) Update `WS_MISSION_QUEUED` new-mission branch to preserve description from existing entry:**

The existing code for the `!exists` branch in `WS_MISSION_QUEUED`:
```ts
      const newMissions = [...state.missions, { missionId: action.missionId, state: "queued" as const, queuePosition: action.queuePosition as number }];
```

This stays the same — it only runs when the mission doesn't already exist (no prior `MISSION_CREATED`). When it does exist, the `exists` branch maps over and preserves all fields including `description`.

**e) Add `addOptimisticMission` callback to `useMissions()`:**

After `removeMission`:
```ts
  const addOptimisticMission = useCallback((missionId: string, description: string) => {
    dispatch({ type: "MISSION_CREATED", missionId, description });
  }, []);

  return { state, selectMission, removeMission, addOptimisticMission, handleWsEvent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run packages/frontend/src/hooks/useMissions.test.ts 2>&1 | tail -20`
Expected: All 4 tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useMissions.ts packages/frontend/src/hooks/useMissions.test.ts
git commit -m "feat(frontend): add MISSION_CREATED action for optimistic description in useMissions"
```

---

### Task 5: Integrate NewMissionForm into MissionSidebar

**Files:**
- Modify: `packages/frontend/src/active/MissionSidebar.tsx`

- [ ] **Step 1: Add `onCreateMission` prop and NewMissionForm to MissionSidebar**

Changes to `packages/frontend/src/active/MissionSidebar.tsx`:

**a) Add import:**
```ts
import { NewMissionForm } from "./NewMissionForm";
```

**b) Add `onCreateMission` to the props interface:**
```ts
interface MissionSidebarProps {
  missions: MissionListItem[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onRemove: (missionId: string) => void;
  onCreateMission: (description: string) => Promise<void>;
}
```

**c) Add to function signature:**
```ts
export function MissionSidebar({ missions, selectedMissionId, onSelect, onRemove, onCreateMission }: MissionSidebarProps) {
```

**d) Add `<NewMissionForm onSubmit={onCreateMission} />` after the header in both the empty state and populated state branches.**

In the **empty state** (`if (missions.length === 0)`) block, add between the header div and the "No missions" div:
```tsx
      <NewMissionForm onSubmit={onCreateMission} />
```

In the **populated state** (the second `<aside>` return), add between the header div and the scrollable list:
```tsx
    <NewMissionForm onSubmit={onCreateMission} />
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm -F frontend exec tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/active/MissionSidebar.tsx
git commit -m "feat(frontend): integrate NewMissionForm into MissionSidebar"
```

---

### Task 6: Wire `handleCreateMission` in App.tsx

This is the critical wiring task. The `handleCreateMission` callback in App needs to:
1. Call `createMission(description)` API
2. On success, dispatch `addOptimisticMission(missionId, description)` so the sidebar shows the description immediately
3. The backend's `mission_queued` WS event then arrives and updates the state/queuePosition while preserving the description

**Files:**
- Modify: `packages/frontend/src/App.tsx`

- [ ] **Step 1: Update imports**

Change:
```ts
import { submitCheckpoint } from "./api";
```
To:
```ts
import { submitCheckpoint, createMission } from "./api";
```

- [ ] **Step 2: Destructure `addOptimisticMission` from `useMissions`**

Change:
```ts
  const { state: missionsState, selectMission, removeMission, handleWsEvent: missionsWsHandler } = useMissions();
```
To:
```ts
  const { state: missionsState, selectMission, removeMission, addOptimisticMission, handleWsEvent: missionsWsHandler } = useMissions();
```

- [ ] **Step 3: Add `handleCreateMission` callback**

After the `handleDecision` callback, add:

```tsx
  const handleCreateMission = useCallback(async (description: string) => {
    const { missionId } = await createMission(description);
    addOptimisticMission(missionId, description);
  }, [addOptimisticMission]);
```

This two-step flow is important:
- `createMission` returns `{ missionId, status }` — we need the `missionId` to link the optimistic entry to the upcoming WS event
- `addOptimisticMission` stores the description so the sidebar shows "Build a login page" instead of `m-1780053468613-9y3yej`
- When the WS `mission_queued` event arrives (same `missionId`), it updates `state`/`queuePosition` but preserves the `description`

- [ ] **Step 4: Pass `onCreateMission` to MissionSidebar**

Change:
```tsx
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
        />
```
To:
```tsx
        <MissionSidebar
          missions={missionsState.missions}
          selectedMissionId={missionsState.selectedMissionId}
          onSelect={selectMission}
          onRemove={removeMission}
          onCreateMission={handleCreateMission}
        />
```

- [ ] **Step 5: Verify it compiles and all tests pass**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm -F frontend exec tsc --noEmit 2>&1 | head -20`
Expected: No errors

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm exec vitest run 2>&1 | tail -20`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "feat(frontend): wire NewMissionForm to createMission API with optimistic description"
```

---

### Task 7: Docker E2E Verification

**Files:**
- No files to modify — verify the existing Docker build still works

- [ ] **Step 1: Rebuild the frontend Docker image**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && docker compose -f docker-compose.e2e.yml build frontend 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 2: Run the full e2e test suite**

Run: `cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && docker compose -f docker-compose.e2e.yml down 2>&1; bash scripts/e2e-docker.sh 2>&1 | grep -E '(✅|❌|Results|═══)'`
Expected: 18 passed, 0 failed

- [ ] **Step 3: Commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(frontend): any Docker build adjustments for NewMissionForm"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "New Mission" form in the UI → Task 3 (component), Task 5 (sidebar integration), Task 6 (API wiring)
- ✅ Form has textarea, submit, cancel → Task 3
- ✅ Enter to submit, Shift+Enter for newline → Task 2 (handleKeyDown logic)
- ✅ Error handling → Task 1 (API `res.ok` check), Task 2 (reducer SUBMIT_ERROR)
- ✅ Loading state during submission → Task 2 (submitting state)
- ✅ Sidebar shows description, not raw ID → Task 4 (optimistic MISSION_CREATED)
- ✅ `createMission` throws on server error → Task 1 (res.ok check)

**2. Placeholder scan:**
- ✅ No TBD, TODO, "implement later", "add validation" without code
- ✅ No "similar to Task N" — all code is explicit
- ✅ No "write tests for the above" without test code

**3. Type consistency:**
- ✅ `onSubmit: (description: string) => Promise<void>` — same signature in `NewMissionFormProps`, `useNewMissionForm`, `MissionSidebarProps.onCreateMission`, and `App.handleCreateMission`
- ✅ `createMission(description: string)` returns `Promise<CreateMissionResponse>` (which has `missionId: string; status: string`) — `handleCreateMission` destructures `missionId` from it
- ✅ `addOptimisticMission(missionId: string, description: string)` matches the `MISSION_CREATED` action's fields
- ✅ `MissionListItem.description` is `string | undefined` — `MISSION_CREATED` sets it as `string`, `WS_MISSION_QUEUED` new-entry branch omits it (undefined). Both are valid.

**4. Review issues resolved:**
- ✅ **No @testing-library/react dependency** — Tasks use pure unit tests matching existing project pattern (reducer testing with `vi.fn()`)
- ✅ **`createMission` error handling** — Task 1 adds `res.ok` check before execution
- ✅ **Optimistic description** — Task 4 adds `MISSION_CREATED` action so sidebar shows description immediately, not raw ID
- ✅ **TDD order** — Tests written before implementation in every task (Task 1: test → fix, Task 2: test → implement, Task 4: test → implement)

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-new-mission-form.md`.**

**Which execution approach?**

- **Sequential mode** (subagents) — I dispatch a fresh subagent per task, two-stage review (spec then quality). Fast iteration.
- **Direct mode** (no subagents) — Execute tasks in this session with checkpoint reviews. Same quality discipline, no agent delegation.

Both are part of superpowers:subagent-driven-development.
