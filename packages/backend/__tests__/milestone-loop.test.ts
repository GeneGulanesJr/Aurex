import { describe, it, expect, vi } from "vitest";
import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { Mission, Milestone } from "@aurex/shared";

describe("milestone loop", () => {
  const mission: Mission = {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };

  it("skips completed milestones", async () => {
    const milestones: Milestone[] = [
      { id: "ms-1", missionId: "m-1", title: "Done", description: "", orderIndex: 0, status: "completed", validationContractId: "c-1" },
      { id: "ms-2", missionId: "m-1", title: "Pending", description: "", orderIndex: 1, status: "planned", validationContractId: "c-2" },
    ];

    const mockLapis = {
      updateMissionStatus: vi.fn(),
      updateMilestoneStatus: vi.fn(),
      incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-2", retries: 0, rescopes: 0 }),
      getVerdicts: vi.fn().mockResolvedValue([]),
    } as unknown as LaPisClient;

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(mockLapis, {} as never, callbacks);
    const result = await loop.run(mission, milestones);

    expect(result).toBe(true);
    // Should only update ms-2 (ms-1 is completed, skipped)
    expect(callbacks.onMilestoneProgress).toHaveBeenCalledWith("ms-2", "in_progress", 0, 0);
  });

  it("pauses on escalation", async () => {
    const milestones: Milestone[] = [
      { id: "ms-1", missionId: "m-1", title: "Failing", description: "", orderIndex: 0, status: "planned", validationContractId: "c-1" },
    ];

    const mockLapis = {
      updateMissionStatus: vi.fn(),
      updateMilestoneStatus: vi.fn(),
      incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-1", retries: 2, rescopes: 5 }),
      getVerdicts: vi.fn().mockResolvedValue([
        { verdict: "fail", validatorType: "validator_scrutiny", classification: "blocking" },
      ]),
    } as unknown as LaPisClient;

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(mockLapis, {} as never, callbacks);
    const result = await loop.run(mission, milestones);

    expect(result).toBe(false);
    expect(callbacks.onEscalation).toHaveBeenCalled();
  });
});
