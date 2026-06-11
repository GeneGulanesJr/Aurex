import type { CheckpointTrigger, CompressionTrigger, Mission, Milestone, WorkingUnit, WorkerStatus, EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, ResearchFinding } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import { createNegotiator } from "./negotiator.js";
import { createWorktreeManager, type CreateValidatorWorktreeResult } from "./worktree.js";
import { createAgentSpawner, TOOL_CALL_CAP_EXCEEDED, type SpawnResult, type SpawnHandle } from "../agents/agent-spawner.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import type { EventBus } from "../ws/events.js";
import { buildValidatorContext, buildWorkerContext, buildResearchContext, type ValidatorUnitContext } from "../agents/context-builder.js";
import { createIntegrationLifecycle } from "./integration-lifecycle.js";
import { validateHandoff } from "../enforcement/handoff-validator.js";
import { checkPreSpawnOverlap } from "./overlap.js";
import { rescopeMilestone } from "./rescope.js";
import {
  applyValidatorVerdictsToTodos,
  markMergedTodos,
  markWorkerTodoProgress,
  reconcileMissionLedger,
} from "./ledger-reconciler.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Auto-rescope is disabled by default (0). When enabled, the milestone loop
// will automatically re-plan via Pinyx after exhausting validator retries.
// When disabled (0), the loop escalates to the user after retries, giving
// the human direct control over whether to rescope, retry, or abort.
const AUTO_RESCOPE_BATCH_LIMIT = 0;

/** Max workers spawned concurrently within a single batch. Keeps API concurrency within model limits. */
const MAX_CONCURRENT_WORKERS = 3;

export type MilestoneLoopResult =
  | { status: "completed" }
  | { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string }
  | { status: "failed"; reason: string };

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: EscalationTrigger, context: EscalationContext) => void;
  onAgentStatus: (agentId: string, agentType: AgentType, status: AgentStatus, milestoneId: string, workerSnapshot?: { declaredPaths: string[]; declaredModules: string[]; taskBranch: string; worktreePath: string; sessionId: string; description: string }) => void;
  onMilestoneProgress: (milestoneId: string, status: MilestoneStatus | string, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
  onError: (missionId: string, code: string, message: string, opts?: { workerId?: string; milestoneId?: string; recoverable: boolean; details?: Record<string, unknown> }) => void;
}

