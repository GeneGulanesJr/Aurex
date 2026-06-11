# Agentic Loop Hardening — Fix 9 Review Issues + Validator Rescope Death Spiral

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 9 issues identified in the agentic coding loop review, PLUS fix the critical validator-rescope death spiral where the validator hits the tool-call cap → synthetic verdict is discarded by the negotiator → "Missing scrutiny validator verdict" → rescope → new workers → same cap hit → repeat forever.

**Architecture:** 11 tasks in 4 phases. Phase 1 is the critical path (validator death spiral). Phase 2 is the runner dedup and recursion guard. Phase 3 is the research-before-workers reorder. Phase 4 is the remaining medium/low issues.

**Tech Stack:** TypeScript, Vitest, existing Pi SDK session API.

---

## Root Cause Analysis: Validator Rescope Death Spiral

The user's logs show this exact cycle:

```
validator_scrutiny → reviewing
tool_call_cap_exceeded: 26 calls (cap 25)
validator_scrutiny → failed
ESCALATION: Missing scrutiny validator verdict
(rescope auto-triggers)
(new workers run)
validator_scrutiny → reviewing
tool_call_cap_exceeded: 26 calls (cap 25)
... repeat forever
```

**Three compounding bugs:**

1. **Synthetic verdict is written but the negotiator says "Missing scrutiny validator verdict"** — The `if (!scrutinyVerdict)` branch fires, meaning the verdict either wasn't found or was discarded by `verifyCreatorSession`.

   **Investigation findings:**
   - The `agent_sessions` table schema is `(session_id, agent_type, mission_id, milestone_id, unit_id)` — NO `terminated_at` or `spawned_at` columns. The `AgentSessionRecord` type defines `terminatedAt: string | null` but it's **never populated** from the DB — `SELECT *` returns only the 5 columns. So `verifyCreatorSession`'s `terminatedAt` check is checking `undefined` which is falsy, meaning it **never rejects** on termination. This rules out termination as the cause.
   - The `sessions` list comes from `lapis.getSessionsForMilestone(milestoneId)`. The synthetic verdict's sessionId IS registered at spawn time. So `verifyCreatorSession` SHOULD find it.
   - **Most likely root cause:** the `lapis.writeVerdict(...)` call in the spawner's subscribe callback either (a) throws and is silently caught by the try/catch, or (b) the `await` resolves but the POST hasn't committed to the DB yet by the time `getVerdicts` runs (timing race). Since the verdict write and the verdict read are separate HTTP calls to LaPis, and the subscribe callback is `async` but the Pi SDK doesn't await it, there's a race: `resolveCompleted` fires, the milestone-loop continues to the negotiation phase, and calls `getVerdicts` before the writeVerdict POST has committed.
   - **Alternative:** the `session.subscribe` callback is marked `async` but the Pi SDK's subscribe mechanism may not await the callback. If the SDK fires-and-forgets the callback, the `await lapis.writeVerdict(...)` starts but doesn't block `resolveCompleted`. The milestone-loop sees `handle.completed` resolve immediately after `resolveCompleted` is called, races past to the negotiation phase, and `getVerdicts` returns empty.

2. **Rescope replans with no useful signal** — `rescopeMilestone` gets the verdict summaries which say "exceeded 25 tool calls" but the LLM has no idea what the actual code issues are, so it generates a fresh plan that has the same problems.

3. **No stagnation detection** — identical failure pattern across cycles goes unnoticed. The negotiator doesn't compare verdicts across retries/rescopes.

**Fix strategy:**
- Task 1: Fix the race condition — write the synthetic verdict BEFORE calling `resolveCompleted`, and add a small verification that the verdict was actually committed. Better: move the synthetic verdict write OUT of the subscribe callback and into the milestone-loop's cap-hit handling, after `handle.completed` resolves.
- Task 2: Add stagnation detection to the negotiator — if the same validator type fails with the same pattern (cap hit, same findings hash), escalate immediately instead of retrying/rescoping.
- Task 3: Raise the tool-call cap for validators from 25 → 40 and improve the validator skill to be more decisive.

---

## Phase 1: Validator Death Spiral (Critical Path)

