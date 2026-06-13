import type { LaPisClient } from "../clients/lapis-client.js";
import type { MissionTodo, TodoEvidence, TodoLedgerStatus, TodoStatus, ValidationVerdict, WorkingUnit } from "@aurex/shared";

type NextActionType =
  | "spawn_worker"
  | "spawn_validator"
  | "merge"
  | "recover"
  | "request_context"
  | "escalate"
  | "start_next_milestone"
  | "complete_mission"
  | "pause";

export interface LedgerReconciliationReport {
  missionId: string;
  ledgerStatus: TodoLedgerStatus;
  summary: string;
  todoStatusCounts: Record<TodoStatus, number>;
  stateUpdates: Array<{ todoId: string; from: TodoStatus; to: TodoStatus; reason: string }>;
  readyToSpawn: string[];
  readyToValidate: string[];
  readyToMerge: string[];
  blocked: Array<{ todoId: string; reason: string; ownerNeeded: string }>;
  recoveryNeeded: string[];
  escalationsNeeded: Array<{ todoId?: string; question: string; reason: string }>;
  nextAction: { type: NextActionType; targetIds: string[]; reason: string };
  risks: string[];
}

export interface LedgerReconciliationInput {
  missionId: string;
  milestoneId?: string;
  reason: string;
  actorId?: string;
}

export interface WorkerTodoUpdateInput {
  missionId: string;
  unit: WorkingUnit;
  workerId: string;
  status: "in_progress" | "implemented" | "blocked";
  reason: string;
  branch?: string;
  commits?: string[];
  changedFiles?: string[];
  testsRun?: TodoEvidence["testsRun"];
  notes?: string[];
}

export interface ValidatorTodoUpdateInput {
  missionId: string;
  verdicts: ValidationVerdict[];
  reason: string;
}

export interface MergeTodoUpdateInput {
  missionId: string;
  units: WorkingUnit[];
  sourceBranches: string[];
  targetBranch: string;
  mergeCommit?: string;
  reason: string;
}

const TODO_STATUSES: TodoStatus[] = [
  "pending",
  "ready",
  "in_progress",
  "blocked",
  "implemented",
  "validating",
  "needs_changes",
  "passed",
  "merged",
  "cancelled",
];

const SKIP_STATUSES = new Set<TodoStatus>(["passed", "merged", "cancelled"]);

export async function reconcileMissionLedger(
  lapis: LaPisClient,
  input: LedgerReconciliationInput,
): Promise<LedgerReconciliationReport | null> {
  const todos = await listTodosSafely(lapis, input.missionId);
  if (!todos) return null;

  const stateUpdates: LedgerReconciliationReport["stateUpdates"] = [];
  const actorId = input.actorId ?? "ledger-reconciler";
  const updatedTodos = [...todos];

  for (const todo of todos) {
    if (todo.status !== "pending") continue;
    const dependenciesReady = todo.dependsOn.every((depId) => {
      const dep = updatedTodos.find((candidate) => candidate.id === depId);
      return dep && (dep.status === "passed" || dep.status === "merged" || dep.status === "cancelled");
    });
    if (!dependenciesReady) continue;

    const updated = await setTodoStatusSafely(lapis, todo, "ready", actorId, "dependencies satisfied during ledger reconciliation");
    if (updated) {
      replaceTodo(updatedTodos, updated);
      stateUpdates.push({ todoId: todo.id, from: todo.status, to: "ready", reason: "dependencies satisfied" });
    }
  }

  const counts = countStatuses(updatedTodos);
  const ledgerStatus = inferLedgerStatus(updatedTodos);
  await setLedgerStatusSafely(lapis, input.missionId, ledgerStatus, actorId, input.reason);

  const readyToSpawn = updatedTodos.filter((todo) => todo.status === "ready" && todo.type !== "validation").map((todo) => todo.id);
  const readyToValidate = updatedTodos.filter((todo) => todo.status === "implemented").map((todo) => todo.id);
  const readyToMerge = updatedTodos.filter((todo) => todo.status === "passed").map((todo) => todo.id);
  const blocked = updatedTodos
    .filter((todo) => todo.status === "blocked")
    .map((todo) => ({ todoId: todo.id, reason: latestNote(todo) || "todo is blocked", ownerNeeded: "orchestrator" }));
  const recoveryNeeded = updatedTodos.filter((todo) => todo.status === "needs_changes").map((todo) => todo.id);
  const nextAction = chooseNextAction({ readyToSpawn, readyToValidate, readyToMerge, blocked, recoveryNeeded, ledgerStatus });

  await recordMissionEventSafely(lapis, input.missionId, {
    eventType: "ledger_reconciled",
    actorId,
    payload: {
      reason: input.reason,
      milestoneId: input.milestoneId,
      ledgerStatus,
      stateUpdates,
      nextAction,
      counts,
    },
  });

  return {
    missionId: input.missionId,
    ledgerStatus,
    summary: `${input.reason}: ${stateUpdates.length} todo transition(s), next action ${nextAction.type}`,
    todoStatusCounts: counts,
    stateUpdates,
    readyToSpawn,
    readyToValidate,
    readyToMerge,
    blocked,
    recoveryNeeded,
    escalationsNeeded: blocked.map((entry) => ({
      todoId: entry.todoId,
      question: "What decision or context is required to unblock this todo?",
      reason: entry.reason,
    })),
    nextAction,
    risks: blocked.length > 0 ? blocked.map((entry) => `Blocked todo ${entry.todoId}: ${entry.reason}`) : ["none"],
  };
}

