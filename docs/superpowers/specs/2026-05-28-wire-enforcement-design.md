# Wire Enforcement Modules into Production Runtime

**Date:** 2026-05-28
**Status:** Approved

## Goal

Wire all six enforcement modules (`branch-guard`, `handoff-validator`, `creator-verifier`, `contract-immutability`, `broadcast-lifecycle`, `research-lifecycle`) into the milestone loop and related production code paths so they act as hard guard boundaries.

## Context

The enforcement modules are fully implemented and tested (20+ tests across 6 test files) but have zero callers in production code. The README states "Logic in skill files, boundaries in runtime" — enforcement should be a hard boundary that blocks invalid operations, not advisory logging.

## Design

### 1. Branch Guard → Worktree creation

**Where:** `milestone-loop.ts` — after `worktreeManager.createWorktree()`

**What:** Call `worktreeManager.installBranchGuard(worktreePath, taskBranch)`. This installs a git `pre-commit` hook that calls `validateCommitBranch` on the current branch. Workers on non-`task/*` branches cannot commit.

**On violation:** Git pre-commit hook rejects the commit. Worker's session sees the error and adapts.

### 2. Handoff Validator → Before accepting worker handoffs

**Where:** `milestone-loop.ts` — after worker completes and we fetch handoffs via `lapis.getHandoffsForMilestone()`

**What:** For each handoff, call `validateHandoff(handoff)`. If invalid, mark the unit as failed with the validation errors as the reason.

**On violation:** Unit marked `failed`. Negotiator sees failure and decides retry/escalate naturally.

### 3. Creator Verifier → Before accepting validator verdicts

**Where:** `milestone-loop.ts` — after validator completes, before negotiation

**What:** Fetch sessions for the milestone via `lapis.getSessionsForMilestone()`. For each verdict retrieved via `lapis.getVerdicts()`, call `verifyCreatorSession(verdict.sessionId, expectedType, sessions)`. If invalid, discard that verdict and log.

**On violation:** Verdict discarded. Negotiation proceeds with remaining valid verdicts.

### 4. Contract Immutability → Before contract writes

**Where:** `milestone-loop.ts` — at `lapis.createContract()` and rescope path at `lapis.supersedeContract()`

**What:**
- Before `lapis.createContract()`: call `validateContractAppend(existingContracts, newContract)`.
- Before rescope's new contract: call `validateSupersede(oldContractId, { rescopeEventId })` after logging the rescope event.

**On violation:** Throw error → caught by loop → checkpoint escalation with enforcement failure summary.

### 5. Broadcast Lifecycle → Before broadcast transitions

**Where:** `milestone-loop.ts` — wherever `lapis.transitionBroadcast()` would be called (currently not called directly in the loop, but the enforcement validates future calls)

**What:** Before any `lapis.transitionBroadcast()`, call `validateBroadcastTransition(current, next)` and `canAuthorTransition(actorId, authorId, current, next)`. Since the loop doesn't currently transition broadcasts, this wiring adds the validation as a utility the agent spawner or future code can use — we export a validated wrapper.

### 6. Research Lifecycle → Before research finding transitions

**Where:** `milestone-loop.ts` — wherever `lapis.transitionFinding()` would be called

**What:** Before any `lapis.transitionFinding()`, call `validateResearchTransition(current, next)` and optionally `canTransitionFinding(current, next, actorId, standingContext)`. Same as broadcast — the loop doesn't currently call `transitionFinding` directly, but we add the validated wrapper for future use.

## Violation Handling Summary

| Module | Phase | On Violation |
|--------|-------|-------------|
| Branch guard | Worktree setup | Git pre-commit hook rejects commit |
| Handoff validator | Post-worker | Unit marked failed → negotiator handles |
| Creator verifier | Post-validator | Verdict discarded → negotiation proceeds |
| Contract immutability | Contract create/supersede | Throw → checkpoint escalation |
| Broadcast lifecycle | Broadcast transition | Skip transition + log warning |
| Research lifecycle | Finding transition | Skip transition + log warning |

## Files Modified

- `packages/backend/src/orchestrator/milestone-loop.ts` — main wiring point for all guards
- `packages/backend/src/agents/agent-spawner.ts` — possibly for session registration guard
- `packages/backend/__tests__/milestone-loop*.ts` — update existing tests to cover enforcement guards

## Files NOT Modified

- Enforcement modules themselves — they are already correct and tested
- `packages/shared/` — no type changes needed
- Frontend — this is backend-only

## Scope

This spec covers wiring existing enforcement into production code. It does NOT cover:
- Adding new enforcement rules
- Changing existing enforcement logic
- Adding new REST endpoints
- Frontend changes