### Task 1: Fix synthetic verdict race condition — move verdict write to milestone-loop

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`
- Modify: `packages/backend/src/agents/agent-spawner.ts`
- Modify: `packages/backend/__tests__/milestone-loop*.test.ts`
- Modify: `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`

**Problem:** The synthetic verdict is written inside the `session.subscribe` async callback in `agent-spawner.ts`. The Pi SDK's subscribe mechanism fire-and-forgets async callbacks — it doesn't `await` them. So `resolveCompleted()` fires immediately after `await lapis.writeVerdict(...)` starts but before it finishes. The milestone-loop sees `handle.completed` resolve, continues to the negotiation phase, and calls `getVerdicts()` — which returns empty because the verdict POST hasn't committed yet. The negotiator sees no scrutiny verdict → "Missing scrutiny validator verdict" → rescope → death spiral.

**Evidence:**
- The `agent_sessions` table schema is `(session_id, agent_type, mission_id, milestone_id, unit_id)` — NO `terminated_at` or `spawned_at` columns. `SELECT *` returns only 5 columns. `verifyCreatorSession`'s `terminatedAt` check sees `undefined` which is falsy, so it never rejects on termination. This rules out termination as the cause.
- The `sessions` list from `getSessionsForMilestone` includes the validator's session (registered at spawn time). So `verifyCreatorSession` finds it and passes.
- All log timestamps are 11:31:10 — the entire escalate cycle fires in <1 second, consistent with a race where the verdict write hasn't landed in the DB.

**Fix:** Remove the synthetic verdict write from the spawner's subscribe callback. Instead, detect the cap-hit in the milestone-loop after `handle.completed` resolves, and write the verdict there (synchronously in the milestone-loop's control flow, guaranteed to complete before `getVerdicts` is called).

- [ ] **Step 1: Remove synthetic verdict write from agent-spawner.ts**

In `packages/backend/src/agents/agent-spawner.ts`, in the `session.subscribe` callback's cap-exceeded handler, remove the entire `if (isValidatorSession && opts.contractId) { try { await lapis.writeVerdict(...) } }` block. The cap-hit handler should only:
1. Set `settled = true`
2. Call `session.abort()`
3. Log the failure
4. Emit output
5. Call `resolveCompleted({ status: "failed", error: errMsg })`
6. Return

The spawner reports status — it does NOT write verdicts.

- [ ] **Step 2: Add cap-hit detection and synthetic verdict write to milestone-loop.ts**

In `packages/backend/src/orchestrator/milestone-loop.ts`, in the validator spawn section, after `const result = await handle.completed;`:

```typescript
            const result = await handle.completed;
            activeHandles.delete(handle);
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);

            // If the validator was killed by the tool-call cap, write a
            // synthetic fail verdict here (in the milestone-loop's control
            // flow) instead of in the spawner's subscribe callback. The
            // subscribe callback's async writeVerdict races with
            // resolveCompleted, causing the verdict to be missing when
            // getVerdicts runs.
            if (result.status === "failed" && result.error?.includes("tool_call_cap_exceeded")) {
              try {
                await lapis.writeVerdict(handle.sessionId, {
                  milestoneId: milestone.id,
                  contractId,
                  validatorType: validatorType as "validator_scrutiny" | "validator_user_testing",
                  verdict: "fail",
                  findings: `Validator auto-failed: exceeded tool-call cap without producing a verdict. The model exhausted its tool-call budget without writing a grounded verdict. This usually means the validator couldn't find real issues but also couldn't confidently pass — review the worker output and contract criteria manually.`,
                  failedUnitIds: [],
                  timestamp: new Date().toISOString(),
                });
              } catch (err) {
                console.warn(`[milestone-loop] Failed to write synthetic cap-hit verdict:`, err instanceof Error ? err.message : err);
              }
            }

            handle.dispose();
```

**Important:** `handle.sessionId` is set at spawn time and persists. Verify it's accessible.

- [ ] **Step 3: Update tests**

1. Remove the test in `agent-spawner-validator.test.ts` that asserts `lapis.writeVerdict` is called when the cap is exceeded. The spawner no longer writes verdicts.
2. Add a test in the milestone-loop test suite: mock a validator spawn that returns `{ status: "failed", error: "tool_call_cap_exceeded: 26 calls (cap 25)" }`, then verify `lapis.writeVerdict` is called with the correct synthetic verdict before `getVerdicts` runs.

- [ ] **Step 4: Run tests**

```bash
npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts
npx vitest run packages/backend/__tests__/milestone-loop*.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(validator): move synthetic verdict write from spawner to milestone-loop to fix race

The spawner's subscribe callback is async but the Pi SDK doesn't await
it, so the verdict POST raced with resolveCompleted. The milestone-loop
saw handle.completed resolve before the verdict was committed to the DB,
causing getVerdicts() to return empty → 'Missing scrutiny validator
verdict' → rescope → death spiral.

