import { describe, it, expect, vi } from "vitest";
import { rescopeMilestone } from "../src/orchestrator/rescope";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import type { Mission, ValidationVerdict, ResearchFinding } from "@aurex/shared";

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
    getContractHistory: vi.fn().mockResolvedValue([]),
    supersedeContract: vi.fn().mockResolvedValue({ id: "c-new", version: 2, supersededBy: null }),
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
          expect.objectContaining({ role: "system", content: expect.stringContaining("re-planning") }),
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

  it("includes validator verdicts in the rescope prompt when provided", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();

    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", findings: "Missing error handling in auth flow", classification: "blocking", failedUnitIds: ["u-1"], timestamp: "" },
    ];

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "Implement auth", description: "Add login + signup" },
      model: "reasoning-strong",
      reason: "scrutiny failed",
      verdicts,
    });

    const userMessage = (pinyx.chat as any).mock.calls[0][0].messages.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Missing error handling in auth flow");
    expect(userMessage).toContain("validator_scrutiny");
  });

  it("includes completed unit summaries in the rescope prompt so they are not re-planned", async () => {
    const plan = JSON.stringify({
      units: [{ description: "New unit", declaredPaths: ["src/b.ts"], declaredModules: ["b"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "Implement auth", description: "Add login + signup" },
      model: "reasoning-strong",
      reason: "scrutiny failed",
      completedUnitSummaries: [
        { description: "Login endpoint", declaredPaths: ["src/auth/login.ts"], declaredModules: ["auth"] },
      ],
    });

    const userMessage = (pinyx.chat as any).mock.calls[0][0].messages.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Already Completed Units");
    expect(userMessage).toContain("Login endpoint");
  });

  it("includes research findings in the rescope prompt when provided", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();

    const findings: ResearchFinding[] = [
      { id: "f-1", missionId: "m-1", authorId: "research-1", domain: ["auth"], title: "Auth middleware pattern", content: "Uses JWT with refresh tokens", relevance: "high", status: "unverified", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
    ];

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "Implement auth", description: "Add login + signup" },
      model: "reasoning-strong",
      reason: "scrutiny failed",
      researchFindings: findings,
    });

    const userMessage = (pinyx.chat as any).mock.calls[0][0].messages.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Research Findings");
    expect(userMessage).toContain("Auth middleware pattern");
  });

  it("uses the enriched system prompt with analysis instructions", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    const systemMessage = (pinyx.chat as any).mock.calls[0][0].messages.find((m: any) => m.role === "system").content;
    expect(systemMessage).toContain("WHY the previous plan failed");
    expect(systemMessage).toContain("Do NOT re-plan units that have already been successfully completed");
  });

  it("supersedes the latest un-superseded contract before creating new units (append-only invariant)", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();
    const carriedContent = { criteria: ["auth works"], testCommands: ["npm test"], acceptanceBehavior: "auth works" };
    (lapis.getContractHistory as any).mockResolvedValue([
      { id: "c-1", milestoneId: "ms-1", version: 1, content: carriedContent, supersedes: null, supersededBy: null, rescopeEventId: null, createdAt: "" },
    ]);

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "Implement auth", description: "Add login + signup" },
      model: "reasoning-strong",
      reason: "scrutiny failed",
    });

    // Supersede happens before unit creation.
    expect(lapis.supersedeContract).toHaveBeenCalledTimes(1);
    expect(lapis.supersedeContract).toHaveBeenCalledWith(
      "c-1",
      { content: carriedContent },
      expect.objectContaining({
        milestoneId: "ms-1",
        contractId: "c-1",
        reason: expect.stringContaining("Rescope re-planning milestone Implement auth"),
      }),
    );
    expect(lapis.createWorkingUnit).toHaveBeenCalledTimes(1);
  });

  it("does not supersede when there is no un-superseded contract", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();
    (lapis.getContractHistory as any).mockResolvedValue([
      { id: "c-1", milestoneId: "ms-1", version: 1, content: {}, supersedes: null, supersededBy: "c-2", rescopeEventId: null, createdAt: "" },
    ]);

    await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    expect(lapis.supersedeContract).not.toHaveBeenCalled();
    expect(lapis.createWorkingUnit).toHaveBeenCalledTimes(1);
  });

  it("still creates units when contract history fetch fails (non-regressing best-effort)", async () => {
    const plan = JSON.stringify({
      units: [{ description: "Fixed unit", declaredPaths: ["src/a.ts"], declaredModules: ["a"] }],
    });
    const pinyx = makePinyx(plan);
    const lapis = makeLapis();
    (lapis.getContractHistory as any).mockRejectedValue(new Error("LaPis down"));

    const result = await rescopeMilestone({
      pinyx,
      lapis,
      mission: makeMission(),
      milestone: { id: "ms-1", title: "M", description: "D" },
      model: "reasoning-strong",
      reason: "x",
    });

    expect(result.ok).toBe(true);
    expect(lapis.createWorkingUnit).toHaveBeenCalledTimes(1);
  });
});
