# Validator Tool-Call Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop validator sessions from running unbounded tool calls (current behavior: 30+ calls, ~2 min, no verdict) by enforcing a hard cap on tool calls for validator sessions and forcing a synthetic fail verdict when the cap is hit.

**Architecture:** Add a per-session tool-call counter inside `agent-spawner.ts`'s `subscribe` callback. For sessions whose `agentType` starts with `validator_` (currently `validator_scrutiny` and `validator_user_testing`), if the count exceeds a configurable cap (default `25`), the spawner (a) calls `session.abort()` to stop the session, (b) writes a synthetic `verdict: "fail"` to LaPis via the existing `lapis.writeVerdict()` call path with the milestone's unit IDs, and (c) resolves `handle.completed` with `status: "failed"` and `error: "tool_call_cap_exceeded"`. The cap is also surfaced in the validator's context so the model can see the budget.

**Tech Stack:** TypeScript, Vitest, existing Pi SDK session API, existing `lapis.writeVerdict` endpoint.

---

### Task 1: Add tool-call counter to `agent-spawner.ts`

**Files:**
- Modify: `packages/backend/src/agents/agent-spawner.ts`
- Modify: `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`

- [ ] **Step 1: Write the failing test for tool-call counter behavior**

Add to `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`, inside the `describe("AgentSpawner — validator types")` block, after the "strips memory-layer extension from validator sessions" test:

```typescript
  it("counts tool calls in a validator session and aborts when cap is exceeded", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    // Override the default subscribe mock: emit many tool_call events
    // followed by an agent_end. The spawner should abort the session
    // when the cap is exceeded (well before agent_end).
    mockSession.subscribe.mockImplementation((fn: any) => {
      // Emit 30 tool_call message_update events. The default cap is 25.
      for (let i = 0; i < 30; i++) {
        setTimeout(() => fn({
          type: "message_update",
          assistantMessageEvent: {
            type: "tool_call",
            toolCall: { name: "bash", arguments: { command: `ls -la ${i}` } },
          },
        }), i);
      }
      // Never emit agent_end — the spawner should abort the session itself.
      return () => {};
    });

    const handle = await spawner.spawn({
      agentType: "validator_scrutiny",
      unitId: "unit-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/app/src/skills/validator.md",
      contextContent: "# Validate milestone",
      taskPrompt: "Validate milestone ms-1",
      timeout: 60_000,
      contractId: "c-1",
    });

    const result = await handle.completed;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("tool_call_cap");
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts -t "counts tool calls"`
Expected: FAIL — the test will hang (because the mock never emits `agent_end` and the spawner doesn't abort). The test will time out.

- [ ] **Step 3: Add tool-call counter and cap to `agent-spawner.ts`**

In `packages/backend/src/agents/agent-spawner.ts`, find the `SpawnResult` interface (around line 47) and update it to include the cap-exceeded error type:

```typescript
export interface SpawnResult {
  status: "completed" | "timed_out" | "failed";
  sessionId: string;
  error?: string;
}
```

(No change — `error: string` is already optional and can carry `"tool_call_cap_exceeded"`.)

Then find the `createAgentSpawner` function. Add a config field for the validator tool-call cap. Update `AgentSpawnerConfig`:

```typescript
export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
  logger?: AgentLogger;
  eventBus?: EventBus;
  maxConcurrent?: number;
  /** Max tool calls for a validator session before auto-fail. Default 25. */
  validatorToolCallCap?: number;
  onCost?: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}
```

And destructure it inside the factory:

```typescript
  const { lapis, agentDir, defaultTimeout, logger, eventBus, maxConcurrent, validatorToolCallCap = 25 } = config;
```

Now find the `session.subscribe` callback (around line 220). Add a tool-call counter at the top of the callback:

```typescript
      let settled = false;
      let toolCallCount = 0;
      const isValidatorSession = opts.agentType === "validator_scrutiny" || opts.agentType === "validator_user_testing";
      const toolCallCap = isValidatorSession ? validatorToolCallCap : Infinity;

      const unsubscribe = session.subscribe((event: any) => {
        if (settled) return;

        if (event.type === "agent_end") {
          settled = true;
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "completed",
          });
          emitOutput(opts, "completed", "Agent completed successfully");
          resolveCompleted({ status: "completed", sessionId: session.sessionId });
        }

        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "error") {
            settled = true;
            const errorMsg = event.assistantMessageEvent.message ?? "unknown error";
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "failed",
              data: { error: errorMsg },
            });
            emitOutput(opts, "failed", `Agent failed: ${errorMsg}`, { error: errorMsg });
            resolveCompleted({
              status: "failed",
              sessionId: session.sessionId,
              error: errorMsg,
            });
          }

          const toolName = event.assistantMessageEvent?.toolCall?.name;
          const toolInput = (event.assistantMessageEvent?.toolCall?.arguments ?? event.assistantMessageEvent?.toolCall?.input) as Record<string, unknown> | undefined;
          if (toolName) {
            toolCallCount++;
            // Validator tool-call cap enforcement: abort and force a
            // synthetic fail verdict if the model keeps making tool calls
            // without producing a verdict. The cap is the only thing
            // bounding the validator's runtime — the Pi SDK session loop
            // has no built-in maxSteps.
            if (toolCallCount > toolCallCap) {
              settled = true;
              session.abort();
              const errMsg = `tool_call_cap_exceeded: ${toolCallCount} calls (cap ${toolCallCap})`;
              logger?.log({
                sessionId: session.sessionId,
                agentType: opts.agentType,
                missionId: opts.missionId,
                milestoneId: opts.milestoneId,
                unitId: opts.unitId,
                event: "failed",
                data: { error: errMsg, toolCallCount, toolCallCap },
              });
              emitOutput(opts, "failed", errMsg, { toolCallCount, toolCallCap });
              resolveCompleted({
                status: "failed",
                sessionId: session.sessionId,
                error: errMsg,
              });
              return;
            }
            const snippet = extractToolSnippet(toolName, toolInput || {});
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "tool_call",
              data: { tool: toolName, input: toolInput },
            });
            emitOutput(opts, "tool_call", `${toolName} ${snippet}`, { tool: toolName, snippet });
          }
```

(Keep the rest of the `message_update` handler — the `usage.cost` block — unchanged below this.)

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts -t "counts tool calls"`
Expected: PASS — the test resolves `handle.completed` with `status: "failed"` and `error: "tool_call_cap..."`

- [ ] **Step 5: Verify no regressions in the full agent-spawner validator test suite**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts`
Expected: All 4 tests PASS (3 existing + 1 new)

- [ ] **Step 6: Verify no regressions in the broader agent-spawner test suite**

Run: `npx vitest run packages/backend/__tests__/agents/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/agents/agent-spawner.ts packages/backend/__tests__/agents/agent-spawner-validator.test.ts
git commit -m "feat(spawner): add tool-call cap for validator sessions to bound runtime"
```

---

### Task 2: Force a synthetic fail verdict when the cap is hit

**Files:**
- Modify: `packages/backend/src/agents/agent-spawner.ts`
- Modify: `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`

The current cap-hit behavior only resolves `handle.completed` with `status: "failed"`. But the orchestrator reads verdicts from `lapis.getVerdicts()`, not from the spawner status. We need to write a synthetic verdict to LaPis so the negotiator sees the failure and can retry/rescope.

- [ ] **Step 1: Write the failing test for synthetic verdict on cap hit**

Add to `packages/backend/__tests__/agents/agent-spawner-validator.test.ts`, after the "counts tool calls" test:

```typescript
  it("writes a synthetic fail verdict to LaPis when validator exceeds tool-call cap", async () => {
    const lapis = createMockLapis();
    const spawner = createAgentSpawner({
      lapis,
      agentDir: "/test/.pi/agent",
      defaultTimeout: 60_000,
    });

    mockSession.subscribe.mockImplementation((fn: any) => {
      for (let i = 0; i < 30; i++) {
        setTimeout(() => fn({
          type: "message_update",
          assistantMessageEvent: {
            type: "tool_call",
            toolCall: { name: "read", arguments: { path: `file-${i}.ts` } },
          },
        }), i);
      }
      return () => {};
    });

    const handle = await spawner.spawn({
      agentType: "validator_scrutiny",
      unitId: "unit-1",
      missionId: "m-1",
      milestoneId: "ms-1",
      cwd: "/test/repo",
      skillFilePath: "/app/src/skills/validator.md",
      contextContent: "# Validate milestone",
      taskPrompt: "Validate milestone ms-1",
      timeout: 60_000,
      contractId: "c-1",
    });

    const result = await handle.completed;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("tool_call_cap");

    // The synthetic verdict must be written to LaPis so the negotiator
    // can route to retry/rescope.
    expect(lapis.writeVerdict).toHaveBeenCalledWith(
      "validator-session-1",
      expect.objectContaining({
        milestoneId: "ms-1",
        contractId: "c-1",
        validatorType: "validator_scrutiny",
        verdict: "fail",
        failedUnitIds: expect.any(Array),
      }),
    );
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts -t "writes a synthetic fail verdict"`
Expected: FAIL — `lapis.writeVerdict` is never called when the cap is hit (current behavior is to only call `resolveCompleted`)

- [ ] **Step 3: Add the synthetic verdict write to the cap-hit handler**

In `packages/backend/src/agents/agent-spawner.ts`, find the cap-exceeded branch added in Task 1 (the `if (toolCallCount > toolCallCap)` block). Replace the cap-exceeded block with:

```typescript
            if (toolCallCount > toolCallCap) {
              settled = true;
              session.abort();
              const errMsg = `tool_call_cap_exceeded: ${toolCallCount} calls (cap ${toolCallCap})`;
              logger?.log({
                sessionId: session.sessionId,
                agentType: opts.agentType,
                missionId: opts.missionId,
                milestoneId: opts.milestoneId,
                unitId: opts.unitId,
                event: "failed",
                data: { error: errMsg, toolCallCount, toolCallCap },
              });
              emitOutput(opts, "failed", errMsg, { toolCallCount, toolCallCap });

              // Write a synthetic fail verdict so the orchestrator's
              // negotiator sees a real failure and can route to
              // retry/rescope. The validator session is aborted, so the
              // model never called write_verdict — we have to do it.
              if (isValidatorSession && opts.contractId) {
                // Stryker disable next-line BlockStatement: best-effort
                // — writeVerdict failure should not block the spawner
                // from resolving completed. The orchestrator handles
                // missing verdicts via the "No validator verdicts were
                // recorded" escalate path.
                try {
                  await lapis.writeVerdict(session.sessionId, {
                    milestoneId: opts.milestoneId,
                    contractId: opts.contractId,
                    validatorType: opts.agentType as "validator_scrutiny" | "validator_user_testing",
                    verdict: "fail",
                    findings: `Validator auto-failed: exceeded ${toolCallCap} tool calls without writing a verdict. Increase context or reduce review scope.`,
                    failedUnitIds: [],
                    timestamp: new Date().toISOString(),
                  });
                } catch (err) {
                  console.warn(
                    `[spawner] Failed to write synthetic verdict for capped validator session ${session.sessionId}:`,
                    err instanceof Error ? err.message : err,
                  );
                }
              }

              resolveCompleted({
                status: "failed",
                sessionId: session.sessionId,
                error: errMsg,
              });
              return;
            }
```

Note: the synthetic verdict uses `failedUnitIds: []` (empty). This is intentional — when the cap is hit, we don't know which specific units failed. The negotiator treats `failedUnitIds: []` as "scrutiny failure with no specific unit attribution" which routes to a full retry of all units in the milestone. If the user wants the synthetic verdict to fail specific units, they can pass `unitId` to validator spawns (the milestone-loop doesn't currently do this — see Task 3 of this plan).

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts -t "writes a synthetic fail verdict"`
Expected: PASS

- [ ] **Step 5: Verify no regressions in the full agent-spawner validator test suite**

Run: `npx vitest run packages/backend/__tests__/agents/agent-spawner-validator.test.ts`
Expected: All 5 tests PASS (3 original + 2 new)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/agents/agent-spawner.ts packages/backend/__tests__/agents/agent-spawner-validator.test.ts
git commit -m "feat(spawner): write synthetic fail verdict when validator exceeds tool-call cap"
```