Now the spawner only reports the cap-hit status. The milestone-loop
writes the synthetic verdict after handle.completed resolves, guaranteeing
the verdict is committed before getVerdicts runs."
```

---

### Task 2: Add stagnation detection to the negotiator

**Files:**
- Modify: `packages/backend/src/orchestrator/negotiator.ts`
- Modify: `packages/backend/__tests__/orchestrator/negotiator.test.ts`

**Problem:** The negotiator has no memory of prior cycles. If the validator keeps failing with the same pattern (cap hit → synthetic verdict → retry → cap hit again), the negotiator just follows its decision tree blindly: retry → retry → rescope → rescope → escalate. Two auto-rescopes × 2 retries = 6 full worker+validator cycles before escalation. That's 30+ minutes of burning tokens.

**Fix:** Add a `findingsSignature` hash to the negotiator. Before deciding to retry or rescope, hash the current verdicts' `findings` + `failedUnitIds`. If the hash matches the prior cycle's hash, the failure is stagnating — escalate immediately.

- [ ] **Step 1: Write the failing test**

```typescript
it("escalates immediately when verdicts are identical to the prior cycle (stagnation)", async () => {
  const negotiator = createNegotiator(lapis);
  const verdicts = [
    {
      id: "v-1",
      sessionId: "sess-1",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      verdict: "fail",
      findings: "Validator auto-failed: exceeded 25 tool calls without writing a verdict.",
      failedUnitIds: [],
      timestamp: new Date().toISOString(),
    },
  ];

  // First call: should retry (retryCount=0 < maxRetries=2)
  const first = await negotiator.negotiate("ms-1", 0, 0, 2, 2, verdicts);
  expect(first.decision).toBe("retry");

  // Simulate a retry cycle that produced the same verdicts
  const second = await negotiator.negotiate("ms-1", 1, 0, 2, 2, verdicts);
  // Same findings, same pattern → stagnation → escalate
  expect(second.decision).toBe("escalate");
  expect(second.reason).toContain("stagnation");
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
npx vitest run packages/backend/__tests__/orchestrator/negotiator.test.ts -t "escalates immediately when verdicts are identical"
```

Expected: FAIL — second call returns "retry" (retryCount=1 < maxRetries=2).

- [ ] **Step 3: Add stagnation detection**

In `packages/backend/src/orchestrator/negotiator.ts`:

Add a hash function and prior-signature tracking:

```typescript
import { createHash } from "node:crypto";

function hashVerdicts(verdicts: ValidationVerdict[]): string {
  const data = verdicts
    .map((v) => `${v.validatorType}:${v.verdict}:${v.findings}:${(v.failedUnitIds ?? []).sort().join(",")}`)
    .sort()
    .join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function createNegotiator(lapis: LaPisClient) {
  let priorSignature: string | null = null;

  return {
    async negotiate(
      milestoneId: string,
      retryCount: number,
      rescopeCount: number,
      maxRetries: number,
      maxRescopes: number,
      preloadedVerdicts?: ValidationVerdict[],
    ): Promise<NegotiateResult> {
      // ... existing verdict fetch and verification ...

      // Stagnation detection: if the exact same verdicts were seen in the
      // prior cycle, the loop is not making progress. Escalate immediately.
      const currentSignature = hashVerdicts(validVerdicts);
      if (priorSignature === currentSignature) {
        priorSignature = currentSignature; // keep tracking
        return {
          decision: "escalate",
          reason: `Stagnation detected: identical validator findings across cycles. Prior findings were not addressed by retry/rescope. Human review required.`,
        };
      }
      priorSignature = currentSignature;

      // ... rest of existing decision tree ...
    },
  };
}
```

**Important:** The `priorSignature` is per-negotiator-instance. Each milestone creates a fresh negotiator? Let's check — in `milestone-loop.ts`, `const negotiator = createNegotiator(lapis)` is called once at the top of `run()`, so it persists across all milestones. That's correct — we want stagnation detection within a milestone's retry/rescope cycles, not across milestones. But we should reset the signature when we move to a new milestone. Add a `resetStagnation()` method:

```typescript
  return {
    resetStagnation() {
      priorSignature = null;
    },
    async negotiate(...) { ... },
  };
```

And call it from `milestone-loop.ts` at the top of the per-milestone loop:

```typescript
        // Reset stagnation detector for this milestone
        negotiator.resetStagnation();
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
npx vitest run packages/backend/__tests__/orchestrator/negotiator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(negotiator): stagnation detection — escalate when verdicts are identical across cycles

Prevents the retry→rescope→retry death spiral when the validator keeps
hitting the tool-call cap with the same synthetic verdict. Hashes the
verdict findings+failedUnitIds and escalates immediately if the same
hash appears twice in a row."
```

---

### Task 3: Raise tool-call cap and tighten validator skill

**Files:**
- Modify: `packages/backend/src/agents/agent-spawner.ts` (default cap)
- Modify: `packages/backend/src/agents/context-builder.ts` (inject cap info)

**Problem:** The cap of 25 is too low for legitimate reviews of milestones with multiple units and large diffs. The validator spends many reads just understanding the codebase, then runs out of budget before writing a verdict.

**Fix:**
1. Raise default cap from 25 → 40
2. Inject the cap number into the validator context so the model can self-limit
3. Tighten the scrutiny review instructions to emphasize decisiveness

- [ ] **Step 1: Raise the default cap**

In `packages/backend/src/agents/agent-spawner.ts`, change:

```typescript
  const { ..., validatorToolCallCap = 40 } = config;
```

- [ ] **Step 2: Inject cap info into validator context**

In `packages/backend/src/agents/context-builder.ts`, in `buildValidatorContext`, add before the "VERDICT" section:

```typescript
  // Inject tool-call budget so the model can self-regulate
  if (input.validatorType === "validator_scrutiny" || input.validatorType === "validator_user_testing") {
    sections.push(
      [
        "## Tool-Call Budget",
        "",
        "You have a hard cap on tool calls. Be decisive:",
        "- After reviewing the diff and running test commands, you should have enough context to write a verdict.",
        "- Do NOT read every file in the diff exhaustively. The diff is already in your context.",
        "- Focus on the 2-3 files most likely to contain real issues.",
        "- Call `write_verdict` as soon as you can ground your decision in evidence.",
        "- An unforced failure (no verdict written) wastes an entire worker+validator cycle.",
      ].join("\n"),
    );
  }
```

- [ ] **Step 3: Update the test that references cap=25**

In `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`, update any test that asserts on the cap value to use `40` or use `toBeGreaterThan(25)` instead of a hardcoded value.

- [ ] **Step 4: Run full spawner tests**

```bash
npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(validator): raise tool-call cap to 40 and inject budget info into context"
```

---

## Phase 2: Runner Dedup and Recursion Guard

### Task 4: Extract shared checkpoint-loop helper to eliminate duplication in mission-runner.ts

**Files:**
- Create: `packages/backend/src/orchestrator/checkpoint-loop.ts`
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`
- Create: `packages/backend/__tests__/orchestrator/checkpoint-loop.test.ts`

**Problem:** The checkpoint resolution loop is duplicated between the happy path and the `QuotaExhaustedError` catch block (~80 duplicated lines). Any bug fix must be applied twice.

**Fix:** Extract a `runCheckpointLoop` function that handles the `while (loopResult.status === "checkpoint_needed")` logic.

- [ ] **Step 1: Create `packages/backend/src/orchestrator/checkpoint-loop.ts`**

```typescript
import type { CheckpointDecision, CheckpointTrigger, Milestone } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";
import type { MilestoneLoop, MilestoneLoopResult } from "./milestone-loop.js";
import { createCheckpointManager, type CheckpointManager } from "./checkpoint-manager.js";
import { rescopeMilestone } from "./rescope.js";

export interface CheckpointLoopParams {
  missionId: string;
  mission: any; // Mission type
  loop: MilestoneLoop;
  milestones: Milestone[];
  signal?: AbortSignal;
  lapis: LaPisClient;
  eventBus: EventBus;
  costCapApproved: boolean;
}

export interface CheckpointLoopResult {
  status: "completed" | "failed";
  milestones: Milestone[];
  costCapApproved: boolean;
}

export async function runCheckpointLoop(params: CheckpointLoopParams): Promise<CheckpointLoopResult> {
  const { missionId, mission, loop, milestones, signal, lapis, eventBus, costCapApproved: initialCostCapApproved } = params;
  const checkpointManager = createCheckpointManager(lapis);
  let currentMilestones = milestones;
  let costCapApproved = initialCostCapApproved;

  let loopResult = await loop.run(mission, currentMilestones, signal);

  while (loopResult.status === "checkpoint_needed") {
    if (signal?.aborted) {
      await lapis.updateMissionStatus(missionId, "aborted");
      eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
      return { status: "failed", milestones: currentMilestones, costCapApproved };
    }

    await lapis.updateMissionStatus(missionId, "paused");
    eventBus.emit({ type: "mission_status", missionId, status: "paused" });

    const checkpointId = await checkpointManager.create({
      missionId,
      trigger: loopResult.trigger,
      milestoneId: loopResult.milestoneId,
      summary: loopResult.summary,
    });

    eventBus.emit({
      type: "escalation",
      missionId,
      checkpointId,
      trigger: { kind: loopResult.trigger, milestoneId: loopResult.milestoneId },
      context: { summary: loopResult.summary },
    });

    const resolved = await checkpointManager.waitForResolution(checkpointId);
    const decision = resolved.decision as CheckpointDecision | undefined;

    if (decision === "reject") {
      await lapis.updateMissionStatus(missionId, "aborted");
      eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
      return { status: "failed", milestones: currentMilestones, costCapApproved };
    }

    // User-initiated re-plan
    if (resolved.rescopeGuidance) {
      const rescopeTarget = currentMilestones.find((ms) => ms.id === loopResult.milestoneId);
      if (rescopeTarget) {
        eventBus.emit({ type: "mission_log", missionId, phase: "rescope", message: `Re-planning milestone "${rescopeTarget.title}" after user rescope` });
        const [rescopeVerdicts, rescopeFindings, rescopeUnits] = await Promise.all([
          lapis.getVerdicts(rescopeTarget.id).catch(() => []),
          lapis.getFindings(missionId).catch(() => []),
          lapis.getWorkingUnitsForMilestone(rescopeTarget.id).catch(() => [] as import("@aurex/shared").WorkingUnit[]),
        ]);
        const rescopeCompletedSummaries = rescopeUnits
          .filter((u) => u.status === "completed")
          .map((u) => ({ description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules }));
        const result = await rescopeMilestone({
          pinyx: (loop as any)._pinyx, // Need to expose pinyx from the loop or pass it
          lapis,
          mission,
          milestone: { id: rescopeTarget.id, title: rescopeTarget.title, description: rescopeTarget.description },
          model: mission.configJson.modelHints.orchestrator,
          reason: resolved.rescopeGuidance,
          verdicts: rescopeVerdicts,
          researchFindings: rescopeFindings,
          completedUnitSummaries: rescopeCompletedSummaries,
        });
        if (!result.ok) {
          const msg = result.error === "pinyx_threw" ? result.message : `Rescope re-planning failed: ${result.content}`;
          eventBus.emit({ type: "mission_error", missionId, code: "rescope_failed", message: msg, recoverable: false });
          await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
          eventBus.emit({ type: "mission_status", missionId, status: "failed" });
          return { status: "failed", milestones: currentMilestones, costCapApproved };
        }
        eventBus.emit({ type: "milestone_progress", milestoneId: loopResult.milestoneId, status: "rescoping", completedUnits: 0, totalUnits: result.units.length });
      }
    }

    if (loopResult.trigger === "milestone_complete") {
      await lapis.updateMilestoneStatus(loopResult.milestoneId, "completed");
      currentMilestones = currentMilestones.map((ms) =>
        ms.id === loopResult.milestoneId ? { ...ms, status: "completed" as const } : ms,
      );
      eventBus.emit({ type: "milestones_set", missionId, milestones: currentMilestones });
    }
    if (loopResult.trigger === "cost_cap_exceeded") {
      costCapApproved = true;
    }

    await lapis.updateMissionStatus(missionId, "running");
    eventBus.emit({ type: "mission_status", missionId, status: "running" });

    const baseMission = await lapis.getMission(missionId);
    const nextMission = costCapApproved
      ? { ...baseMission, configJson: { ...baseMission.configJson, costCap: 0 } }
      : baseMission;
    loopResult = await loop.run(nextMission, currentMilestones, signal);
  }

  if (loopResult.status === "failed") {
    await lapis.updateMissionStatus(missionId, "failed");
    eventBus.emit({ type: "mission_status", missionId, status: "failed" });
    return { status: "failed", milestones: currentMilestones, costCapApproved };
  }

  await lapis.updateMissionStatus(missionId, "completed");
  eventBus.emit({ type: "mission_status", missionId, status: "completed" });
  return { status: "completed", milestones: currentMilestones, costCapApproved };
}
```

**Note:** The `pinyx` reference for user-initiated rescope needs thought. Options:
- (a) Pass `pinyx` into the `CheckpointLoopParams` — simplest
- (b) Expose `_pinyx` from the milestone loop — ugly
- (c) Move the rescope call to a callback — cleanest

Use option (a): pass `pinyx` as a param.

- [ ] **Step 2: Rewrite `mission-runner.ts` to use `runCheckpointLoop`**

Replace both the happy-path checkpoint loop and the `QuotaExhaustedError` checkpoint loop with calls to `runCheckpointLoop`. The `QuotaExhaustedError` handler becomes:

```typescript
      if (error instanceof QuotaExhaustedError) {
        // ... existing quota checkpoint creation + resolution ...

        // Reset the quota window
        const allWindows = (await lapis.getSetting<Record<string, QuotaWindow>>("quota_windows")) ?? {};
        const providerWindow = allWindows[error.providerId];
        if (providerWindow) {
          allWindows[error.providerId] = resetWindow(providerWindow, new Date());
          await lapis.setSetting("quota_windows", allWindows);
        }

        await lapis.updateMissionStatus(missionId, "running");
        setStatus("executing", missionId);
        eventBus.emit({ type: "mission_status", missionId, status: "running" });

        if (loop && currentMilestones.length > 0) {
          const refreshedMission = await lapis.getMission(missionId);
          const nextMission = costCapApproved
            ? { ...refreshedMission, configJson: { ...refreshedMission.configJson, costCap: 0 } }
            : refreshedMission;

          const result = await runCheckpointLoop({
            missionId, mission: nextMission, loop, milestones: currentMilestones,
            signal: abortController?.signal, lapis, eventBus, costCapApproved,
          });
          currentMilestones = result.milestones;
          costCapApproved = result.costCapApproved;
          setStatus(result.status === "completed" ? "completed" : "failed", missionId);
        } else {
          // No loop exists yet — re-enter planning from scratch (with guard)
          reentryCount++;
          if (reentryCount > MAX_REENTRY) {
            throw new Error(`Mission runner exceeded max re-entry attempts (${MAX_REENTRY})`);
          }
          void runMission(missionId);
          return;
        }
      }
```

- [ ] **Step 3: Write tests for `runCheckpointLoop`**

Create `packages/backend/__tests__/orchestrator/checkpoint-loop.test.ts` with:
- Test: resolves `milestone_complete` checkpoint and continues to next milestone
- Test: resolves `cost_cap_exceeded` checkpoint and resets cap
- Test: returns `failed` when user rejects checkpoint
- Test: returns `failed` when loop result is `failed`
- Test: returns `failed` when signal is aborted during checkpoint wait

- [ ] **Step 4: Run tests**

```bash
npx vitest run packages/backend/__tests__/orchestrator/checkpoint-loop.test.ts
npx vitest run packages/backend/__tests__/orchestrator/mission-runner.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(runner): extract checkpoint loop to eliminate 80-line duplication

The checkpoint resolution loop was duplicated between the happy path and
the QuotaExhaustedError catch block. Now a single runCheckpointLoop()
function handles both cases."
```

---

### Task 5: Add re-entry guard to `runMission`

**Files:**
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`

**Problem:** The `QuotaExhaustedError` fallback calls `void runMission(missionId)` recursively with no depth guard. If the quota keeps resetting and exhausting, this recurses unboundedly.

**Fix:** Add a re-entry counter at the top of `runMission`.

- [ ] **Step 1: Add re-entry guard**

At the top of the `createMissionRunner` factory, add:

```typescript
  const MAX_REENTRY = 3;
  let reentryCount = 0;
```

At the top of `runMission`:

```typescript
  async function runMission(missionId: string): Promise<void> {
    reentryCount++;
    if (reentryCount > MAX_REENTRY) {
      const msg = `Mission runner exceeded max re-entry attempts (${MAX_REENTRY}). Last trigger: quota exhaustion loop.`;
      eventBus.emit({ type: "mission_error", missionId, code: "runner_reentry_limit", message: msg, recoverable: false });
      await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
      setStatus("failed", missionId);
      eventBus.emit({ type: "mission_status", missionId, status: "failed" });
      reentryCount = 0;
      return;
    }

    // ... existing logic ...
```

In the `finally` block:

```typescript
    } finally {
      reentryCount = 0; // Reset on normal completion
      completeWaiters();
    }
```

- [ ] **Step 2: Update the QuotaExhaustedError fallback to use the guard**

Already shown in Task 4 — the `void runMission(missionId)` line now has the guard above it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(runner): add re-entry guard to prevent unbounded recursion on quota exhaustion"
```

---

## Phase 3: Research-Before-Workers Reorder

### Task 6: Run research agent before workers for first milestone

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** Research runs AFTER workers. The first milestone's workers have zero research findings — they only get findings from previous milestones' research. This means the first milestone's workers are flying blind.

**Fix:** For the first milestone in the mission (when there are no prior research findings), run the research agent BEFORE spawning workers. For subsequent milestones, keep the current order (research findings from prior milestones are already available).

- [ ] **Step 1: Move research phase before worker phase when there are no prior findings**

In `packages/backend/src/orchestrator/milestone-loop.ts`, inside the `while (loopActive)` loop, add a pre-worker research step:

After fetching `researchFindings` and before the "WORKER PHASE" comment:

```typescript
        // --- PRE-WORKER RESEARCH ---
        // If no prior research findings exist (first milestone or first
        // loop iteration after a rescope), run research BEFORE workers
        // so they benefit from domain knowledge.
        if (researchFindings.length === 0) {
          const allDeclaredPaths = units.flatMap((u: WorkingUnit) => u.declaredPaths);
          const allDeclaredModules = [...new Set(units.flatMap((u: WorkingUnit) => u.declaredModules))];
          const researchAgentId = `research-${milestone.id}`;
          const researchContext = buildResearchContext({
            missionDescription: mission.description,
            milestoneTitle: milestone.title,
            milestoneDescription: milestone.description,
            unitDescriptions: units.map((u: WorkingUnit) => u.description),
            declaredPaths: allDeclaredPaths,
            declaredModules: allDeclaredModules,
          });

          callbacks.onAgentStatus(researchAgentId, "research", "spawned", milestone.id);
          const researchHandle = await spawner.spawn({
            agentType: "research",
            agentId: researchAgentId,
            missionId: mission.id,
            milestoneId: milestone.id,
            cwd: loopConfig.repoRoot,
            skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/research.md`,
            contextContent: researchContext,
            taskPrompt: `Research domain knowledge for milestone "${milestone.title}" BEFORE workers begin. Investigate the codebase areas relevant to the declared paths and modules. Submit findings using write_finding.`,
            timeout: config.workerTimeouts.build,
          });
          activeHandles.add(researchHandle);

          callbacks.onAgentStatus(researchAgentId, "research", "researching", milestone.id);
          const preResearchResult = await researchHandle.completed;
          activeHandles.delete(researchHandle);
          callbacks.onAgentStatus(
            researchAgentId,
            "research",
            preResearchResult.status === "completed" ? "completed" : preResearchResult.status,
            milestone.id,
          );
          researchHandle.dispose();

          researchFindings = await lapis.getFindings(mission.id).catch(() => researchFindings);
        }