export interface MilestoneLoopConfig {
  agentDir: string;
  repoRoot: string;
  aurexRoot: string;
  gitMainBranch: string;
  eventBus: EventBus;
  logger?: AgentLogger;
  onCompression?: (missionId: string, trigger: CompressionTrigger) => Promise<unknown>;
  onPostMilestoneScan?: (missionId: string, root: string) => Promise<void>;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
  loopConfig: MilestoneLoopConfig,
) {
  const worktreeManager = createWorktreeManager(loopConfig.repoRoot);
  const integrationLifecycle = createIntegrationLifecycle(worktreeManager);
  let cumulativeCost = 0;
  const runtimeUnitsByMilestone = new Map<string, Map<string, WorkingUnit>>();
  const spawner = createAgentSpawner({
    lapis,
    agentDir: loopConfig.agentDir,
    defaultTimeout: 180_000,
    logger: loopConfig.logger,
    eventBus: loopConfig.eventBus,
    onCost: (missionId, totalCost, totalTokens, delta) => {
      cumulativeCost = totalCost;
      callbacks.onCostUpdate(missionId, totalCost, totalTokens, delta);
    },
  });

  return {
    async run(mission: Mission, milestones: Milestone[], signal?: AbortSignal): Promise<MilestoneLoopResult> {
      const config = mission.configJson;
      const negotiator = createNegotiator(lapis);

      // Set up abort listener to cancel active agent handles
      const activeHandles = new Set<{ abort: () => void }>();
      const abortListener = () => {
        for (const handle of activeHandles) handle.abort();
      };
      signal?.addEventListener("abort", abortListener, { once: true });

      try {
      function throwIfAborted() {
        if (signal?.aborted) throw new Error("Mission aborted");
      }

      for (const milestone of milestones) {
        if (milestone.status === "completed") continue;
        throwIfAborted();

        // Update milestone status
        await lapis.updateMilestoneStatus(milestone.id, "in_progress");
        // Reset stagnation detector for this milestone
        negotiator.resetStagnation();
        callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);
        await reconcileMissionLedger(lapis, {
          missionId: mission.id,
          milestoneId: milestone.id,
          reason: "milestone started",
          actorId: "orchestrator",
        });

        // --- WORKER + VALIDATION + NEGOTIATION LOOP ---
        // Retries re-spawn failed workers and re-validate.
        // Rescopes re-plan the milestone via PiNyx and start fresh.
        let loopActive = true;
        let researchFindings: ResearchFinding[] = await lapis.getFindings(mission.id).catch(() => [] as ResearchFinding[]);
        let hasRetriedFailedUnits = false;
        let preResearchAttempted = false;
        let hasResetIncompleteUnits = false;
        while (loopActive) {
          loopActive = false;

          // Fetch current units (may change after rescope)
          const fetchedUnits = await lapis.getWorkingUnitsForMilestone(milestone.id).catch(() => [] as import("@aurex/shared").WorkingUnit[]);
          const normalizedFetchedUnits = fetchedUnits.map(normalizeWorkingUnitForLoop);
          const runtimeUnits = runtimeUnitsByMilestone.get(milestone.id);
          const unitsWithRuntime = runtimeUnits
            ? normalizedFetchedUnits.map((unit) => {
                const runtime = runtimeUnits.get(unit.id);
                return runtime
                  ? {
                      ...unit,
                      taskBranch: unit.taskBranch || runtime.taskBranch,
                      worktreePath: unit.worktreePath || runtime.worktreePath,
                      sessionId: unit.sessionId || runtime.sessionId,
                  }
                  : unit;
              })
            : normalizedFetchedUnits;
          const units = unitsWithRuntime.map((unit) =>
            applyWorkingUnitScopeFallback(unit, mission, milestone, loopConfig.repoRoot),
          );
          const contracts = await lapis.getContractHistory(milestone.id).catch(() => [] as any[]);
          const contract = contracts[0] as any;

          let completedCount = 0;
          let failedCount = 0;
          const failedUnitIds: string[] = [];
          const integrationUnits: WorkingUnit[] = [];
          const validatorUnits: ValidatorUnitContext[] = [];

          // --- PRE-WORKER RESEARCH ---
          // If no prior research findings exist (first milestone or first
          // loop iteration after a rescope), run research BEFORE workers
          // so they benefit from domain knowledge.
          if (researchFindings.length === 0 && !preResearchAttempted) {
            preResearchAttempted = true;
            const preResearchPaths = units.flatMap((u: WorkingUnit) => u.declaredPaths);
            const preResearchModules = [...new Set(units.flatMap((u: WorkingUnit) => u.declaredModules))];
            const preResearchId = `research-${milestone.id}`;
            const preResearchContext = buildResearchContext({
              missionDescription: mission.description,
              milestoneTitle: milestone.title,
              milestoneDescription: milestone.description,
              unitDescriptions: units.map((u: WorkingUnit) => u.description),
              declaredPaths: preResearchPaths,
              declaredModules: preResearchModules,
            });

            callbacks.onAgentStatus(preResearchId, "research", "spawned", milestone.id);
            const preResearchHandle = await spawner.spawn({
              agentType: "research",
              agentId: preResearchId,
              missionId: mission.id,
              milestoneId: milestone.id,
              cwd: loopConfig.repoRoot,
              skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/research.md`,
              contextContent: preResearchContext,
              taskPrompt: `Research domain knowledge for milestone "${milestone.title}" BEFORE workers begin. Investigate the codebase areas relevant to the declared paths and modules. Submit findings using write_finding.`,
              timeout: config.workerTimeouts.testHeavy,
              model: config.modelHints.research,
            });
            activeHandles.add(preResearchHandle);

            callbacks.onAgentStatus(preResearchId, "research", "researching", milestone.id);
            const preResearchResult = await preResearchHandle.completed;
            activeHandles.delete(preResearchHandle);
            callbacks.onAgentStatus(
              preResearchId,
              "research",
              preResearchResult.status === "completed" ? "completed" : preResearchResult.status,
              milestone.id,
            );
            preResearchHandle.dispose();

            researchFindings = await lapis.getFindings(mission.id).catch(() => researchFindings);
          }

          // --- WORKER PHASE ---
          // Reset any transient-status units (spawned/working/committing) back to
          // planned. This handles re-entry after checkpoint/pause where workers
          // were interrupted mid-flight. Without this, the worker phase skips them
          // (it only picks up "planned") and validation incorrectly fails.
          const transientStatuses: WorkerStatus[] = ["spawned", "working", "committing"];
          const staleUnits = units.filter((u: WorkingUnit) => transientStatuses.includes(u.status));
          if (staleUnits.length > 0 && !hasResetIncompleteUnits) {
            hasResetIncompleteUnits = true;
            loopConfig.eventBus?.emit({
              type: "mission_log",
              missionId: mission.id,
              phase: "worker",
              message: `Resetting ${staleUnits.length} stale unit(s) (${staleUnits.map((u) => u.status).join(", ")}) back to planned`,
              data: { unitIds: staleUnits.map((u) => u.id) },
            });
            for (const u of staleUnits) {
              await lapis.updateWorkingUnitStatus(u.id, "planned");
            }
            // Re-fetch units to get the updated statuses
            const refreshed = await lapis.getWorkingUnitsForMilestone(milestone.id).catch(() => units);
            units.length = 0;
            units.push(...refreshed.map((unit: WorkingUnit) => applyWorkingUnitScopeFallback(unit, mission, milestone, loopConfig.repoRoot)));
          }

          const pendingUnits = units.filter((u: WorkingUnit) => u.status === "planned");
          const completedUnits = units.filter((u: WorkingUnit) => u.status === "completed");
          completedCount = completedUnits.length;
          integrationUnits.push(...completedUnits);
          validatorUnits.push(...completedUnits.map((u: WorkingUnit) => ({
            id: u.id, description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules, taskBranch: u.taskBranch, worktreePath: u.worktreePath,
          })));

          // Group pending units into non-overlapping batches using glob-aware overlap detection
          const batches: WorkingUnit[][] = [];
          const remaining = [...pendingUnits];
          while (remaining.length > 0) {
            const batch: WorkingUnit[] = [remaining.shift()!];
            let batchPaths = [...batch[0].declaredPaths];
            let batchModules = [...batch[0].declaredModules];
            for (let i = remaining.length - 1; i >= 0; i--) {
              const candidate = remaining[i];
              const overlap = checkPreSpawnOverlap(
                { declaredPaths: candidate.declaredPaths, declaredModules: candidate.declaredModules },
                batch.map((u) => ({ ...u, status: "spawned" as const })),
              );
              if (!overlap.overlap) {
                batch.push(candidate);
                batchPaths = [...batchPaths, ...candidate.declaredPaths];
                batchModules = [...batchModules, ...candidate.declaredModules];
                remaining.splice(i, 1);
              }
            }
            batches.push(batch);
          }

          // Process each batch, limiting concurrent workers to MAX_CONCURRENT_WORKERS
          for (const batch of batches) {
            const allHandles: Array<{ unit: WorkingUnit; agentId: string; worktreePath: string; taskBranch: string; handle: SpawnHandle }> = [];

            // Spawn in chunks to stay within concurrency limits
            for (let i = 0; i < batch.length; i += MAX_CONCURRENT_WORKERS) {
              const chunk = batch.slice(i, i + MAX_CONCURRENT_WORKERS);
              const handles = await Promise.all(chunk.map(async (unit) => {
              const agentId = `worker-${unit.id}`;
              const { worktreePath, taskBranch } = await worktreeManager.createWorktree(
                agentId, unit.id, loopConfig.gitMainBranch,
              );
              await worktreeManager.installBranchGuard(worktreePath, taskBranch);
              const workerTimeout = selectWorkerTimeout(unit, config.workerTimeouts, loopConfig.logger, mission.id, milestone.id);
              const contextContent = buildWorkerContext({
                missionDescription: mission.description,
                milestoneTitle: milestone.title,
                milestoneDescription: milestone.description,
                unitDescription: unit.description,
                unitDeclaredPaths: unit.declaredPaths,
                unitDeclaredModules: unit.declaredModules,
                contractCriteria: contract?.content?.criteria ?? [],
                testCommands: contract?.content?.testCommands ?? [],
                researchFindings,
              });

              callbacks.onAgentStatus(agentId, "worker", "spawned", milestone.id, {
                declaredPaths: unit.declaredPaths,
                declaredModules: unit.declaredModules,
                taskBranch,
                worktreePath,
                sessionId: "",
                description: unit.description,
              });
              await markWorkerTodoProgress(lapis, {
                missionId: mission.id,
                unit: { ...unit, taskBranch, worktreePath },
                workerId: agentId,
                status: "in_progress",
                reason: "worker spawned and claimed unit",
                branch: taskBranch,
                notes: [`Worker ${agentId} started in ${worktreePath}`],
              });
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "worker spawned",
                actorId: "orchestrator",
              });
              const handle = await spawner.spawn({
                agentType: "worker",
                agentId,
                unitId: unit.id,
                missionId: mission.id,
                milestoneId: milestone.id,
                cwd: worktreePath,
                skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/worker.md`,
                contextContent,
                taskPrompt: [
                  `Implement: ${unit.description}`,
                  "",
                  "Research findings from the research agent are in your context under 'Research Findings'. Use them directly. Do NOT re-read files already documented there.",
                  "",
                  "Follow your skill instructions carefully.",
                  "When useful work is committed, verification is blocked, or time is running short, call write_handoff immediately with partial/blocking details.",
                ].join("\n"),
                timeout: 0,
                model: config.modelHints.worker,
              });
              activeHandles.add(handle);

              callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);
                return { unit, agentId, worktreePath, taskBranch, handle };
              }));
              allHandles.push(...handles);
            }

            await Promise.all(allHandles.map(async ({ unit, agentId, worktreePath, taskBranch, handle }) => {
              const result = await handle.completed;
              activeHandles.delete(handle);
              if (result.status === "completed") {
                rememberRuntimeUnit(milestone.id, { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "completed" });
                await lapis.updateWorkingUnitStatus(unit.id, "completed");
                await markWorkerTodoProgress(lapis, {
                  missionId: mission.id,
                  unit: { ...unit, taskBranch, worktreePath },
                  workerId: agentId,
                  status: "implemented",
                  reason: "worker completed successfully",
                  branch: taskBranch,
                  notes: [`Worker ${agentId} completed unit ${unit.id}`],
                });
                callbacks.onAgentStatus(agentId, "worker", "completed", milestone.id);
                completedCount++;
                integrationUnits.push({ ...unit, taskBranch, worktreePath });
                validatorUnits.push({
                  id: unit.id, description: unit.description,
                  declaredPaths: unit.declaredPaths, declaredModules: unit.declaredModules,
                  taskBranch, worktreePath,
                });
              } else if (result.status === "timed_out") {
                rememberRuntimeUnit(milestone.id, { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "timed_out" });
                await lapis.updateWorkingUnitStatus(unit.id, "timed_out");
                await markWorkerTodoProgress(lapis, {
                  missionId: mission.id,
                  unit: { ...unit, taskBranch, worktreePath },
                  workerId: agentId,
                  status: "blocked",
                  reason: "worker timed out",
                  branch: taskBranch,
                  notes: [`Worker ${agentId} timed out before completing unit ${unit.id}`],
                });
                callbacks.onAgentStatus(agentId, "worker", "timed_out", milestone.id);
                callbacks.onError(mission.id, "worker_timeout", `Worker "${unit.description}" timed out`, { workerId: agentId, milestoneId: milestone.id, recoverable: true });
                failedCount++;
                failedUnitIds.push(unit.id);
              } else {
                rememberRuntimeUnit(milestone.id, { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "failed" });
                await lapis.updateWorkingUnitStatus(unit.id, "failed");
                await markWorkerTodoProgress(lapis, {
                  missionId: mission.id,
                  unit: { ...unit, taskBranch, worktreePath },
                  workerId: agentId,
                  status: "blocked",
                  reason: "worker failed",
                  branch: taskBranch,
                  notes: [`Worker ${agentId} failed unit ${unit.id}`],
                });
                callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
                callbacks.onError(mission.id, "worker_failed", `Worker "${unit.description}" failed`, { workerId: agentId, milestoneId: milestone.id, recoverable: true });
                failedCount++;
                failedUnitIds.push(unit.id);
              }
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: `worker ${result.status}`,
                actorId: "orchestrator",
              });
              handle.dispose();
            }));

            callbacks.onMilestoneProgress(milestone.id, "in_progress", completedCount, units.length);
          }

          if (failedCount > 0) {
            // Per-unit retry: re-spawn only the failed units once before
            // escalating the entire milestone. This avoids discarding
            // successful workers' work when only 1-2 units failed.
            const failedUnitIdsForRetry = failedUnitIds;
            if (failedUnitIdsForRetry.length > 0 && !hasRetriedFailedUnits) {
              hasRetriedFailedUnits = true;
              for (const uid of failedUnitIdsForRetry) {
                await lapis.updateWorkingUnitStatus(uid, "planned");
              }
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "per-unit retry: re-spawning failed workers",
                actorId: "orchestrator",
              });
              callbacks.onMilestoneProgress(milestone.id, "retrying", completedCount, units.length);
              loopActive = true;
              continue;
            }

            // Already retried once — escalate
            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "worker failure after retry",
              actorId: "orchestrator",
            });
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `${failedCount} worker unit(s) failed after retry`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // Cost cap check — pause if budget exceeded
          if (config.costCap > 0 && cumulativeCost >= config.costCap) {
            const trigger: CheckpointTrigger = "cost_cap_exceeded";
            const summary = `Mission cost cap exceeded: $${cumulativeCost.toFixed(2)} >= $${config.costCap.toFixed(2)}`;
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          const validatorUnitIds = new Set(validatorUnits.map((unit) => unit.id));
          const incompleteUnits = units.filter((unit: WorkingUnit) => !validatorUnitIds.has(unit.id));
          if (incompleteUnits.length > 0) {
            const transientStatuses: WorkerStatus[] = ["spawned", "working", "committing"];
            const allTransient = incompleteUnits.every((unit) => transientStatuses.includes(unit.status));
            if (allTransient && !hasResetIncompleteUnits) {
              hasResetIncompleteUnits = true;
              for (const unit of incompleteUnits) {
                await lapis.updateWorkingUnitStatus(unit.id, "planned");
              }
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "reset stale in-progress units before validation",
                actorId: "orchestrator",
              });
              loopConfig.eventBus?.emit({
                type: "mission_log",
                missionId: mission.id,
                phase: "validation",
                message: `Validation skipped: ${incompleteUnits.length} unit(s) were not completed. Resetting stale in-progress units to continue work.`,
                data: {
                  incompleteUnits: incompleteUnits.map((unit) => ({ id: unit.id, status: unit.status })),
                },
              });
              callbacks.onMilestoneProgress(milestone.id, "retrying", completedCount, units.length);
              loopActive = true;
              continue;
            }

            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `Validation skipped: ${incompleteUnits.length} unit(s) are not completed, so the validator will not run.`;
            callbacks.onError(mission.id, "validation_blocked_incomplete_units", summary, {
              milestoneId: milestone.id,
              recoverable: true,
              details: { incompleteUnits: incompleteUnits.map((unit) => ({ id: unit.id, status: unit.status })) },
            });
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id, error: summary }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // --- VALIDATOR PHASE ---
          const handoffs = await lapis.getHandoffsForMilestone(milestone.id).catch(() => [] as any[]);
          const handoffsByUnitId = new Map(handoffs.map((handoff: any) => [handoff.unitId, handoff]));
          for (const unit of validatorUnits) {
            unit.handoff = handoffsByUnitId.get(unit.id);
          }

          // Validate handoffs — fail units with missing or invalid handoffs.
          // A completed worker session is not enough evidence that useful work
          // happened; the handoff is the structured completion signal that
          // validators and integration depend on.
          const invalidHandoffUnitIds: string[] = [];
          for (const unit of validatorUnits) {
            let errors: string[];
            try {
              errors = unit.handoff
                ? validateHandoff(unit.handoff as any).errors
                : ["worker completed without submitting write_handoff"];
            } catch (err) {
              errors = [`handoff validation threw: ${err instanceof Error ? err.message : String(err)}`];
            }

            if (errors.length > 0) {
              console.warn(`[enforcement] Invalid handoff for unit ${unit.id}:`, errors);
              await lapis.updateWorkingUnitStatus(unit.id, "failed").catch(() => {});
              await markWorkerTodoProgress(lapis, {
                missionId: mission.id,
                unit: unit as WorkingUnit,
                workerId: "handoff-validator",
                status: "blocked",
                reason: `invalid worker handoff: ${errors.join("; ")}`,
                branch: unit.taskBranch,
                notes: errors,
              });
              callbacks.onError(mission.id, "worker_handoff_invalid", `Worker "${unit.description}" did not submit a valid handoff`, { workerId: `worker-${unit.id}`, milestoneId: milestone.id, recoverable: true, details: { errors } });
              invalidHandoffUnitIds.push(unit.id);
            }
          }
          if (invalidHandoffUnitIds.length > 0) {
            failedCount += invalidHandoffUnitIds.length;
            const unitsToRetry = validatorUnits.filter(u => invalidHandoffUnitIds.includes(u.id));
            const invalidSet = new Set(invalidHandoffUnitIds);
            for (let i = validatorUnits.length - 1; i >= 0; i--) {
              if (invalidSet.has(validatorUnits[i].id)) validatorUnits.splice(i, 1);
            }
            for (let i = integrationUnits.length - 1; i >= 0; i--) {
              if (invalidSet.has((integrationUnits[i] as WorkingUnit).id)) integrationUnits.splice(i, 1);
            }

            if (!hasRetriedFailedUnits) {
              hasRetriedFailedUnits = true;
              for (const unit of unitsToRetry) {
                if (unit.worktreePath) {
                  try {
                    await worktreeManager.pruneWorktree(unit.worktreePath);
                  } catch (err) {
                    console.warn(
                      `[retry] Failed to prune worktree ${unit.worktreePath} for unit ${unit.id}:`,
                      err instanceof Error ? err.message : err,
                    );
                  }
                }
              }
              for (const uid of invalidHandoffUnitIds) {
                await lapis.updateWorkingUnitStatus(uid, "planned");
              }
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "per-unit retry: re-spawning workers with missing or invalid handoffs",
                actorId: "orchestrator",
              });
              callbacks.onMilestoneProgress(milestone.id, "retrying", completedCount, units.length);
              loopActive = true;
              continue;
            }

            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "worker handoff failure after retry",
              actorId: "orchestrator",
            });
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `${invalidHandoffUnitIds.length} worker unit(s) failed to submit a valid handoff after retry`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          const contractContent = (contract as any)?.content ?? {};
          const contractId = (contract as any)?.id || milestone.validationContractId || "unknown-contract";
          const criteria = contractContent.criteria ?? [];
          const testCommands = contractContent.testCommands ?? [];
          const acceptanceBehavior = contractContent.acceptanceBehavior ?? "";

          await lapis.updateMilestoneStatus(milestone.id, "validating");
          callbacks.onMilestoneProgress(milestone.id, "validating", completedCount, units.length);
          await reconcileMissionLedger(lapis, {
            missionId: mission.id,
            milestoneId: milestone.id,
            reason: "validation started",
            actorId: "orchestrator",
          });

          const validatorTypes: Array<"validator_scrutiny" | "validator_user_testing"> = ["validator_scrutiny"];
          if (acceptanceBehavior.trim().length > 0 && acceptanceBehavior.trim().toLowerCase() !== "none") {
            validatorTypes.push("validator_user_testing");
          }

          // Collect git diff for all validator units against base branch.
          // Placed before the loop since the diff is the same for all validator types.
          let diffSummary = "";
          try {
            const diffParts: string[] = [];
            for (const vu of validatorUnits) {
              if (vu.taskBranch && vu.worktreePath) {
                try {
                  const { stdout } = await execFileAsync(
                    "git",
                    // Use HEAD instead of taskBranch — in worktrees HEAD is
                    // always the checked-out task branch, and this avoids
                    // branch-name edge cases.
                    ["-C", vu.worktreePath, "diff", `${loopConfig.gitMainBranch}...HEAD`, "--"],
                    { maxBuffer: 1024 * 1024 },
                  );
                  if (stdout.trim()) {
                    diffParts.push(`--- Unit: ${vu.id} (${vu.taskBranch}) ---\n${stdout}`);
                  }
                } catch {
                  // Branch may not exist or no diff available — skip
                }
              }
            }
            diffSummary = diffParts.join("\n\n");
          } catch {
            // Diff collection is best-effort
          }

          // Build a merged worktree once for all validator types so they
          // share the same on-disk post-worker state. The validator's
          // read/bash calls operate from this directory.
          let validatorWorktree: CreateValidatorWorktreeResult | null = null;
          try {
            validatorWorktree = await worktreeManager.createValidatorWorktree(
              milestone.id,
              loopConfig.gitMainBranch,
              validatorUnits.map((u) => u.taskBranch).filter(Boolean),
            );
          } catch (err) {
            // Merged worktree creation is best-effort. If it fails, the
            // validator falls back to the base repo cwd (legacy behavior)
            // and the diff in context is its only signal.
            console.warn(
              `[validator] Failed to create merged worktree for milestone ${milestone.id}:`,
              err instanceof Error ? err.message : err,
            );
          }
          const validatorCwd = validatorWorktree?.worktreePath ?? loopConfig.repoRoot;

          const validatorRuntimeFailures: string[] = [];
          const validatorRuntimeFailureTypes = new Set<"validator_scrutiny" | "validator_user_testing">();
          const validatorResults: Array<{
            validatorType: "validator_scrutiny" | "validator_user_testing";
            sessionId: string;
            result: SpawnResult;
          }> = [];
          const recordValidatorRuntimeFailure = (
            validatorType: "validator_scrutiny" | "validator_user_testing",
            message: string,
          ) => {
            if (validatorRuntimeFailureTypes.has(validatorType)) return;
            validatorRuntimeFailureTypes.add(validatorType);
            validatorRuntimeFailures.push(message);
          };
          const writeSyntheticValidatorVerdict = async (
            sessionId: string,
            validatorType: "validator_scrutiny" | "validator_user_testing",
            findings: string,
          ) => {
            try {
              await lapis.writeVerdict(sessionId, {
                milestoneId: milestone.id,
                contractId,
                validatorType,
                verdict: "fail",
                findings,
                failedUnitIds: [],
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              console.warn(`[milestone-loop] Failed to write synthetic validator verdict:`, err instanceof Error ? err.message : err);
            }
          };

          // Run all validator types concurrently — they share a read-only
          // merged worktree and don't modify state.
          await Promise.all(validatorTypes.map(async (validatorType) => {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({
              validatorType, missionDescription: mission.description,
              milestoneTitle: milestone.title, milestoneDescription: milestone.description,
              contractId, contractCriteria: criteria, testCommands, acceptanceBehavior,
              baseBranch: loopConfig.gitMainBranch, units: validatorUnits,
              researchFindings,
              diffSummary: diffSummary || undefined,
              validatorToolCallCap: config.validatorToolCallCap ?? 0,
              validatorWorktree: validatorWorktree
                ? {
                    path: validatorWorktree.worktreePath,
                    mergedBranches: validatorWorktree.mergedUnitIds,
                    conflictedBranches: validatorWorktree.conflictedBranches,
                  }
                : undefined,
            });

            callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
            const handle = await spawner.spawn({
              agentType: validatorType, agentId, missionId: mission.id, milestoneId: milestone.id,
              contractId, cwd: validatorCwd,
              skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/validator.md`,
              contextContent,
              taskPrompt: `Validate milestone "${milestone.title}" as ${validatorType}. Use write_verdict when done.`,
              timeout: config.workerTimeouts.testHeavy,
              model: config.modelHints[validatorType],
              validatorToolCallCap: config.validatorToolCallCap ?? 0,
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            validatorResults.push({ validatorType, sessionId: handle.sessionId, result });
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);

            // Handle validators that didn't write a verdict:
            // 1. Cap-exceeded: session was aborted by tool-call cap
            // 2. Timed out/failed/completed but no verdict: handled after
            // getVerdicts so a sibling validator's verdict cannot mask the
            // missing validator type.
            const isCapHit = result.status === "failed" && result.error?.includes(TOOL_CALL_CAP_EXCEEDED);
            if (isCapHit) {
              // Cap hit — model never had a chance to write verdict
              const findings = `Validator auto-failed: exceeded tool-call cap without producing a verdict. The model exhausted its configured tool-call budget.`;
              recordValidatorRuntimeFailure(validatorType, `${validatorType} exceeded the configured validator tool-call cap.`);
              await writeSyntheticValidatorVerdict(handle.sessionId, validatorType, findings);
            }

            handle.dispose();
          }));

          // Prune the merged validation worktree after all validators complete.
          // Stryker disable next-line StringLiteral: best-effort cleanup
          if (validatorWorktree) {
            try {
              await worktreeManager.pruneWorktree(validatorWorktree.worktreePath);
            } catch (err) {
              console.warn(
                `[validator] Failed to prune merged worktree ${validatorWorktree.worktreePath}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }

          // --- NEGOTIATION PHASE ---
          let verdicts = await lapis.getVerdicts(milestone.id).catch(() => [] as import("@aurex/shared").ValidationVerdict[]);

          // If any validator type finished without a verdict, write a
          // synthetic fail verdict for auditability and surface it as a
          // validator runtime/compliance checkpoint. This must be per type:
          // otherwise a user-testing verdict can mask a missing scrutiny
          // verdict and the negotiator reports "Missing scrutiny validator
          // verdict" as if it were an ordinary validation failure.
          let wroteSyntheticMissingVerdict = false;
          const verdictTypes = new Set(verdicts.map((v) => v.validatorType ?? "validator_scrutiny"));
          for (const validatorResult of validatorResults) {
            if (verdictTypes.has(validatorResult.validatorType)) continue;

            let findings: string;
            if (validatorResult.result.status === "timed_out") {
              findings = `Validator auto-failed: timed out before calling write_verdict. The model may have continued gathering context, but it did not submit a formal verdict before the validator timeout.`;
              recordValidatorRuntimeFailure(
                validatorResult.validatorType,
                `${validatorResult.validatorType} timed out before submitting write_verdict.`,
              );
            } else if (validatorResult.result.status === "failed" && validatorResult.result.error?.includes(TOOL_CALL_CAP_EXCEEDED)) {
              findings = `Validator auto-failed: exceeded tool-call cap without producing a verdict. The model exhausted its configured tool-call budget.`;
              recordValidatorRuntimeFailure(
                validatorResult.validatorType,
                `${validatorResult.validatorType} exceeded the configured validator tool-call cap.`,
              );
            } else if (validatorResult.result.status === "failed") {
              findings = `Validator auto-failed: session failed before calling write_verdict. Error: ${validatorResult.result.error ?? "unknown error"}.`;
              recordValidatorRuntimeFailure(
                validatorResult.validatorType,
                `${validatorResult.validatorType} failed before submitting write_verdict.`,
              );
            } else {
              findings = `Validator completed session without calling write_verdict. The model finished its review but did not submit a formal verdict. This is a model compliance issue — the validator skill instructs using write_verdict exactly once.`;
              recordValidatorRuntimeFailure(
                validatorResult.validatorType,
                `${validatorResult.validatorType} completed without submitting write_verdict.`,
              );
            }

            await writeSyntheticValidatorVerdict(validatorResult.sessionId, validatorResult.validatorType, findings);
            wroteSyntheticMissingVerdict = true;
          }

          if (wroteSyntheticMissingVerdict) {
            verdicts = await lapis.getVerdicts(milestone.id).catch(() => [] as import("@aurex/shared").ValidationVerdict[]);
          }

          if (validatorRuntimeFailures.length > 0) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = [
              "Validator did not produce a usable verdict.",
              ...validatorRuntimeFailures,
              "This is a validator runtime/compliance failure, not evidence that the milestone scope is wrong.",
            ].join(" ");
            callbacks.onError(mission.id, "validator_runtime_failure", summary, { milestoneId: milestone.id, recoverable: true });
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id, error: summary }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          await applyValidatorVerdictsToTodos(lapis, {
            missionId: mission.id,
            verdicts,
            reason: "validator verdicts recorded",
          });
          await reconcileMissionLedger(lapis, {
            missionId: mission.id,
            milestoneId: milestone.id,
            reason: "validator verdicts completed",
            actorId: "orchestrator",
          });

          const retryCounter = await lapis.incrementRetry(milestone.id);
          const effectiveMaxRescopes = Math.min(config.maxRescopes, config.maxAutoRescopes ?? AUTO_RESCOPE_BATCH_LIMIT);
          const decision = await negotiator.negotiate(
            milestone.id, retryCounter.retries, retryCounter.rescopes,
            config.maxValidatorRetries, effectiveMaxRescopes, verdicts,
          );

          if (decision.decision === "escalate") {
            const trigger: CheckpointTrigger = "validation_failed";
            const autoRescopeNote = effectiveMaxRescopes > 0
              ? ` Aurex auto-rescopes at most ${effectiveMaxRescopes} times before asking for direction so missions do not rescope endlessly.`
              : " Auto-rescope is disabled, so Aurex is asking for direction instead of re-planning automatically.";
            const summary = `${decision.reason}.${autoRescopeNote}`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          if (decision.decision === "retry") {
            // Reset failed units to "planned" and re-run worker+validator
            const failedIds = decision.failedUnitIds ?? [];
            if (failedIds.length === 0) {
              // Validator failed but didn't identify any specific units.
              // Re-running with no units to retry would loop indefinitely
              // (workers don't re-run, validator re-evaluates same code,
              // model may flip-flop between pass/fail). Escalate instead.
              const trigger: CheckpointTrigger = "unclassifiable_error";
              const summary = `Validator returned fail with no failedUnitIds — cannot determine which units to retry. ${decision.reason}`;
              callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
              return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
            }
            for (const uid of failedIds) {
              await lapis.updateWorkingUnitStatus(uid, "planned");
            }
            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "retry selected after validation",
              actorId: "orchestrator",
            });
            // Reset validator verdicts by creating a fresh contract snapshot
            // Then loop again
            loopActive = true;
            continue;
          }

          if (decision.decision === "rescope") {
            await lapis.updateMilestoneStatus(milestone.id, "in_progress");
            callbacks.onMilestoneProgress(milestone.id, "rescoping", completedCount, units.length);

            let resp;
            try {
              resp = await rescopeMilestone({
                pinyx,
                lapis,
                mission,
                milestone: { id: milestone.id, title: milestone.title, description: milestone.description },
                model: config.modelHints.orchestrator,
                reason: decision.reason,
                verdicts,
                researchFindings,
                completedUnitSummaries: integrationUnits.map((u) => ({
                  description: u.description,
                  declaredPaths: u.declaredPaths,
                  declaredModules: u.declaredModules,
                })),
              });
            } catch (err) {
              if (err instanceof QuotaExhaustedError) {
                const trigger: CheckpointTrigger = "quota_exhausted";
                const summary = `Quota exhausted during rescope for provider ${err.providerId}. Window resets at ${err.windowResetsAt}`;
                callbacks.onEscalation(mission.id, { kind: "quota_exhausted", milestoneId: milestone.id, windowResetsAt: err.windowResetsAt } as EscalationTrigger, { summary });
                return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
              }
              throw err;
            }

            if (!resp.ok) {
              const trigger: CheckpointTrigger = "rescope_limit";
              const summary = resp.error === "pinyx_threw"
                ? `Rescope re-planning failed: ${resp.message}`
                : `Rescope re-planning failed: ${resp.content}`;
              callbacks.onError(mission.id, "rescope_failed", summary, { milestoneId: milestone.id, recoverable: false });
              callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
              return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
            }

            // Log the rescope so the rescopes counter increments in LaPis.
            // Without this, the negotiator's rescopeCount is always 0 and the
            // auto-rescope limit is never enforced.
            await lapis.logRescope(milestone.id, {
              milestoneId: milestone.id,
              contractId,
              reason: decision.reason,
              previousScope: units.map((u: WorkingUnit) => u.description).join("; "),
              newScope: resp.units.map((u) => u.description).join("; "),
            }).catch((err) => {
              console.warn(`[milestone-loop] Failed to log rescope:`, err instanceof Error ? err.message : err);
            });

            preResearchAttempted = false;
            loopActive = true;
            continue;
          }

          // decision === "pass"
          let integration: Awaited<ReturnType<typeof integrationLifecycle.integrate>>;
          try {
            integration = await integrationLifecycle.integrate({
              missionId: mission.id, milestoneId: milestone.id,
              milestoneOrderIndex: milestone.orderIndex,
              baseBranch: loopConfig.gitMainBranch, units: integrationUnits,
              testCommands,
            });
            const mergedIntegrationUnits = integrationUnits.filter(
              (u) => integration.mergedBranches.includes(u.taskBranch),
            );
            await markMergedTodos(lapis, {
              missionId: mission.id,
              units: mergedIntegrationUnits,
              sourceBranches: integration.mergedBranches,
              targetBranch: integration.integrationBranch,
              reason: "integration branch merge completed after validation pass",
            });
            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "integration merge completed",
              actorId: "orchestrator",
            });
          } catch (error) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `Integration failed after validation pass: ${error instanceof Error ? error.message : String(error)}`;
            callbacks.onError(mission.id, "integration_failed", summary, { milestoneId: milestone.id, recoverable: false, details: { phase: "integration" } });
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary, phase: "integration" });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // Handle conflicted branches: map them to failed unit IDs so
          // the checkpoint provides actionable information.
          if (integration.conflictedBranches.length > 0) {
            const conflictedSet = new Set(integration.conflictedBranches);
            const conflictedUnitIds = integrationUnits
              .filter((u) => conflictedSet.has(u.taskBranch))
              .map((u) => u.id);
            if (conflictedUnitIds.length > 0) {
              callbacks.onError(mission.id, "integration_conflicts",
                `Merge conflicts on branches: ${integration.conflictedBranches.join(", ")}`,
                { milestoneId: milestone.id, recoverable: true, details: { conflictedUnitIds, phase: "integration" } });
            }
          }

          // Post-integration test gate: if contract tests fail on the
          // integration branch, report the failure instead of creating release.
          if (integration.testFailure) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `Integration branch tests failed:\n${integration.testFailure.slice(0, 500)}`;
            callbacks.onError(mission.id, "integration_tests_failed", summary, { milestoneId: milestone.id, recoverable: false, details: { phase: "integration_tests" } });
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary, phase: "integration_tests" });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // Post-milestone supply-chain scan
          if (loopConfig.onPostMilestoneScan) {
            try {
              await loopConfig.onPostMilestoneScan(mission.id, loopConfig.repoRoot);
            } catch (err) {
              console.warn(`[bumblebee] Post-milestone scan failed for mission ${mission.id}:`, err instanceof Error ? err.message : err);
            }
          }

          // Human must approve the release before merging to main
          callbacks.onEscalation(
            mission.id,
            { kind: "milestone_complete", milestoneId: milestone.id, releaseBranch: integration.releaseBranch },
            integration,
          );

          // Post-milestone compression — summarize completed milestone state
          const compressionTrigger: CompressionTrigger = "post_milestone";
          if (loopConfig.onCompression) {
            await loopConfig.onCompression(mission.id, compressionTrigger);
          } else {
            await lapis.runCompression(mission.id, compressionTrigger);
          }

          return {
            status: "checkpoint_needed",
            trigger: "milestone_complete",
            milestoneId: milestone.id,
            summary: `Milestone "${milestone.title}" passed validation. Release branch: ${integration.releaseBranch}`,
          };
        }
      }

      await lapis.updateMissionStatus(mission.id, "completed");
      return { status: "completed" };
      } finally {
        signal?.removeEventListener("abort", abortListener);
        activeHandles.clear();
      }
    },
  };

  function rememberRuntimeUnit(milestoneId: string, unit: WorkingUnit) {
    const units = runtimeUnitsByMilestone.get(milestoneId) ?? new Map<string, WorkingUnit>();
    units.set(unit.id, unit);
    runtimeUnitsByMilestone.set(milestoneId, units);
  }
}