export async function markWorkerTodoProgress(lapis: LaPisClient, input: WorkerTodoUpdateInput): Promise<MissionTodo | null> {
  const todo = await findTodoForUnit(lapis, input.missionId, input.unit);
  if (!todo || SKIP_STATUSES.has(todo.status)) return null;

  const patch: Partial<MissionTodo> = {};
  if (input.status === "in_progress") patch.assignedWorkerId = input.workerId;

  if (input.status === "implemented" || input.status === "blocked") {
    patch.evidence = mergeEvidence(todo.evidence, {
      branch: input.branch ?? todo.evidence.branch,
      commits: input.commits ?? [],
      changedFiles: input.changedFiles ?? [],
      testsRun: input.testsRun ?? [],
      notes: input.notes ?? [input.reason],
    });
  }

  await updateTodoSafely(lapis, todo.id, patch);
  const updated = await setTodoStatusSafely(lapis, todo, input.status, input.workerId, input.reason);

  if (input.status === "in_progress") {
    await assignTodoSafely(lapis, todo.id, input.workerId);
  }

  await recordTodoEventSafely(lapis, todo.id, {
    eventType: input.status === "in_progress" ? "claimed" : input.status === "implemented" ? "handoff_written" : "blocked",
    actorId: input.workerId,
    payload: { unitId: input.unit.id, reason: input.reason, branch: input.branch, commits: input.commits },
  });

  return updated;
}

export async function applyValidatorVerdictsToTodos(lapis: LaPisClient, input: ValidatorTodoUpdateInput): Promise<MissionTodo[]> {
  const todos = await listTodosSafely(lapis, input.missionId);
  if (!todos) return [];

  const updated: MissionTodo[] = [];
  for (const verdict of input.verdicts) {
    const failedIds = new Set(Array.isArray(verdict.failedUnitIds) ? verdict.failedUnitIds : []);
    const candidateTodos = failedIds.size > 0
      ? todos.filter((todo) => failedIds.has(todo.id) || failedIds.has(todo.goal) || todoMatchesAnyUnitId(todo, failedIds))
      : todos.filter((todo) => todo.status === "implemented" || todo.status === "validating");

    for (const todo of candidateTodos) {
      if (SKIP_STATUSES.has(todo.status)) continue;
      const nextStatus: TodoStatus = verdict.verdict === "pass" ? "passed" : "needs_changes";
      const evidence = mergeEvidence(todo.evidence, {
        validatorVerdict: verdict,
        notes: [`Validator ${verdict.validatorType} ${verdict.verdict}: ${truncate(verdict.findings, 240)}`],
      });
      await updateTodoSafely(lapis, todo.id, { evidence } as Partial<MissionTodo>);
      const changed = await setTodoStatusSafely(lapis, todo, nextStatus, verdict.sessionId || "validator", input.reason);
      if (changed) updated.push(changed);
      await recordTodoEventSafely(lapis, todo.id, {
        eventType: "validation_completed",
        actorId: verdict.sessionId || verdict.validatorType,
        payload: { verdict: verdict.verdict, validatorType: verdict.validatorType, failedUnitIds: verdict.failedUnitIds },
      });
    }
  }

  return updated;
}