```

Then remove the existing post-worker research phase (the "--- RESEARCH PHASE ---" block). Or keep it as a "supplementary research" that runs after workers but before validators — the findings won't be available to workers of this cycle but will be for the next. Decision: **remove it** to avoid double-spending. The pre-worker research is sufficient, and findings persist across milestones.

- [ ] **Step 2: Update tests**

The milestone-loop tests may need adjustment since the research agent now runs before workers instead of after. Check `packages/backend/__tests__/milestone-loop*.test.ts` for timing expectations.

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/backend/__tests__/milestone-loop*.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(milestone-loop): run research before workers when no prior findings exist

First-milestone workers now benefit from research findings instead of
flying blind. Prior milestones' findings are already available for
subsequent milestones."
```

---

## Phase 4: Remaining Medium/Low Issues

### Task 7: Per-unit retry before milestone-level escalation

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** If 1 out of N workers fails, the entire milestone escalates. The successful workers' work is discarded.

**Fix:** When workers fail, retry just the failed units once before escalating.

- [ ] **Step 1: Add a single per-unit retry before escalation**

Replace the current "if any workers failed, escalate" block:

```typescript
          if (failedCount > 0) {
            // ... existing escalation ...
          }
```

With:

```typescript
          if (failedCount > 0) {
            // Per-unit retry: re-spawn only the failed units once before
            // escalating the entire milestone. This avoids discarding
            // successful workers' work when only 1-2 units failed.
            const failedUnits = units.filter((u: WorkingUnit) => u.status === "failed" || u.status === "timed_out");
            if (failedUnits.length > 0 && !hasRetriedFailedUnits) {
              hasRetriedFailedUnits = true;
              // Reset failed units to "planned" for re-processing
              for (const u of failedUnits) {
                await lapis.updateWorkingUnitStatus(u.id, "planned");
              }
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "per-unit retry: re-spawning failed workers",
                actorId: "orchestrator",
              });
              callbacks.onMilestoneProgress(milestone.id, "retrying", completedCount, units.length);
              loopActive = true;
              continue;
            }

            // Already retried once — escalate
            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "worker failure after retry",
              actorId: "orchestrator",
            });
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `${failedCount} worker unit(s) failed after retry`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }
```