function normalizeWorkingUnitForLoop(unit: WorkingUnit): WorkingUnit {
  const raw = unit as WorkingUnit & {
    milestone_id?: string;
    declared_paths?: unknown;
    declared_modules?: unknown;
    task_branch?: string;
    worktree_path?: string;
    session_id?: string;
  };
  const declaredPaths = Array.isArray(raw.declaredPaths)
    ? raw.declaredPaths
    : Array.isArray(raw.declared_paths)
      ? raw.declared_paths
      : [];
  const declaredModules = Array.isArray(raw.declaredModules)
    ? raw.declaredModules
    : Array.isArray(raw.declared_modules)
      ? raw.declared_modules
      : [];
  return {
    ...unit,
    milestoneId: raw.milestoneId ?? raw.milestone_id ?? "",
    description: raw.description ?? "",
    declaredPaths: declaredPaths.filter((item): item is string => typeof item === "string"),
    declaredModules: declaredModules.filter((item): item is string => typeof item === "string"),
    status: raw.status ?? "planned",
    taskBranch: raw.taskBranch ?? raw.task_branch ?? "",
    worktreePath: raw.worktreePath ?? raw.worktree_path ?? "",
    sessionId: raw.sessionId ?? raw.session_id ?? "",
  };
}

function applyWorkingUnitScopeFallback(
  unit: WorkingUnit,
  mission: Mission,
  milestone: Milestone,
  repoRoot: string,
): WorkingUnit {
  // Only fill in MISSING scope fields. Never rewrite a unit's description
  // or declared scope that the planner explicitly provided — silently
  // mutating identity is a footgun (a planner-produced refinement unit
  // would have its semantic identity replaced with the milestone title).
  if (unit.declaredPaths.length > 0 && unit.declaredModules.length > 0) {
    return unit;
  }

  const inferredPaths = unit.declaredPaths.length > 0
    ? unit.declaredPaths
    : inferDeclaredPathsFromText([
        mission.description,
        milestone.title,
        milestone.description,
        unit.description,
      ], repoRoot);
  const inferredModules = unit.declaredModules.length > 0
    ? unit.declaredModules
    : inferModulesFromPaths(inferredPaths);

  if (inferredPaths.length === unit.declaredPaths.length && inferredModules.length === unit.declaredModules.length) {
    return unit;
  }

  if (inferredPaths.length === 0 && inferredModules.length === 0) {
    // Nothing useful to fill in. Leave the unit alone — downstream code
    // already tolerates empty scope arrays.
    return unit;
  }

  return {
    ...unit,
    declaredPaths: inferredPaths,
    declaredModules: inferredModules,
  };
}

