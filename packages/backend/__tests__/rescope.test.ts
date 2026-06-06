import { describe, it, expect, vi } from "vitest";
import { rescopeMilestone } from "../src/orchestrator/rescope";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import type { Mission } from "@aurex/shared";

function makeMission(): Mission {
  return {
    id: "m-1",
    description: "Build app",
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
    createdAt: "2026-01-01",
  };
}

function makeLapis(): LaPisClient {
  return {
    createWorkingUnit: vi.fn().mockResolvedValue({ id: "u-new", description: "Re-planned" }),
  } as unknown as LaPisClient;
}

function makePinyx(content: string | Error): PinyxClient {
  return {
    chat: vi.fn().mockImplementation(() => {
      if (content instanceof Error) return Promise.reject(content);
      return Promise.resolve({
        content,
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    }),
  } as unknown as PinyxClient;
}

describe("rescopeMilestone", () => {
  it("calls pinyx with the rescope system prompt and milestone context, then creates the new units", async () => {
    const plan = JSON.stringify({
      units: [
        { description: "Unit A", declaredPaths: ["src/a.ts"], declaredModules: ["a"] },
        { description: "Unit B", declaredPaths: ["src/b.ts"], declaredModules: ["b"] },
      ],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();

    const result = await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "Implement auth", description: "Add login + signup" },
      model: "reasoning-strong",
      reason: "scrutiny failed",
    });

    expect(result).toEqual({
      ok: true,
      units: [
        { description: "Unit A", declaredPaths: ["src/a.ts"], declaredModules: ["a"] },
        { description: "Unit B", declaredPaths: ["src/b.ts"], declaredModules: ["b"] },
      ],
    });

    expect(pinyx.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "reasoning-strong",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: expect.stringContaining("Re-plan this milestone") }),
          expect.objectContaining({ role: "user", content: expect.stringContaining("Implement auth") }),
        ]),
      }),
    );
    expect(lapis.createWorkingUnit).toHaveBeenCalledTimes(2);
    expect(lapis.createWorkingUnit).toHaveBeenNthCalledWith(1, "ms-1", { description: "Unit A", declaredPaths: ["src/a.ts"], declaredModules: ["a"] });
    expect(lapis.createWorkingUnit).toHaveBeenNthCalledWith(2, "ms-1", { description: "Unit B", declaredPaths: ["src/b.ts"], declaredModules: ["b"] });
  });

  it("returns ok:false with pinyx_threw when the LLM call throws", async () => {
    const pinyx = makePinyx(new Error("provider down"));
    const lapis = makeLapis();

    const result = await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe("pinyx_threw");
      expect(result.message).toBe("provider down");
    }
    expect(lapis.createWorkingUnit).not.toHaveBeenCalled();
  });

  it("returns ok:false with invalid_plan when the response is not valid JSON", async () => {
    const pinyx = makePinyx("not json at all");
    const lapis = makeLapis();

    const result = await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe("invalid_plan");
      expect(result.content).toBe("not json at all");
    }
    expect(lapis.createWorkingUnit).not.toHaveBeenCalled();
  });

  it("returns ok:false with invalid_plan when the JSON does not have a units array", async () => {
    const pinyx = makePinyx(JSON.stringify({ milestones: [] }));
    const lapis = makeLapis();

    const result = await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe("invalid_plan");
    }
    expect(lapis.createWorkingUnit).not.toHaveBeenCalled();
  });
});
