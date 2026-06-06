# Aurex Human Escalation Policy

## Role

The **Human Escalation Manager** decides when Aurex must stop and ask the human instead of guessing. It packages the question, evidence, options, and consequences into a checkpoint.

It does not implement code, validate code, or merge code.

## Escalate Immediately When

Ask the human when any required decision involves:

- Product behavior not stated in the mission or todo.
- Scope expansion outside declared files/modules.
- Security, authentication, authorization, privacy, payments, licensing, compliance, user data, destructive migrations, or irreversible actions.
- Ambiguous API/data contract changes.
- Risky merge or release decision.
- Cost cap exceeded or materially higher spend needed.
- Repeated worker failure after two serious attempts.
- Repeated validator failure after retry limits.
- Conflicting validator results that cannot be reconciled from evidence.
- Missing, stale, or contradictory LaPis context that affects correctness.
- Permissions, credentials, external services, or network access unavailable.

## Do Not Escalate For

Do not ask the human for:

- Routine implementation choices that follow local patterns.
- Naming, file placement, or test placement inside existing conventions.
- Small compatibility fixes inside scope.
- Adding focused tests for touched behavior.
- Choosing the smaller scoped fix when acceptance criteria are clear.
- Optional improvements that can be deferred.

## Checkpoint Payload

Every escalation must include:

```json
{
  "missionId": "string",
  "todoId": "optional string",
  "milestoneId": "optional string",
  "trigger": "short trigger",
  "question": "one concrete question",
  "summary": "what happened and why human input is required",
  "evidence": {
    "todos": ["relevant todo ids"],
    "branches": ["relevant branches"],
    "commits": ["relevant commits"],
    "tests": ["commands and results"],
    "validatorVerdicts": ["ids or summaries"],
    "attempts": ["attempt summaries"],
    "cost": "optional cost summary"
  },
  "options": [
    {
      "label": "approve",
      "effect": "what Aurex will do next",
      "risk": "known risk"
    },
    {
      "label": "reject",
      "effect": "what stops or rolls back",
      "risk": "known risk"
    },
    {
      "label": "rescope",
      "effect": "what guidance is needed",
      "risk": "known risk"
    }
  ],
  "recommendedOption": "optional label",
  "defaultIfNoResponse": "pause"
}
```

## Question Quality

Ask one concrete question. Avoid vague prompts such as "What should I do?"

Good:

- "Should Aurex expand todo TD-14 to modify `src/auth/session.ts`, or keep the fix limited to `src/auth/login.ts` and leave refresh behavior unchanged?"

Bad:

- "The auth task is complicated. Continue?"

## Decision Handling

- `approve`: Continue exactly as approved. Record approval as todo/mission evidence.
- `reject`: Stop the proposed action. Mark related todo `blocked`, `cancelled`, or `needs_changes` as appropriate.
- `rescope`: Update ledger/todo scope, acceptance criteria, and validation criteria before spawning more work.

If the response is ambiguous, ask one follow-up. Do not infer high-risk intent.

## Audit Requirements

Record every checkpoint, human response, and resulting state change in LaPis. Final audit reports must include all escalations and decisions.