function selectWorkerTimeout(
  unit: WorkingUnit,
  timeouts: { simple: number; build: number; testHeavy: number },
  logger: AgentLogger | undefined,
  missionId: string,
  milestoneId: string,
): number {
  // Only the unit description drives the timeout selection. Mission/milestone
  // text is intentionally excluded — it would match "test|build|module" in
  // nearly every mission and make the build-window branch the unconditional
  // default, defeating the purpose of having two timeout tiers. Use narrow
  // verbs that signal "this unit does a multi-step analysis" rather than
  // generic programming keywords.
  const unitText = unit.description.toLowerCase();
  const needsBuildWindow = /\b(analy[sz]e|analysis|hotspot|complexity|refactor|decompose|extract|split)\b/.test(unitText)
    && /\b(cargo|npm test|pytest|cargo test|build)\b/.test(unitText);
  const timeout = needsBuildWindow ? Math.max(timeouts.simple, timeouts.build) : timeouts.simple;
  if (logger) {
    logger.log({
      sessionId: "orchestrator",
      agentType: "orchestrator",
      missionId,
      milestoneId,
      event: "tool_call",
      data: { note: "selectWorkerTimeout", needsBuildWindow, timeout, simple: timeouts.simple, build: timeouts.build },
    });
  }
  return timeout;
}

