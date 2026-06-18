import { describe, it, expect, vi } from "vitest";
import { optimizeMissionPrompt } from "../src/orchestrator/prompt-optimizer";
import { QuotaExhaustedError } from "../src/clients/pinyx-quota-wrapper";
import type { PinyxClient } from "../src/clients/pinyx-client";

function makePinyx(content: string): PinyxClient {
  return {
    chat: vi.fn().mockResolvedValue({ content, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    ping: vi.fn(),
  } as unknown as PinyxClient;
}

describe("optimizeMissionPrompt", () => {
  it("returns the PiNyx-refined description on success", async () => {
    const pinyx = makePinyx("## Goal\nShip auth\n## Scope\n- login\n## Constraints\n- TS");
    const result = await optimizeMissionPrompt(pinyx, "build auth", { model: "m", eventBus: undefined, missionId: "m-1" });
    expect(result).toBe("## Goal\nShip auth\n## Scope\n- login\n## Constraints\n- TS");
  });

  it("strips markdown code fences and preamble labels", async () => {
    const pinyx = makePinyx("```markdown\nRefined mission description:\n## Goal\nX\n```");
    const result = await optimizeMissionPrompt(pinyx, "x", { model: "m" });
    expect(result).toBe("## Goal\nX");
  });

  it("strips <think>...</think> blocks some models prepend", async () => {
    const pinyx = makePinyx("<think>internal reasoning</think>## Goal\nX");
    const result = await optimizeMissionPrompt(pinyx, "x", { model: "m" });
    expect(result).toBe("## Goal\nX");
  });

  it("strips a chatty preamble before the first Markdown heading", async () => {
    const pinyx = makePinyx("Sure! Here is the refined mission description:\n\n## Goal\nShip auth");
    const result = await optimizeMissionPrompt(pinyx, "x", { model: "m" });
    expect(result).toBe("## Goal\nShip auth");
  });

  it("strips a 'Here is…' preamble when the brief has no headings", async () => {
    const pinyx = makePinyx("Here is the refined version:\nBuild the thing.");
    const result = await optimizeMissionPrompt(pinyx, "x", { model: "m" });
    expect(result).toBe("Build the thing.");
  });

  it("preserves a heading that starts at offset 0 (no preamble)", async () => {
    const pinyx = makePinyx("## Goal\nX");
    const result = await optimizeMissionPrompt(pinyx, "x", { model: "m" });
    expect(result).toBe("## Goal\nX");
  });

  it("falls back to the original description on PiNyx error", async () => {
    const pinyx = { chat: vi.fn().mockRejectedValue(new Error("quota exhausted")) } as unknown as PinyxClient;
    const result = await optimizeMissionPrompt(pinyx, "original", { model: "m" });
    expect(result).toBe("original");
  });

  it("re-throws QuotaExhaustedError instead of swallowing it", async () => {
    // A quota-exhaustion signal must propagate so mission-runner pauses for
    // quota recovery, rather than degrading to the raw description and then
    // failing on the subsequent planner call.
    const quotaError = new QuotaExhaustedError("prov-1", new Date(Date.now() + 3600_000).toISOString());
    const pinyx = { chat: vi.fn().mockRejectedValue(quotaError) } as unknown as PinyxClient;
    await expect(optimizeMissionPrompt(pinyx, "original", { model: "m" })).rejects.toBe(quotaError);
  });

  it("falls back to the original description on empty refinement", async () => {
    const pinyx = makePinyx("   \n  ");
    const result = await optimizeMissionPrompt(pinyx, "original", { model: "m" });
    expect(result).toBe("original");
  });

  it("returns the original description for an empty input", async () => {
    const pinyx = makePinyx("anything");
    const result = await optimizeMissionPrompt(pinyx, "", { model: "m" });
    expect(result).toBe("");
    expect((pinyx.chat as any).mock.calls.length).toBe(0);
  });

  it("emits a mission_log on success and mission_error on failure", async () => {
    const emitted: any[] = [];
    const eventBus = { emit: (e: any) => emitted.push(e) } as any;
    const pinyx = makePinyx("## Goal\nX");
    await optimizeMissionPrompt(pinyx, "build x", { model: "m", eventBus, missionId: "m-1" });
    expect(emitted.some((e) => e.type === "mission_log" && e.phase === "planning")).toBe(true);
  });
});