Add `let hasRetriedFailedUnits = false;` at the top of the `while (loopActive)` loop (reset on each rescope).

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(milestone-loop): per-unit retry before milestone-level escalation

If 1 of N workers fails, retry just that unit once before escalating
the entire milestone. Avoids discarding successful workers' work."
```

---

### Task 8: Parallelize validators

**Files:**
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** Scrutiny and user_testing validators run sequentially. With both types present, this doubles the validation time.

**Fix:** Run them concurrently with `Promise.all`. They share a read-only merged worktree.

- [ ] **Step 1: Replace the sequential validator loop with concurrent execution**

Replace:

```typescript
          for (const validatorType of validatorTypes) {
            // ... spawn + await ...
          }
```

With:

```typescript
          // Run all validator types concurrently — they share a read-only
          // merged worktree and don't modify state.
          await Promise.all(validatorTypes.map(async (validatorType) => {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({ ... });

            callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
            const handle = await spawner.spawn({
              agentType: validatorType, agentId, missionId: mission.id, milestoneId: milestone.id,
              contractId, cwd: validatorCwd,
              skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/validator.md`,
              contextContent,
              taskPrompt: `Validate milestone "${milestone.title}" as ${validatorType}. Use write_verdict when done.`,
              timeout: config.workerTimeouts.testHeavy,
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);
            handle.dispose();
          }));
```

- [ ] **Step 2: Update tests if needed**

The test mocks may expect sequential validator spawns. Update to handle parallel.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "perf(milestone-loop): run validators concurrently instead of sequentially"
```

---

### Task 9: Add basic merge conflict resolution in integration lifecycle

**Files:**
- Modify: `packages/backend/src/orchestrator/integration-lifecycle.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** When worker branches have merge conflicts during integration, the entire milestone fails with an opaque `unclassifiable_error`. No automated resolution attempt.

**Fix:** On merge conflict, try a simple "ours" strategy (take the current branch's version). If that fails, mark the conflicting units as failed and return a structured error that identifies which units conflicted, instead of an opaque escalation.

- [ ] **Step 1: Update `worktreeManager.mergeToTarget` to handle conflicts**

In the merge loop in `integration-lifecycle.ts`:

```typescript
      const conflictedBranches: string[] = [];
      const mergedBranches: string[] = [];

      for (const branch of mergedBranches_input) {
        try {
          await worktreeManager.mergeToTarget(branch, integrationBranch);
          mergedBranches.push(branch);
        } catch (mergeError) {
          // Try "ours" strategy to auto-resolve simple conflicts
          try {
            await worktreeManager.mergeToTargetWithStrategy(branch, integrationBranch, "ours");
            mergedBranches.push(branch);
            // Log that we used auto-resolution
          } catch {
            conflictedBranches.push(branch);
          }
        }
      }

      // If all branches conflicted, fail early with clear signal
      if (conflictedBranches.length === mergedBranches_input.length) {
        throw new Error(`All worker branches have merge conflicts: ${conflictedBranches.join(", ")}`);
      }

      await worktreeManager.createBranch(releaseBranch, integrationBranch);
```

Return `conflictedBranches` in the result so the caller can identify which units failed.

- [ ] **Step 2: Update the integration error handling in milestone-loop.ts**

The catch block for integration should now receive the conflicted branch names and map them to unit IDs:

```typescript
          } catch (error) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const isMergeConflict = error instanceof Error && error.message.includes("merge conflicts");
            const summary = isMergeConflict
              ? `Integration failed: ${error.message}`
              : `Integration failed after validation pass: ${error instanceof Error ? error.message : String(error)}`;
            // ... existing escalation ...
          }
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(integration): auto-resolve merge conflicts with 'ours' strategy and report conflicted units"
```

---

### Task 10: Run integration branch tests before release

**Files:**
- Modify: `packages/backend/src/orchestrator/integration-lifecycle.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** Validators test in a separate worktree. The actual `integration/` branch has no automated test gate. If the merge breaks something that the validators didn't catch (because they tested a different worktree), the release branch is broken.

**Fix:** After creating the integration branch, run the contract's test commands on it. If they fail, report the failure instead of creating the release branch.

- [ ] **Step 1: Add post-integration test run to `integration-lifecycle.ts`**

```typescript
      // Run test commands on the integration branch before creating release
      let testResults: { passed: boolean; output: string } = { passed: true, output: "" };
      if (testCommands && testCommands.length > 0) {
        for (const cmd of testCommands) {
          try {
            const { stdout, stderr } = await execFileAsync("bash", ["-c", cmd], {
              cwd: /* integration worktree path */,
              timeout: 120_000,
              maxBuffer: 1024 * 1024,
            });
            testResults.output += stdout;
          } catch (err: any) {
            testResults.passed = false;
            testResults.output += err.stdout ?? "" + err.stderr ?? "";
          }
        }
      }

      if (!testResults.passed) {
        return {
          integrationBranch,
          releaseBranch: "", // No release branch — tests failed
          mergedBranches,
          testFailure: testResults.output,
        };
      }

      await worktreeManager.createBranch(releaseBranch, integrationBranch);
```

- [ ] **Step 2: Handle test failure in milestone-loop.ts**

After calling `integrationLifecycle.integrate()`, check for `testFailure`:

```typescript
          if (integration.testFailure) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `Integration branch tests failed:\n${integration.testFailure.slice(0, 500)}`;
            // ... escalate ...
          }
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(integration): run contract test commands on integration branch before release"
```

---

### Task 11: Make hardcoded limits configurable

**Files:**
- Modify: `packages/backend/src/orchestrator/planner.ts`
- Modify: `packages/backend/src/orchestrator/milestone-loop.ts`

**Problem:** Several limits are hardcoded:
- Planner: "at most 4 milestones, each with at most 4 working units"
- Milestone loop: `AUTO_RESCOPE_BATCH_LIMIT = 2`
- Milestone loop: default timeouts

**Fix:** Move these into `mission.configJson` with sensible defaults.

- [ ] **Step 1: Add config fields to the mission config type**

In `packages/shared/src/types.ts` (or wherever `MissionConfig` is defined), add:

```typescript
  maxMilestones?: number;    // default 4
  maxUnitsPerMilestone?: number;  // default 4
  maxAutoRescopes?: number;  // default 2
```

- [ ] **Step 2: Use config values in planner**

Replace hardcoded "at most 4 milestones" in the system prompt with the config value.

- [ ] **Step 3: Use config value for `AUTO_RESCOPE_BATCH_LIMIT`**

```typescript
const effectiveMaxRescopes = Math.min(
  config.maxRescopes,
  config.maxAutoRescopes ?? AUTO_RESCOPE_BATCH_LIMIT,
);
```

(Already partially done — `config.maxRescopes` exists. Just make the fallback configurable.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(config): make milestone/unit limits configurable in mission config"
```

---

## Full Verification

### Task 12: Run full test suite and typecheck

- [ ] **Step 1: Full backend test suite**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm --filter backend test
```

- [ ] **Step 2: Typecheck all packages**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm typecheck
```

- [ ] **Step 3: Run any integration/smoke tests**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/Aurex && pnpm test
```

---

## Task Summary

| # | Phase | Task | Severity | Files Changed |
|---|-------|------|----------|---------------|
| 1 | 🔴 P1 | Fix synthetic verdict race condition | Critical | milestone-loop, agent-spawner |
| 2 | 🔴 P1 | Stagnation detection in negotiator | Critical | negotiator, milestone-loop |
| 3 | 🔴 P1 | Raise tool-call cap + tighten context | High | agent-spawner, context-builder |
| 4 | 🟡 P2 | Extract checkpoint loop helper | High | new checkpoint-loop.ts, mission-runner |
| 5 | 🟡 P2 | Re-entry guard for runMission | High | mission-runner |
| 6 | 🟡 P3 | Research before workers | Medium | milestone-loop |
| 7 | 🟢 P4 | Per-unit retry before escalation | Medium | milestone-loop |
| 8 | 🟢 P4 | Parallelize validators | Medium | milestone-loop |
| 9 | 🟢 P4 | Merge conflict auto-resolution | Medium | integration-lifecycle, milestone-loop |
| 10 | 🟢 P4 | Integration branch test gate | Medium | integration-lifecycle, milestone-loop |
| 11 | 🟢 P4 | Configurable limits | Low | planner, milestone-loop, shared types |
| 12 | ✅ | Full verification | — | — |

---

## Execution Order

**Phase 1 (Tasks 1-3)** is the critical path — these three tasks fix the validator rescope death spiral. They should be implemented and tested together, then deployed to stop the immediate user pain.

**Phase 2 (Tasks 4-5)** can be done next — the dedup and recursion guard make the runner more maintainable and prevent the unbounded recursion risk.

**Phase 3 (Task 6)** is a standalone change that improves first-milestone quality.

**Phase 4 (Tasks 7-11)** are independent improvements that can be implemented in any order or even skipped if time is limited.
