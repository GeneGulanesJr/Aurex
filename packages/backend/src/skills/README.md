# Aurex Skill Prompt Inventory

## Runtime-Wired Prompts

These are currently referenced by `src/agents/factory.ts`:

- `orchestrator.md`: mission planning and mission lifecycle coordination
- `worker.md`: one-todo/working-unit implementation
- `validator.md`: milestone-based scrutiny and user-testing validation
- `research.md`: research finding capture

## Prompt-Only Contracts

These define the rest of the Aurex operating model. They are not first-class spawned agent types yet unless the runtime is extended to load them.

- `todo-state-protocol.md`: exact todo/ledger state transitions and ownership
- `mission-ledger-reconciliation.md`: live loop for updating ledger readiness, progress, dependencies, blockers, and next actions
- `human-escalation.md`: when Aurex must stop and ask the human
- `merge-manager.md`: gated merge behavior after validation
- `failure-recovery.md`: retry, rescope, conflict, and blocked-context recovery
- `final-audit-reporter.md`: mission closeout and audit trail format

## Runtime Work Still Needed

To make the prompt-only contracts active agents instead of operating documents, Aurex needs matching runtime support:

- Add new `AgentType` values where appropriate.
- Add model hints and tool permissions.
- Add factory mappings to these prompt files.
- Add LaPis tools for todo claim/update/evidence where the agent needs direct state writes.
- Add a runtime reconciliation loop that runs after worker, validator, merge, recovery, and human checkpoint events.
- Add tests for state transitions, ledger reconciliation, merge gates, recovery limits, and audit report generation.
