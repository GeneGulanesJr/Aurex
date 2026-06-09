import type { CheckpointTrigger, Milestone, Mission } from "@aurex/shared";
import type { EscalationTrigger, EscalationContext } from "@aurex/shared";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { EventBus } from "../ws/events.js";
import type { CheckpointManager } from "./checkpoint-manager.js";
import type { MilestoneLoopResult } from "./milestone-loop.js";
import { rescopeMilestone } from "./rescope.js";

export interface CheckpointLoopDeps {
  checkpointManager: CheckpointManager;
  lapis: LaPisClient;
  pinyx: PinyxClient;
  eventBus: EventBus;
  setStatus: (state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed", missionId?: string | null) => void;
}

export interface CheckpointLoopParams {
  missionId: string;
  mission: Mission;
  milestones: Milestone[];
  signal?: AbortSignal;
  costCapApproved: boolean;
}

export interface CheckpointLoopResult {
  status: "completed" | "failed";
  milestones: Milestone[];
  costCapApproved: boolean;
}

/**
 * Shared checkpoint resolution loop. Handles:
 * - Human approval/rejection of checkpoints
 * - User-initiated rescope with guidance
 * - Milestone completion tracking
 * - Cost cap approval
 *
 * Returns the final state after the loop exits (completed or failed).
 */
export async function runCheckpointLoop(
  loop: { run(mission: Mission, milestones: Milestone[], signal?: AbortSignal): Promise<MilestoneLoopResult> },
  params: CheckpointLoopParams,
  deps: CheckpointLoopDeps,
): Promise<CheckpointLoopResult> {
  const { missionId, mission, milestones, signal, costCapApproved: initialCostCap } = params;
  const { checkpointManager, lapis, pinyx, eventBus, setStatus } = deps;

  let currentMilestones = milestones;
  let costCapApproved = initialCostCap;

  let loopResult = await loop.run(mission, currentMilestones, signal);

  while (loopResult.status === "checkpoint_needed") {
    const cp = loopResult; // TS narrowing: only checkpoint_needed has trigger/milestoneId/summary

    if (signal?.aborted) {
      await lapis.updateMissionStatus(missionId, "aborted");
      eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
      return { status: "failed", milestones: currentMilestones, costCapApproved };
    }

    setStatus("waiting_checkpoint", missionId);
    await lapis.updateMissionStatus(missionId, "paused");
    eventBus.emit({ type: "mission_status", missionId, status: "paused" });

    const checkpointId = await checkpointManager.create({
      missionId,
      trigger: cp.trigger,
      milestoneId: cp.milestoneId,
      summary: cp.summary,
    });

    eventBus.emit({
      type: "escalation",
      missionId,
      checkpointId,
      trigger: { kind: cp.trigger, milestoneId: cp.milestoneId } as EscalationTrigger,
      context: { summary: cp.summary } as EscalationContext,
    });

    const resolved = await checkpointManager.waitForResolution(checkpointId);

    if (resolved.decision === "reject") {
      await lapis.updateMissionStatus(missionId, "aborted");
      eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
      return { status: "failed", milestones: currentMilestones, costCapApproved };
    }

    // User-initiated re-plan: triggered when the user approves AND provides
    // rescopeGuidance in the request body.
    if (resolved.rescopeGuidance) {
      const rescopeTarget = currentMilestones.find((ms) => ms.id === cp.milestoneId);
      if (rescopeTarget) {
        eventBus.emit({ type: "mission_log", missionId, phase: "rescope", message: `Re-planning milestone "${rescopeTarget.title}" after user rescope` });
        const [rescopeVerdicts, rescopeFindings, rescopeUnits] = await Promise.all([
          lapis.getVerdicts(rescopeTarget.id).catch(() => []),
          lapis.getFindings(missionId).catch(() => []),
          lapis.getWorkingUnitsForMilestone(rescopeTarget.id).catch(() => [] as import("@aurex/shared").WorkingUnit[]),
        ]);
        const rescopeCompletedSummaries = rescopeUnits
          .filter((u) => u.status === "completed")
          .map((u) => ({ description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules }));
        const result = await rescopeMilestone({
          pinyx,
          lapis,
          mission,
          milestone: { id: rescopeTarget.id, title: rescopeTarget.title, description: rescopeTarget.description },
          model: mission.configJson.modelHints.orchestrator,
          reason: resolved.rescopeGuidance,
          verdicts: rescopeVerdicts,
          researchFindings: rescopeFindings,
          completedUnitSummaries: rescopeCompletedSummaries,
        });
        if (!result.ok) {
          const msg = result.error === "pinyx_threw" ? result.message : `Rescope re-planning failed: ${result.content}`;
          eventBus.emit({ type: "mission_error", missionId, code: "rescope_failed", message: msg, recoverable: false });
          await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
          eventBus.emit({ type: "mission_status", missionId, status: "failed" });
          return { status: "failed", milestones: currentMilestones, costCapApproved };
        }
        eventBus.emit({ type: "milestone_progress", milestoneId: cp.milestoneId, status: "rescoping", completedUnits: 0, totalUnits: result.units.length });
      }
    }

    if (cp.trigger === "milestone_complete") {
      await lapis.updateMilestoneStatus(cp.milestoneId, "completed");
      currentMilestones = currentMilestones.map((ms) =>
        ms.id === cp.milestoneId ? { ...ms, status: "completed" as const } : ms,
      );
      eventBus.emit({ type: "milestones_set", missionId, milestones: currentMilestones });
    }
    if (cp.trigger === "cost_cap_exceeded") {
      costCapApproved = true;
    }

    await lapis.updateMissionStatus(missionId, "running");
    setStatus("executing", missionId);
    eventBus.emit({ type: "mission_status", missionId, status: "running" });

    const baseMission = await lapis.getMission(missionId);
    const next = costCapApproved
      ? { ...baseMission, configJson: { ...baseMission.configJson, costCap: 0 } }
      : baseMission;
    loopResult = await loop.run(next, currentMilestones, signal);
  }

  if (loopResult.status === "failed") {
    await lapis.updateMissionStatus(missionId, "failed");
    eventBus.emit({ type: "mission_status", missionId, status: "failed" });
    return { status: "failed", milestones: currentMilestones, costCapApproved };
  }

  await lapis.updateMissionStatus(missionId, "completed");
  eventBus.emit({ type: "mission_status", missionId, status: "completed" });
  return { status: "completed", milestones: currentMilestones, costCapApproved };
}
