import { describe, it, expect, vi } from "vitest";
import { createPlanner } from "../src/orchestrator/planner";
import type { LaPisClient } from "../src/clients/lapis-client";

describe("planner", () => {
  it("plans milestones from mission description via PiNyx", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Auth module" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1", description: "Login endpoint" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          milestones: [
            {
              title: "Auth module",
              description: "Implement JWT authentication",
              units: [{ description: "Login endpoint", declaredPaths: ["src/auth/**"], declaredModules: ["auth"] }],
              criteria: ["All tests pass", "JWT tokens valid"],
              testCommands: ["npm test -- src/auth"],
            },
          ],
        }),
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      }),
    };

    const planner = createPlanner(mockLapis, mockPinyx as never);
    const result = await planner.plan("Build authentication system", "m-1");

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Auth module");
    expect(mockLapis.createMilestone).toHaveBeenCalled();
    expect(mockLapis.createContract).toHaveBeenCalled();
  });

  it("uses the configured orchestrator model for PiNyx planning", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1", title: "Smoke" }),
      createWorkingUnit: vi.fn(),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          milestones: [{ title: "Smoke", description: "No-op", units: [], criteria: [], testCommands: [] }],
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    };

    const planner = createPlanner(mockLapis, mockPinyx as never, { model: "kilo/kilo-auto/free" });
    await planner.plan("Smoke mission", "m-1");

    expect(mockPinyx.chat).toHaveBeenCalledWith(expect.objectContaining({ model: "kilo/kilo-auto/free" }));
  });
});
