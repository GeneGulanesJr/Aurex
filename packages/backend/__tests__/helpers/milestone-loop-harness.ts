import { vi } from "vitest";
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";
import type { LaPisClient } from "../../src/clients/lapis-client.js";
import type { PinyxClient } from "../../src/clients/pinyx-client.js";
import { makeHandoff } from "./make-handoff.js";

export function makeMission(overrides?: Partial<Mission>): Mission {
  return {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    id: "ms-1",
    missionId: "m-1",
    title: "Auth module",
    description: "Implement auth",
    orderIndex: 0,
    status: "planned",
    validationContractId: "contract-1",
    ...overrides,
  };
}

export function makeUnit(overrides?: Partial<WorkingUnit>): WorkingUnit {
  return {
    id: "unit-1",
    milestoneId: "ms-1",
    description: "Create login endpoint",
    declaredPaths: ["src/auth/login.ts"],
    declaredModules: ["auth"],
    status: "planned",
    taskBranch: "",
    worktreePath: "",
    sessionId: "",
    ...overrides,
  };
}

export function createMockLapis(
  units: WorkingUnit[] = [],
  handoffs = units.map((unit) => makeHandoff(unit.id)),
): LaPisClient {
  const storedUnits = [...units];
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnit: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkingUnit>) => {
      const index = storedUnits.findIndex((unit) => unit.id === id);
      if (index >= 0) {
        storedUnits[index] = { ...storedUnits[index], ...patch };
      }
    }),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 0, rescopes: 0 }),
    getVerdicts: vi.fn().mockResolvedValue([
      { verdict: "pass", validatorType: "validator_scrutiny", sessionId: "test-session-123" },
      { verdict: "pass", validatorType: "validator_user_testing", sessionId: "test-session-123" },
    ]),
    getSessionsForMilestone: vi.fn().mockResolvedValue([
      { sessionId: "test-session-123", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", terminatedAt: null },
    ]),
    getWorkingUnitsForMilestone: vi.fn().mockImplementation(async () => [...storedUnits]),
    getContractHistory: vi.fn().mockResolvedValue([{
      id: "contract-1",
      content: { criteria: ["works"], testCommands: ["npm test"], acceptanceBehavior: "works" },
    }]),
    getHandoffsForMilestone: vi.fn().mockResolvedValue(handoffs),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => (
      handoffs.find((handoff) => handoff.unitId === unitId) ?? null
    )),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    logCost: vi.fn().mockResolvedValue(undefined),
    writeHandoff: vi.fn().mockResolvedValue({ accepted: true, errors: [] }),
    writeVerdict: vi.fn().mockResolvedValue({}),
    searchMemory: vi.fn().mockResolvedValue([]),
    getFindings: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

export function createMockPinyx(): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "{}",
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    ping: vi.fn().mockResolvedValue(undefined),
  } as unknown as PinyxClient;
}

export function makeLoopCallbacks() {
  return {
    onEscalation: vi.fn(),
    onAgentStatus: vi.fn(),
    onMilestoneProgress: vi.fn(),
    onCostUpdate: vi.fn(),
    onError: vi.fn(),
  };
}

export function makeLoopConfig(repoRoot = "/repo") {
  return {
    agentDir: "/home/user/.pi/agent",
    repoRoot,
    aurexRoot: "/aurex",
    gitMainBranch: "main",
  };
}