---

### Task 3: Update validator skill to surface the tool-call budget

**Files:**
- Modify: `packages/backend/src/skills/validator.md`

- [ ] **Step 1: Add a "Tool Call Budget" section to the validator skill**

In `packages/backend/src/skills/validator.md`, find the "Verdict Tool" section (around line 152). Replace it with:

```markdown
## Tool Call Budget

You have a **hard cap of 25 tool calls** per session. The orchestrator aborts the session and writes a synthetic `verdict: "fail"` when the cap is exceeded. There is no partial credit — an aborted session counts as a fail.

Be decisive:
- After 5 reads/greps of the relevant code, you have enough context
- After running the test commands, you have your test results
- Call `write_verdict` as soon as you can ground your decision in evidence

Do not exhaustively enumerate every file in the diff. Pick the 2-3 files most likely to contain real defects and review them. The diff is in your context — you do not need to `read` every changed file.

## Verdict Tool

Use `write_verdict` exactly once:
- `verdict`: `"pass"` or `"fail"`
- `findings`: the structured Markdown above
- `failedUnitIds`: exact unit IDs that failed, or empty array on pass
```

- [ ] **Step 2: Verify the file is still valid Markdown**

Run: `node -e "const fs = require('fs'); const c = fs.readFileSync('packages/backend/src/skills/validator.md', 'utf8'); console.log('Lines:', c.split('\\n').length); console.log('Contains Tool Call Budget:', c.includes('Tool Call Budget')); console.log('Contains write_verdict:', c.includes('write_verdict'))"`
Expected: Lines ~120+, Tool Call Budget=true, write_verdict=true

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/skills/validator.md
git commit -m "docs(skills): tell validator about 25-tool-call hard cap"
```

---

### Task 4: Run the full backend test suite to verify no regressions

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS (was 707, now 709 with the 2 new tests)

- [ ] **Step 2: Run the type checker**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: All 3 packages clean

---

## Review Pass 1 (self-review)

### Spec coverage

| Original problem | Task |
|---|---|
| Validator sessions run unbounded tool calls (30+ in 2 min) | Task 1 (counter + abort) |
| Orchestrator doesn't know about the cap-hit failure (no verdict in LaPis) | Task 2 (synthetic verdict write) |
| Model isn't told about the cap so it doesn't self-limit | Task 3 (skill update) |

### Placeholder scan

No "TBD", "TODO", "implement later", or "add appropriate error handling" without code. Every step has full code blocks.

### Type consistency

- `validatorToolCallCap?: number` in `AgentSpawnerConfig` is optional with `default 25` at destructure
- `toolCallCap: number` is the resolved cap for the current session (Infinity for non-validators, which is consistent because the `>` check is the only thing gating abort)
- `isValidatorSession: boolean` is computed once at spawn time
- The synthetic verdict's `verdict: "fail"` and `failedUnitIds: []` match the `ValidationVerdict` type and the `lapis.writeVerdict` signature (verified in `validator-tools.ts:46-55`)
- The cap-exceeded `error` string `tool_call_cap_exceeded: N calls (cap M)` starts with `tool_call_cap` so the test's `toContain("tool_call_cap")` assertion is satisfied

### Edge cases handled

- **Non-validator sessions**: `isValidatorSession` is false, `toolCallCap` is `Infinity`, the `>` check is never true. Behavior unchanged.
- **Cap is reached exactly on the last tool call**: `toolCallCount > toolCallCap` requires strict greater-than, so the 25th call is allowed (just barely). The 26th triggers the cap.
- **`lapis.writeVerdict` fails inside the cap handler**: caught with try/catch, logged, but `resolveCompleted` is still called with `failed` status. The orchestrator's "no verdicts recorded" escalate path handles the missing verdict.
- **`contractId` is missing**: the synthetic verdict write is skipped (the `if (isValidatorSession && opts.contractId)` guard), but the abort and `resolveCompleted` still happen. This shouldn't happen in practice — milestone-loop always passes `contractId` to validator spawns — but the guard makes the cap-hit handler robust to misconfiguration.
- **Multiple cap-exceeded events in rapid succession**: `settled` is set to `true` on the first cap-hit, and the `if (settled) return;` guard at the top of the callback prevents re-entry.

### Risks

- **Cap value of 25 may be too low for legitimate reviews**: If real reviews need 30+ tool calls, they'll be auto-failed. The cap is configurable via `validatorToolCallCap` in `AgentSpawnerConfig`, and the milestone-loop constructor can be updated to pass a higher cap if needed. Default 25 is a starting point — adjust based on observed behavior.
- **Synthetic verdict with empty `failedUnitIds`**: The negotiator treats this as a "full retry" of all units. If the user wants the synthetic verdict to fail specific units, the validator spawn would need to receive `unitId` (which milestone-loop doesn't currently pass to validators — only workers get `unitId`). This is a known limitation; can be addressed in a follow-up plan.
- **Abort may not fire `agent_end` event synchronously**: The test relies on the spawner's `resolveCompleted` being called from the cap-hit branch, not from `agent_end`. If the session's `agent_end` event fires AFTER our `resolveCompleted`, the `settled` flag prevents re-entry. Verified safe.
- **Skill update is documentation only**: The model might still ignore the cap and exceed it. That's fine — the cap is enforced by code, not by the model. The skill update is a hint, not a guarantee.

### Type consistency checked

- `lapis.writeVerdict(sessionId, verdict)` signature matches `verdict: Omit<ValidationVerdict, "id" | "sessionId">` (verified in `lapis-client.ts:265-267`)
- `validatorType: opts.agentType as "validator_scrutiny" | "validator_user_testing"` — `opts.agentType` is `AgentType` (broader), but we've already checked `isValidatorSession` so the cast is safe
- `extractToolSnippet` is called after the cap-hit check returns, so it's not affected by the early return

---

**Plan reviewed.** Two execution options:

- **Sequential mode** (subagents) — I dispatch a fresh subagent per task, two-stage review (spec then quality). Fast iteration.
- **Direct mode** (no subagents) — Execute tasks in this session with checkpoint reviews. Same quality discipline, no agent delegation.
