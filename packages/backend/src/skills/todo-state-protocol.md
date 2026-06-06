# LaPis Todo State Protocol

## Purpose

This protocol defines exact ownership and transition rules for LaPis mission todos. Agents must not improvise state changes.

## Todo States

- `pending`: Planned but dependencies or required clarification are not satisfied.
- `ready`: Safe for a Worker to claim.
- `in_progress`: Claimed by one Worker and actively being implemented.
- `blocked`: Cannot proceed without human input, rescope, permissions, missing context, or recovery.
- `implemented`: Worker has committed scoped work and provided evidence/handoff.
- `validating`: Validator is actively checking the todo.
- `needs_changes`: Validator found a confirmed issue requiring worker changes.
- `passed`: Validator accepted the todo.
- `merged`: Merge Manager integrated the todo's branch through the required merge gate.
- `cancelled`: Orchestrator or human cancelled the todo.

## Ledger States

- `planning`: Orchestrator is creating or revising the ledger.
- `ready`: At least one todo can be worked.
- `in_progress`: One or more todos are active.
- `blocked`: Mission cannot proceed without human input or recovery.
- `validating`: Implementation is complete enough for validator work.
- `completed`: All required todos are passed/merged or explicitly cancelled with approval.
- `cancelled`: Mission ledger is no longer active.

## State Owners

- Orchestrator owns `pending -> ready`, dependency release, rescope, cancellation, and ledger state.
- Worker owns `ready -> in_progress`, `in_progress -> implemented`, and `in_progress -> blocked`.
- Validator owns validation recommendation and may set/report `validating`, `passed`, or `needs_changes` when tools allow.
- Failure Recovery owns retry/rescope recommendations and may move failed todos back to `ready` only with clear recovery reason.
- Human Escalation Manager owns checkpoint creation and records human decisions.
- Merge Manager owns `passed -> merged`.

## Required Transition Rules

Allowed transitions:

- `pending -> ready`: dependencies satisfied and no blocking human questions.
- `ready -> in_progress`: worker claim is atomic and assigns `assignedWorkerId`.
- `in_progress -> implemented`: branch, commit, changed files, tests, and handoff evidence exist.
- `in_progress -> blocked`: worker cannot proceed safely.
- `implemented -> validating`: validator starts review.
- `validating -> passed`: validator verdict passes.
- `validating -> needs_changes`: validator verdict fails with actionable issues.
- `needs_changes -> ready`: Orchestrator or Recovery approves a targeted retry.
- `needs_changes -> blocked`: feedback requires human decision or rescope.
- `passed -> merged`: Merge Manager completes required merge gate.
- Any active state -> `cancelled`: human or Orchestrator cancellation.

Forbidden transitions:

- `ready -> implemented` without `in_progress`.
- `implemented -> merged` without validation pass.
- `needs_changes -> passed` without new validation.
- `blocked -> in_progress` without recorded unblock reason.
- Any transition that overwrites another active worker assignment.

## Evidence Requirements

`implemented` requires:

- Branch
- Commit hash or hashes
- Changed files
- Tests run with exit codes
- Handoff accepted or equivalent structured evidence
- Notes for assumptions, remaining work, and uncertainties

`passed` requires:

- Validator verdict
- Test results or explicit reason tests were not runnable
- Scope check
- Remaining risks or `none`

`merged` requires:

- Source branch
- Target branch
- Merge commit or fast-forward commit
- CI/test result at merge gate
- Validator verdict references

`blocked` requires:

- Blocking reason
- Owner needed to unblock
- Attempts made
- Suggested next action

## Event Protocol

Every status change should record a todo event:

```json
{
  "eventType": "status_changed",
  "actorId": "agent or human id",
  "payload": {
    "from": "old status",
    "to": "new status",
    "reason": "short reason",
    "evidenceRefs": ["optional ids"]
  }
}
```

Use additional event types for `claimed`, `evidence_added`, `handoff_written`, `validation_started`, `validation_completed`, `merge_completed`, `blocked`, `unblocked`, `rescope_requested`, and `cancelled`.

## Concurrency Rules

- A todo can have only one active worker.
- Todos with overlapping `scope.in`, `likelyFiles`, `declaredPaths`, or declared modules must not run concurrently unless the Orchestrator explicitly marks them safe.
- Dependency todos must reach `passed` or `merged` before dependent todos become `ready`, unless the dependency is explicitly waived.
