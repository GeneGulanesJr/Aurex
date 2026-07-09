import { describe, expect, it, vi } from "vitest";
import type { LaPisClient } from "../src/clients/lapis-client";
import {
  applyValidatorVerdictsToTodos,
  markMergedTodos,
  markWorkerTodoProgress,
  reconcileMissionLedger,
} from "../src/orchestrator/ledger-reconciler";
import type { MissionTodo, TodoStatus, WorkingUnit } from "@aurex/shared";

function makeTodo(overrides: Partial<MissionTodo> = {}): MissionTodo {
  return {
    id: "td-1",
    missionId: "m-1",
    title: "Implement auth",
    status: "ready",
    type: "implementation",
    priority: "medium",
    dependsOn: [],
    goal: "Create login endpoint",
    scope: { in: ["src/auth.ts"], out: [] },
    likelyFiles: ["src/auth.ts"],
    lapisContextQuery: "auth context",
    acceptanceCriteria: ["Login works"],
    validationCriteria: ["Tests pass"],
    testCommands: ["pnpm test auth"],
    riskLevel: "low",
    workerInstructions: [],
    validatorInstructions: [],
    escalationRules: [],
    evidence: {
      branch: null,
      commits: [],
      changedFiles: [],
      testsRun: [],
      testResults: [],
      validatorVerdict: null,
      notes: [],
    },
    confidence: "medium",
    assignedWorkerId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUnit(overrides: Partial<WorkingUnit> = {}): WorkingUnit {
  return {
    id: "u-1",
    milestoneId: "ms-1",
    description: "Create login endpoint",
    declaredPaths: ["src/auth.ts"],
    declaredModules: ["auth"],
    status: "planned",
    taskBranch: "task/u-1",
    worktreePath: "/tmp/u-1",
    sessionId: "s-1",
    ...overrides,
  };
}

function createMockLapis(initialTodos: MissionTodo[]) {
  const todos = new Map(initialTodos.map((todo) => [todo.id, todo]));
  const lapis = {
    listTodosByMission: vi.fn().mockImplementation(async () => [...todos.values()]),
    setTodoStatus: vi.fn().mockImplementation(async (todoId: string, status: TodoStatus) => {
      const current = todos.get(todoId)!;
      const updated = { ...current, status };
      todos.set(todoId, updated);
      return updated;
    }),
    updateTodo: vi.fn().mockImplementation(async (todoId: string, patch: Partial<MissionTodo>) => {
      const current = todos.get(todoId)!;
      const updated = { ...current, ...patch };
      todos.set(todoId, updated);
      return updated;
    }),
    assignTodo: vi.fn().mockImplementation(async (todoId: string, workerId: string | null) => {
      const current = todos.get(todoId)!;
      const updated = { ...current, assignedWorkerId: workerId };
      todos.set(todoId, updated);
      return updated;
    }),
    setMissionLedgerStatus: vi.fn().mockResolvedValue({}),
    recordMissionTodoEvent: vi.fn().mockResolvedValue({}),
    recordTodoEvent: vi.fn().mockResolvedValue({}),
  } as unknown as LaPisClient & {
    listTodosByMission: ReturnType<typeof vi.fn>;
    setTodoStatus: ReturnType<typeof vi.fn>;
    updateTodo: ReturnType<typeof vi.fn>;
    assignTodo: ReturnType<typeof vi.fn>;
    setMissionLedgerStatus: ReturnType<typeof vi.fn>;
    recordMissionTodoEvent: ReturnType<typeof vi.fn>;
    recordTodoEvent: ReturnType<typeof vi.fn>;
  };

  return { lapis, todos };
}

describe("ledger reconciler", () => {
  it("releases pending todos when dependencies are satisfied", async () => {
    const dependency = makeTodo({ id: "td-dep", status: "passed", goal: "Dependency" });
    const dependent = makeTodo({ id: "td-next", status: "pending", dependsOn: ["td-dep"], goal: "Next step" });
    const { lapis } = createMockLapis([dependency, dependent]);

    const report = await reconcileMissionLedger(lapis, {
      missionId: "m-1",
      reason: "test reconciliation",
      actorId: "orchestrator",
    });

    expect(report?.stateUpdates).toEqual([
      { todoId: "td-next", from: "pending", to: "ready", reason: "dependencies satisfied" },
    ]);
    expect(lapis.setTodoStatus).toHaveBeenCalledWith("td-next", "ready");
    expect(lapis.setMissionLedgerStatus).toHaveBeenCalledWith("m-1", "ready");
  });

  it("marks a worker todo in progress and assigns the worker", async () => {
    const todo = makeTodo();
    const { lapis } = createMockLapis([todo]);

    await markWorkerTodoProgress(lapis, {
      missionId: "m-1",
      unit: makeUnit(),
      workerId: "worker-u-1",
      status: "in_progress",
      reason: "worker spawned",
      branch: "task/u-1",
    });

    expect(lapis.assignTodo).toHaveBeenCalledWith("td-1", "worker-u-1");
    expect(lapis.setTodoStatus).toHaveBeenCalledWith("td-1", "in_progress");
    expect(lapis.recordTodoEvent).toHaveBeenCalledWith("td-1", expect.objectContaining({ eventType: "claimed" }));
  });

  it("records worker implementation evidence", async () => {
    const todo = makeTodo({ status: "in_progress" });
    const { lapis, todos } = createMockLapis([todo]);

    await markWorkerTodoProgress(lapis, {
      missionId: "m-1",
      unit: makeUnit(),
      workerId: "worker-u-1",
      status: "implemented",
      reason: "worker completed",
      branch: "task/u-1",
      commits: ["abc123"],
      changedFiles: ["src/auth.ts"],
      testsRun: [{ command: "pnpm test auth", exitCode: 0 }],
    });

    expect(lapis.setTodoStatus).toHaveBeenCalledWith("td-1", "implemented");
    expect(todos.get("td-1")?.evidence).toEqual(expect.objectContaining({
      branch: "task/u-1",
      commits: ["abc123"],
      changedFiles: ["src/auth.ts"],
      testsRun: [{ command: "pnpm test auth", exitCode: 0 }],
    }));
  });

  it("applies validator pass verdicts to implemented todos", async () => {
    const todo = makeTodo({ status: "implemented" });
    const { lapis, todos } = createMockLapis([todo]);

    await applyValidatorVerdictsToTodos(lapis, {
      missionId: "m-1",
      reason: "validator done",
      verdicts: [{
        id: "v-1",
        milestoneId: "ms-1",
        contractId: "c-1",
        validatorType: "validator_scrutiny",
        sessionId: "validator-s-1",
        verdict: "pass",
        findings: "Looks good",
        failedUnitIds: [],
        timestamp: "2026-01-01T00:00:00Z",
      }],
    });

    expect(lapis.setTodoStatus).toHaveBeenCalledWith("td-1", "passed");
    expect(todos.get("td-1")?.evidence.validatorVerdict).toEqual(expect.objectContaining({ verdict: "pass" }));
  });

  it("downgrades passed todos when a later validator verdict fails", async () => {
    const todo = makeTodo({ status: "implemented" });
    const { lapis, todos } = createMockLapis([todo]);

    await applyValidatorVerdictsToTodos(lapis, {
      missionId: "m-1",
      reason: "validator done",
      verdicts: [
        {
          id: "v-1",
          milestoneId: "ms-1",
          contractId: "c-1",
          validatorType: "validator_scrutiny",
          sessionId: "validator-s-1",
          verdict: "pass",
          findings: "Looks good",
          failedUnitIds: [],
          timestamp: "2026-01-01T00:00:00Z",
        },
        {
          id: "v-2",
          milestoneId: "ms-1",
          contractId: "c-1",
          validatorType: "validator_user_testing",
          sessionId: "validator-s-2",
          verdict: "fail",
          findings: "UX issue",
          failedUnitIds: [],
          timestamp: "2026-01-01T00:00:01Z",
        },
      ],
    });

    expect(lapis.setTodoStatus).toHaveBeenLastCalledWith("td-1", "needs_changes");
    expect(todos.get("td-1")?.status).toBe("needs_changes");
  });

  it("marks passed todos as merged after merge evidence", async () => {
    const todo = makeTodo({ status: "passed" });
    const { lapis, todos } = createMockLapis([todo]);

    await markMergedTodos(lapis, {
      missionId: "m-1",
      units: [makeUnit()],
      sourceBranches: ["task/u-1"],
      targetBranch: "integration/m-1",
      mergeCommit: "merge123",
      reason: "integration completed",
    });

    expect(lapis.setTodoStatus).toHaveBeenCalledWith("td-1", "merged");
    expect(todos.get("td-1")?.evidence).toEqual(expect.objectContaining({
      branch: "integration/m-1",
      commits: ["merge123"],
    }));
  });
});