export async function markMergedTodos(lapis: LaPisClient, input: MergeTodoUpdateInput): Promise<MissionTodo[]> {
  const updated: MissionTodo[] = [];
  for (const unit of input.units) {
    const todo = await findTodoForUnit(lapis, input.missionId, unit);
    if (!todo || todo.status !== "passed") continue;
    const evidence = mergeEvidence(todo.evidence, {
      branch: input.targetBranch,
      commits: input.mergeCommit ? [input.mergeCommit] : [],
      notes: [`Merged ${input.sourceBranches.join(", ")} into ${input.targetBranch}: ${input.reason}`],
    });
    await updateTodoSafely(lapis, todo.id, { evidence } as Partial<MissionTodo>);
    const changed = await setTodoStatusSafely(lapis, todo, "merged", "merge-manager", input.reason);
    if (changed) updated.push(changed);
    await recordTodoEventSafely(lapis, todo.id, {
      eventType: "merge_completed",
      actorId: "merge-manager",
      payload: {
        unitId: unit.id,
        sourceBranches: input.sourceBranches,
        targetBranch: input.targetBranch,
        mergeCommit: input.mergeCommit,
      },
    });
  }
  return updated;
}

async function findTodoForUnit(lapis: LaPisClient, missionId: string, unit: WorkingUnit): Promise<MissionTodo | null> {
  const todos = await listTodosSafely(lapis, missionId);
  if (!todos) return null;

  return todos.find((todo) => todo.goal === unit.description)
    ?? todos.find((todo) => todo.title === unit.description || unit.description.startsWith(todo.title))
    ?? todos.find((todo) => todo.type === "implementation" && unit.declaredPaths.length > 0 && unit.declaredPaths.every((path) => todo.likelyFiles.includes(path)))
    ?? null;
}

async function listTodosSafely(lapis: LaPisClient, missionId: string): Promise<MissionTodo[] | null> {
  const client = lapis as unknown as { listTodosByMission?: (missionId: string) => Promise<MissionTodo[]> };
  if (typeof client.listTodosByMission !== "function") return null;
  try {
    return await client.listTodosByMission(missionId);
  } catch {
    return null;
  }
}

async function setTodoStatusSafely(
  lapis: LaPisClient,
  todo: MissionTodo,
  status: TodoStatus,
  actorId: string,
  reason: string,
): Promise<MissionTodo | null> {
  if (todo.status === status) return todo;
  const client = lapis as unknown as { setTodoStatus?: (todoId: string, status: TodoStatus) => Promise<MissionTodo> };
  if (typeof client.setTodoStatus !== "function") return null;
  try {
    const updated = await client.setTodoStatus(todo.id, status);
    await recordTodoEventSafely(lapis, todo.id, {
      eventType: "status_changed",
      actorId,
      payload: { from: todo.status, to: status, reason },
    });
    return updated;
  } catch {
    return null;
  }
}

async function setLedgerStatusSafely(
  lapis: LaPisClient,
  missionId: string,
  status: TodoLedgerStatus,
  actorId: string,
  reason: string,
): Promise<void> {
  const client = lapis as unknown as { setMissionLedgerStatus?: (missionId: string, status: TodoLedgerStatus) => Promise<unknown> };
  if (typeof client.setMissionLedgerStatus !== "function") return;
  try {
    await client.setMissionLedgerStatus(missionId, status);
    await recordMissionEventSafely(lapis, missionId, {
      eventType: "ledger_status_changed",
      actorId,
      payload: { to: status, reason },
    });
  } catch {
    // Reconciliation should never break mission execution when the ledger API is unavailable.
  }
}

async function updateTodoSafely(lapis: LaPisClient, todoId: string, patch: Partial<MissionTodo>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const client = lapis as unknown as { updateTodo?: (todoId: string, patch: Partial<MissionTodo>) => Promise<MissionTodo> };
  if (typeof client.updateTodo !== "function") return;
  try {
    await client.updateTodo(todoId, patch);
  } catch {
    // Best-effort evidence update.
  }
}

async function assignTodoSafely(lapis: LaPisClient, todoId: string, workerId: string): Promise<void> {
  const client = lapis as unknown as { assignTodo?: (todoId: string, workerId: string | null) => Promise<MissionTodo> };
  if (typeof client.assignTodo !== "function") return;
  try {
    await client.assignTodo(todoId, workerId);
  } catch {
    // Best-effort assignment update.
  }
}

