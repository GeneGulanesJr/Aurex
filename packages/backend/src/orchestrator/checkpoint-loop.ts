import type { CheckpointTrigger, Milestone, Mission, ResearchFinding, ValidationVerdict, WorkingUnit } from "@aurex/shared";
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
  setStatus: (state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed" | "aborted", missionId?: string | null) => void;
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

    const resolved = await checkpointManager.waitForResolution(checkpointId, signal);

    if (resolved.decision === "reject") {
      await lapis.updateMissionStatus(missionId, "aborted");
      eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
      return { status: "failed", milestones: currentMilestones, costCapApproved };
    }

    // User-initiated re-plan: triggered when the user approves AND provides
    // rescopeGuidance in the request body. Only allowed for failure/recovery
    // checkpoints — not milestone_complete (which would supersede validated work).
    const rescopeTriggers = new Set<CheckpointTrigger>([
      "validation_failed",
      "rescope_limit",
      "unclassifiable_error",
      "cost_cap_exceeded",
      "quota_exhausted",
    ]);
    if (resolved.rescopeGuidance && rescopeTriggers.has(cp.trigger)) {
      const rescopeTarget = currentMilestones.find((ms) => ms.id === cp.milestoneId);
      if (rescopeTarget) {
        eventBus.emit({ type: "mission_log", missionId, phase: "rescope", message: `Re-planning milestone "${rescopeTarget.title}" after user rescope` });
        const [rescopeVerdicts, rescopeFindings, rescopeUnits] = await Promise.all([
          fetchWithMissionError(
            missionId,
            cp.milestoneId,
            "rescope_verdicts_fetch_failed",
            "Could not load validator verdicts for rescope",
            () => lapis.getVerdicts(rescopeTarget.id),
            [] as ValidationVerdict[],
            eventBus,
          ),
          fetchWithMissionError(
            missionId,
            cp.milestoneId,
            "rescope_findings_fetch_failed",
            "Could not load research findings for rescope",
            () => lapis.getFindings(missionId),
            [] as ResearchFinding[],
            eventBus,
          ),
          fetchWithMissionError(
            missionId,
            cp.milestoneId,
            "rescope_units_fetch_failed",
            "Could not load working units for rescope",
            () => lapis.getWorkingUnitsForMilestone(rescopeTarget.id),
            [] as WorkingUnit[],
            eventBus,
          ),
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
        const replacedUnits = rescopeUnits.filter((unit) => unit.status !== "completed");
        for (const unit of replacedUnits) {
          await lapis.updateWorkingUnitStatus(unit.id, "superseded");
        }
        if (replacedUnits.length > 0) {
          eventBus.emit({
            type: "mission_log",
            missionId,
            phase: "rescope",
            message: `Superseded ${replacedUnits.length} incomplete unit(s) replaced by the new rescope plan.`,
            data: { supersededUnitIds: replacedUnits.map((unit) => unit.id) },
          });
        }
        eventBus.emit({ type: "milestone_progress", milestoneId: cp.milestoneId, status: "rescoping", completedUnits: 0, totalUnits: result.units.length });
      }
    } else if (cp.trigger === "validation_failed" || cp.trigger === "rescope_limit") {
      // "Continue without rescope" recovery: only allowed when the failure
      // is a validation outcome (validation_failed) or the rescope pipeline
      // couldn't make progress (rescope_limit). For unclassifiable_error the
      // cause is a runtime/compliance failure (validator produced no verdict,
      // worker crashed, integration aborted) — silently re-running is unsafe
      // because the failure mode is unlikely to change without a re-plan.
      const units = await fetchWithMissionError(
        missionId,
        cp.milestoneId,
        "checkpoint_units_fetch_failed",
        "Could not load working units for checkpoint recovery",
        () => lapis.getWorkingUnitsForMilestone(cp.milestoneId),
        [] as WorkingUnit[],
        eventBus,
      );
      const verdicts = await fetchWithMissionError(
        missionId,
        cp.milestoneId,
        "checkpoint_verdicts_fetch_failed",
        "Could not load validator verdicts for checkpoint recovery",
        () => lapis.getVerdicts(cp.milestoneId),
        [] as ValidationVerdict[],
        eventBus,
      );
      const failedUnitIds = new Set(
        verdicts
          .filter((v) => v.verdict === "fail")
          .flatMap((v) => Array.isArray(v.failedUnitIds) ? v.failedUnitIds : []),
      );

      // If we have no signal at all (no verdicts, or verdicts fetch failed
      // silently), do NOT auto-retry. The checkpoint should fall through to
      // the user picking Rescope/Abort — silently resetting completed units
      // would redo finished work with no new information.
      if (failedUnitIds.size === 0 && verdicts.length === 0) {
        eventBus.emit({
          type: "mission_log",
          missionId,
          phase: "checkpoint",
          message: "No validator verdicts available to determine retryable units. Awaiting human direction (Rescope or Abort).",
          data: { guidance: resolved.guidance ?? null, retriedUnitIds: [] },
        });
      } else {
        const unitsToRetry = failedUnitIds.size > 0
          ? units.filter((u) => failedUnitIds.has(u.id))
          : units.filter((u) => u.status === "completed" || u.status === "failed" || u.status === "timed_out");

        for (const unit of unitsToRetry) {
          await lapis.updateWorkingUnitStatus(unit.id, "planned");
        }
        await lapis.updateMilestoneStatus(cp.milestoneId, "in_progress").catch(() => {});
        eventBus.emit({
          type: "mission_log",
          missionId,
          phase: "checkpoint",
          message: unitsToRetry.length > 0
            ? `Continuing milestone without rescope; queued ${unitsToRetry.length} unit(s) for another work attempt.`
            : "Continuing milestone without rescope; rerunning validation on current work.",
          data: { guidance: resolved.guidance ?? null, retriedUnitIds: unitsToRetry.map((u) => u.id) },
        });
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

async function fetchWithMissionError<T>(
  missionId: string,
  milestoneId: string,
  code: string,
  context: string,
  fetcher: () => Promise<T>,
  fallback: T,
  eventBus: CheckpointLoopDeps["eventBus"],
): Promise<T> {
  try {
    return await fetcher();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    eventBus.emit({
      type: "mission_error",
      missionId,
      code,
      message: `${context}: ${msg}`,
      milestoneId,
      recoverable: true,
      details: { error: msg },
    });
    return fallback;
  }
}