function inferDeclaredPathsFromText(textParts: string[], repoRoot: string): string[] {
  const text = textParts.filter(Boolean).join(" ");
  const paths = new Set<string>();
  const normalizedRoot = repoRoot.replace(/\/+$/, "");

  if (normalizedRoot.length > 0) {
    const absolutePathPattern = new RegExp(`${escapeRegex(normalizedRoot)}/([^\\s\`"'<>\\)\\]\\}]+)`, "g");
    for (const match of text.matchAll(absolutePathPattern)) {
      addPath(paths, match[1]);
    }
  }

  if (paths.size === 0) {
    const relativePathPattern = /(?:^|[\s`"'(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:rs|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|rb|php|cs|cpp|c|h|hpp|md|toml|json|ya?ml|css|scss|html|sql))/g;
    for (const match of text.matchAll(relativePathPattern)) {
      addPath(paths, match[1]);
    }
  }

  return [...paths];
}

function inferModulesFromPaths(paths: string[]): string[] {
  const modules = new Set<string>();
  for (const filePath of paths) {
    const parts = filePath.split("/").filter(Boolean);
    const srcIndex = parts.lastIndexOf("src");
    if (srcIndex >= 0 && parts[srcIndex + 1]) {
      modules.add(parts[srcIndex + 1] === "mod.rs" && parts[srcIndex - 1] ? parts[srcIndex - 1] : parts[srcIndex + 1].replace(/\.[^.]+$/, ""));
      continue;
    }
    if (parts.length > 1) {
      modules.add(parts[parts.length - 2]);
    }
  }
  return [...modules];
}

function addPath(paths: Set<string>, candidate: string | undefined): void {
  const cleaned = candidate
    ?.trim()
    .replace(/[.,;:!?]+$/, "")
    .replace(/^\/+/, "");
  if (cleaned && cleaned.includes("/") && !cleaned.includes("..")) {
    paths.add(cleaned);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