async function recordTodoEventSafely(
  lapis: LaPisClient,
  todoId: string,
  event: { eventType: string; actorId?: string | null; payload?: Record<string, unknown> },
): Promise<void> {
  const client = lapis as unknown as { recordTodoEvent?: typeof lapis.recordTodoEvent };
  if (typeof client.recordTodoEvent !== "function") return;
  try {
    await client.recordTodoEvent(todoId, event);
  } catch {
    // Best-effort audit event.
  }
}

async function recordMissionEventSafely(
  lapis: LaPisClient,
  missionId: string,
  event: { eventType: string; actorId?: string | null; payload?: Record<string, unknown> },
): Promise<void> {
  const client = lapis as unknown as { recordMissionTodoEvent?: typeof lapis.recordMissionTodoEvent };
  if (typeof client.recordMissionTodoEvent !== "function") return;
  try {
    await client.recordMissionTodoEvent(missionId, event);
  } catch {
    // Best-effort audit event.
  }
}

function countStatuses(todos: MissionTodo[]): Record<TodoStatus, number> {
  const counts = Object.fromEntries(TODO_STATUSES.map((status) => [status, 0])) as Record<TodoStatus, number>;
  for (const todo of todos) counts[todo.status] += 1;
  return counts;
}

function inferLedgerStatus(todos: MissionTodo[]): TodoLedgerStatus {
  if (todos.length === 0) return "planning";
  if (todos.every((todo) => todo.status === "cancelled")) return "cancelled";
  if (todos.every((todo) => todo.status === "passed" || todo.status === "merged" || todo.status === "cancelled")) return "completed";
  if (todos.some((todo) => todo.status === "validating" || todo.status === "implemented")) return "validating";
  if (todos.some((todo) => todo.status === "in_progress")) return "in_progress";
  if (todos.some((todo) => todo.status === "ready" || todo.status === "needs_changes")) return "ready";
  if (todos.some((todo) => todo.status === "blocked")) return "blocked";
  return "planning";
}

function chooseNextAction(input: {
  readyToSpawn: string[];
  readyToValidate: string[];
  readyToMerge: string[];
  blocked: Array<{ todoId: string }>;
  recoveryNeeded: string[];
  ledgerStatus: TodoLedgerStatus;
}): LedgerReconciliationReport["nextAction"] {
  if (input.readyToSpawn.length > 0) return { type: "spawn_worker", targetIds: input.readyToSpawn, reason: "ready todos are available" };
  if (input.readyToValidate.length > 0) return { type: "spawn_validator", targetIds: input.readyToValidate, reason: "implemented todos need validation" };
  if (input.readyToMerge.length > 0) return { type: "merge", targetIds: input.readyToMerge, reason: "passed todos are ready to merge" };
  if (input.recoveryNeeded.length > 0) return { type: "recover", targetIds: input.recoveryNeeded, reason: "todos need changes" };
  if (input.blocked.length > 0) return { type: "escalate", targetIds: input.blocked.map((entry) => entry.todoId), reason: "blocked todos require outside input" };
  if (input.ledgerStatus === "completed") return { type: "complete_mission", targetIds: [], reason: "all required todos completed" };
  return { type: "pause", targetIds: [], reason: "no actionable todo state available" };
}

function mergeEvidence(existing: MissionTodo["evidence"], update: Partial<MissionTodo["evidence"]>): MissionTodo["evidence"] {
  return {
    branch: update.branch ?? existing.branch,
    commits: unique([...(existing.commits ?? []), ...(update.commits ?? [])]),
    changedFiles: unique([...(existing.changedFiles ?? []), ...(update.changedFiles ?? [])]),
    testsRun: [...(existing.testsRun ?? []), ...(update.testsRun ?? [])],
    testResults: [...(existing.testResults ?? []), ...(update.testResults ?? [])],
    validatorVerdict: update.validatorVerdict ?? existing.validatorVerdict,
    notes: unique([...(existing.notes ?? []), ...(update.notes ?? [])]),
  };
}

function replaceTodo(todos: MissionTodo[], updated: MissionTodo): void {
  const idx = todos.findIndex((todo) => todo.id === updated.id);
  if (idx >= 0) todos[idx] = updated;
}

function latestNote(todo: MissionTodo): string | null {
  return todo.evidence.notes.length > 0 ? todo.evidence.notes[todo.evidence.notes.length - 1] : null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function todoMatchesAnyUnitId(todo: MissionTodo, unitIds: Set<string>): boolean {
  return [...unitIds].some((unitId) => todo.title.includes(unitId) || todo.goal.includes(unitId) || todo.evidence.notes.some((note) => note.includes(unitId)));
}
