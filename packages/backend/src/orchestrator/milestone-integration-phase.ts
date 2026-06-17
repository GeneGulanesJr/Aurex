import type { CompressionTrigger, WorkingUnit } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { IntegrationLifecycleResult } from "./integration-lifecycle.js";
import { createIntegrationLifecycle } from "./integration-lifecycle.js";
import type { WorktreeManager } from "./worktree.js";
import { markMergedTodos, reconcileMissionLedger } from "./ledger-reconciler.js";
import type { MilestoneLoopCallbacks } from "./milestone-loop.js";

export interface IntegrationPhaseInput {
  missionId: string;
  milestoneId: string;
  milestoneOrderIndex: number;
  baseBranch: string;
  integrationUnits: WorkingUnit[];
  testCommands: string[];
  repoRoot: string;
  onPostMilestoneScan?: (missionId: string, root: string) => Promise<void>;
  onCompression?: (missionId: string, trigger: CompressionTrigger) => Promise<unknown>;
  /** Optional pre-merged branch forwarded into the integration lifecycle. */
  preMergedBaseBranch?: string;
}

export interface IntegrationPhaseSuccess {
  ok: true;
  integration: IntegrationLifecycleResult;
}

export interface IntegrationPhaseFailure {
  ok: false;
  trigger: "unclassifiable_error";
  summary: string;
  phase: "integration" | "integration_tests";
  errorCode: "integration_failed" | "integration_tests_failed";
}

export type IntegrationPhaseResult = IntegrationPhaseSuccess | IntegrationPhaseFailure;

export async function runIntegrationPhase(
  lapis: LaPisClient,
  worktreeManager: WorktreeManager,
  callbacks: Pick<MilestoneLoopCallbacks, "onError" | "onEscalation">,
  input: IntegrationPhaseInput,
): Promise<IntegrationPhaseResult> {
  const integrationLifecycle = createIntegrationLifecycle(worktreeManager);

  let integration: IntegrationLifecycleResult;
  try {
    integration = await integrationLifecycle.integrate({
      missionId: input.missionId,
      milestoneId: input.milestoneId,
      milestoneOrderIndex: input.milestoneOrderIndex,
      baseBranch: input.baseBranch,
      units: input.integrationUnits,
      testCommands: input.testCommands,
      ...(input.preMergedBaseBranch ? { preMergedBaseBranch: input.preMergedBaseBranch } : {}),
    });
    const mergedIntegrationUnits = input.integrationUnits.filter(
      (u) => integration.mergedBranches.includes(u.taskBranch),
    );
    await markMergedTodos(lapis, {
      missionId: input.missionId,
      units: mergedIntegrationUnits,
      sourceBranches: integration.mergedBranches,
      targetBranch: integration.integrationBranch,
      reason: "integration branch merge completed after validation pass",
    });
    await reconcileMissionLedger(lapis, {
      missionId: input.missionId,
      milestoneId: input.milestoneId,
      reason: "integration merge completed",
      actorId: "orchestrator",
    });
  } catch (error) {
    const summary = `Integration failed after validation pass: ${error instanceof Error ? error.message : String(error)}`;
    callbacks.onError(input.missionId, "integration_failed", summary, {
      milestoneId: input.milestoneId,
      recoverable: false,
      details: { phase: "integration" },
    });
    return {
      ok: false,
      trigger: "unclassifiable_error",
      summary,
      phase: "integration",
      errorCode: "integration_failed",
    };
  }

  if (integration.testFailure) {
    const summary = `Integration branch tests failed:\n${integration.testFailure.slice(0, 500)}`;
    callbacks.onError(input.missionId, "integration_tests_failed", summary, {
      milestoneId: input.milestoneId,
      recoverable: false,
      details: { phase: "integration_tests" },
    });
    return {
      ok: false,
      trigger: "unclassifiable_error",
      summary,
      phase: "integration_tests",
      errorCode: "integration_tests_failed",
    };
  }

  if (input.onPostMilestoneScan) {
    try {
      await input.onPostMilestoneScan(input.missionId, input.repoRoot);
    } catch (err) {
      console.warn(`[bumblebee] Post-milestone scan failed for mission ${input.missionId}:`, err instanceof Error ? err.message : err);
    }
  }

  return { ok: true, integration };
}

export async function finalizeMilestoneRelease(
  lapis: LaPisClient,
  callbacks: Pick<MilestoneLoopCallbacks, "onEscalation">,
  input: {
    missionId: string;
    milestoneId: string;
    milestoneTitle: string;
    integration: IntegrationLifecycleResult;
    onCompression?: (missionId: string, trigger: CompressionTrigger) => Promise<unknown>;
  },
): Promise<{ trigger: "milestone_complete"; summary: string }> {
  callbacks.onEscalation(
    input.missionId,
    { kind: "milestone_complete", milestoneId: input.milestoneId, releaseBranch: input.integration.releaseBranch },
    input.integration,
  );

  const compressionTrigger: CompressionTrigger = "post_milestone";
  if (input.onCompression) {
    await input.onCompression(input.missionId, compressionTrigger);
  } else {
    await lapis.runCompression(input.missionId, compressionTrigger);
  }

  return {
    trigger: "milestone_complete",
    summary: `Milestone "${input.milestoneTitle}" passed validation. Release branch: ${input.integration.releaseBranch}`,
  };
}
