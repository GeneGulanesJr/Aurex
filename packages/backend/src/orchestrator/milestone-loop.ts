import type { CheckpointTrigger, CompressionTrigger, Mission, Milestone, WorkingUnit, WorkerStatus, EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, ResearchFinding, AffectedCodeScaffold } from "@aurex/shared";
import path from "node:path";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import { createNegotiator } from "./negotiator.js";
import { createWorktreeManager, type CreateValidatorWorktreeResult } from "./worktree.js";
import { createAgentSpawner, type SpawnResult, type SpawnHandle } from "../agents/agent-spawner.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import type { EventBus } from "../ws/events.js";
import { buildValidatorContext, buildWorkerContext, buildResearchContext, type ValidatorUnitContext } from "../agents/context-builder.js";
import { buildAffectedCodeScaffold, DEFAULT_AFFECTED_CODE_TOKEN_BUDGET, type CodeGraphInput, type HotspotsInput } from "./affected-code.js";
import { loadConfig } from "../config.js";
import { checkPreSpawnOverlap } from "./overlap.js";
import { rescopeMilestone } from "./rescope.js";
import { validateHandoff } from "../enforcement/handoff-validator.js";
import {
  applyValidatorVerdictsToTodos,
  markWorkerTodoProgress,
  reconcileMissionLedger,
} from "./ledger-reconciler.js";
import {
  enrichWorkingUnitsForExecution,
  mergeRuntimeUnitFields,
  selectWorkerMaxTimeout,
  selectWorkerTimeout,
} from "./milestone-unit-context.js";
import {
  canResetStaleUnits,
  canRetryHandoffs,
  canRetryWorkers,
  createRetryBudget,
  markHandoffRetry,
  markStaleUnitReset,
  markWorkerRetry,
} from "./milestone-retry-budget.js";
import { resolveValidatorHandoffs, validateWorkerHandoffs } from "./milestone-handoff-gate.js";
import { collectValidatorDiffSummary } from "./milestone-validation-phase.js";
import {
  ensureValidatorVerdicts,
  selectValidatorTypes,
  type ValidatorRunResult,
} from "./milestone-validator-verdicts.js";
import { finalizeMilestoneRelease, runIntegrationPhase } from "./milestone-integration-phase.js";

// Auto-rescope is disabled by default (0). When enabled, the milestone loop
// will automatically re-plan via Pinyx after exhausting validator retries.
// When disabled (0), the loop escalates to the user after retries, giving
// the human direct control over whether to rescope, retry, or abort.
const AUTO_RESCOPE_BATCH_LIMIT = 0;

/** Max active agent sessions in a milestone loop. Keeps API concurrency within model limits. */
const MAX_ACTIVE_AGENTS = 2;

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
  /**
   * Hard timeout (ms) for research agent sessions. Falls back to the
   * mission's `workerTimeouts.testHeavy` when unset so existing callers
   * (and tests) keep their prior behavior.
   */
  researchTimeout?: number;
  /**
   * Hard timeout (ms) for validator agent sessions. Falls back to the
   * mission's `workerTimeouts.testHeavy` when unset.
   */
  validatorTimeout?: number;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
  loopConfig: MilestoneLoopConfig,
) {
  const worktreeManager = createWorktreeManager(loopConfig.repoRoot);
  let cumulativeCost = 0;
  const runtimeUnitsByMilestone = new Map<string, Map<string, WorkingUnit>>();
  const spawner = createAgentSpawner({
    lapis,
    agentDir: loopConfig.agentDir,
    defaultTimeout: 180_000,
    logger: loopConfig.logger,
    eventBus: loopConfig.eventBus,
    maxConcurrent: MAX_ACTIVE_AGENTS,
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

        // Reset the per-milestone runtime-unit cache at the start of
        // each iteration. The cache is populated by rememberRuntimeUnit()
        // when workers complete, and consumed at the top of the
        // worker+validation loop to backfill runtime-only fields
        // (taskBranch/worktreePath/sessionId) that LaPis doesn't echo
        // back on getWorkingUnitsForMilestone. Without this reset, a
        // long mission would accumulate stale entries for every
        // milestone it ever touched, leaking memory.
        runtimeUnitsByMilestone.delete(milestone.id);

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
        let retryBudget = createRetryBudget();
        let preResearchAttempted = false;
        const sequentialWorkerUnitIds = new Set<string>();

        // Affected-code scaffold cache (issue #114). Fetch the repo's full
        // graph + hotspots ONCE per run, then build a compact per-unit
        // scaffold inside the worker spawn loop. Cached by repoName so a
        // multi-milestone mission does not re-fetch. Failures are
        // non-fatal — the scaffold is an optimization, not a requirement.
        const affectedCodeCache = await loadAffectedCodeCache(loopConfig.repoRoot, lapis, mission.id, loopConfig.eventBus);
        while (loopActive) {
          loopActive = false;

          // Fetch current units (may change after rescope)
          let fetchedUnits: WorkingUnit[];
          try {
            fetchedUnits = await lapis.getWorkingUnitsForMilestone(milestone.id);
          } catch (err) {
            const summary = `Failed to load working units from LaPis for milestone ${milestone.id}: ${err instanceof Error ? err.message : String(err)}`;
            callbacks.onError(mission.id, "lapis_units_fetch_failed", summary, {
              milestoneId: milestone.id,
              recoverable: true,
            });
            callbacks.onEscalation(
              mission.id,
              { kind: "unclassifiable_error", milestoneId: milestone.id },
              { summary },
            );
            return { status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId: milestone.id, summary };
          }
          const runtimeUnits = runtimeUnitsByMilestone.get(milestone.id);
          const unitsWithRuntime = fetchedUnits.map((unit) => {
            const runtime = runtimeUnits?.get(unit.id);
            return mergeRuntimeUnitFields(unit, runtime);
          });
          const units = enrichWorkingUnitsForExecution(unitsWithRuntime, mission, milestone, loopConfig.repoRoot);
          const contracts = await lapis.getContractHistory(milestone.id).catch(() => [] as any[]);
          const contract = contracts[0] as any;

          let completedCount = 0;
          let failedCount = 0;
          const failedUnitIds: string[] = [];
          const handoffFailureUnitIds: string[] = [];
          const timeoutFailureUnitIds: string[] = [];
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
              timeout: loopConfig.researchTimeout ?? config.workerTimeouts.testHeavy,
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
          if (staleUnits.length > 0 && canResetStaleUnits(retryBudget, "worker")) {
            markStaleUnitReset(retryBudget, "worker");
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
            const runtimeUnitsAfterReset = runtimeUnitsByMilestone.get(milestone.id);
            const mergedRefreshed = refreshed.map((unit) => {
              const runtime = runtimeUnitsAfterReset?.get(unit.id);
              return mergeRuntimeUnitFields(unit, runtime);
            });
            units.length = 0;
            units.push(...enrichWorkingUnitsForExecution(mergedRefreshed, mission, milestone, loopConfig.repoRoot));
          }

          const pendingUnits = units.filter((u: WorkingUnit) => u.status === "planned");
          const completedUnits = units.filter((u: WorkingUnit) => u.status === "completed");
          completedCount = completedUnits.length;
          integrationUnits.push(...completedUnits);
          validatorUnits.push(...completedUnits.map((u: WorkingUnit) => ({
            id: u.id, description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules, taskBranch: u.taskBranch, worktreePath: u.worktreePath,
          })));

          // Group pending units into non-overlapping batches using glob-aware overlap detection.
          // Units flagged after a merge conflict are forced into single-unit batches so retries
          // run sequentially instead of racing on overlapping files again.
          const batches: WorkingUnit[][] = [];
          const sequentialPending = pendingUnits.filter((unit) => sequentialWorkerUnitIds.has(unit.id));
          const batchablePending = pendingUnits.filter((unit) => !sequentialWorkerUnitIds.has(unit.id));
          for (const unit of sequentialPending) {
            batches.push([unit]);
          }
          const remaining = [...batchablePending];
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

          // Process each batch, limiting concurrent workers to MAX_ACTIVE_AGENTS.
          // Later batches branch from the last completed worker so overlapping units
          // stack changes instead of conflicting at validator dry-merge.
          let workerChainBaseBranch = loopConfig.gitMainBranch;
          const unitOrder = new Map(units.map((unit, index) => [unit.id, index]));
          for (const batch of batches) {
            // Spawn in chunks to stay within concurrency limits
            for (let i = 0; i < batch.length; i += MAX_ACTIVE_AGENTS) {
              const chunk = batch.slice(i, i + MAX_ACTIVE_AGENTS);
              const handles = await Promise.all(chunk.map(async (unit) => {
              const agentId = `worker-${unit.id}`;
              const { worktreePath, taskBranch, baseCommitHash } = await worktreeManager.createWorktree(
                agentId, unit.id, workerChainBaseBranch,
              );
              await worktreeManager.installBranchGuard(worktreePath, taskBranch);
              const affectedCode = buildScaffoldForUnit(unit, affectedCodeCache);
              if (affectedCode) {
                loopConfig.eventBus?.emit({ type: "mission_log", missionId: mission.id, phase: "context", message: `Injected affected-code scaffold for unit ${unit.id}: ${affectedCode.nodes.length} nodes, ${affectedCode.edges.length} edges, ${affectedCode.hotspots.length} hotspots${affectedCode.truncated ? " (trimmed to budget)" : ""}`, data: { unitId: unit.id, nodes: affectedCode.nodes.length, edges: affectedCode.edges.length, hotspots: affectedCode.hotspots.length, truncated: affectedCode.truncated, tokenBudget: affectedCode.tokenBudget } });
              }
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
                affectedCode,
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
              const workerTimeout = selectWorkerTimeout(unit, config.workerTimeouts);
              const handle = await spawner.spawn({
                agentType: "worker",
                agentId,
                unitId: unit.id,
                missionId: mission.id,
                milestoneId: milestone.id,
                cwd: worktreePath,
                baseCommitHash,
                skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/worker.md`,
                contextContent,
                taskPrompt: [
                  `Implement: ${unit.description}`,
                  "",
                  "Research findings from the research agent are in your context under 'Research Findings'. Use them directly. Do NOT re-read files already documented there.",
                  "",
                  "Follow your skill instructions carefully.",
                  "You MUST run `git add` and `git commit` on your task branch, then call write_handoff with the real `git rev-parse HEAD` hash. The hash is verified: it must be a NEW commit on your branch (not the starting commit). For analysis-only tasks with no code changes, commit a documentation/notes update or an empty commit so there is a real commit to validate against.",
                  "When useful work is committed, verification is blocked, or time is running short, call write_handoff immediately with partial/blocking details.",
                ].join("\n"),
                timeout: workerTimeout,
                extendTimeoutOnActivity: true,
                maxTimeout: selectWorkerMaxTimeout(workerTimeout),
                model: config.modelHints.worker,
              });
              activeHandles.add(handle);

              callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);
                return { unit, agentId, worktreePath, taskBranch, handle };
              }));

              const chunkCompletions: Array<{ order: number; taskBranch: string }> = [];
              await Promise.all(handles.map(async ({ unit, agentId, worktreePath, taskBranch, handle }) => {
                const result = await handle.completed;
                activeHandles.delete(handle);
                if (result.status === "completed") {
                  chunkCompletions.push({ order: unitOrder.get(unit.id) ?? 0, taskBranch });
                  const completedUnit = { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "completed" as const };
              await persistRuntimeUnit(milestone.id, completedUnit);
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
                  const timedOutUnit = { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "timed_out" as const };
              await persistRuntimeUnit(milestone.id, timedOutUnit);
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
                  timeoutFailureUnitIds.push(unit.id);
                } else {
                  const missingHandoff = result.error?.includes("write_handoff") || result.error?.includes("worker_handoff_missing");
                  const failedUnit = { ...unit, taskBranch, worktreePath, sessionId: result.sessionId, status: "failed" as const };
              await persistRuntimeUnit(milestone.id, failedUnit);
                  await lapis.updateWorkingUnitStatus(unit.id, "failed");
                  await markWorkerTodoProgress(lapis, {
                    missionId: mission.id,
                    unit: { ...unit, taskBranch, worktreePath },
                    workerId: agentId,
                    status: "blocked",
                    reason: missingHandoff ? "worker ended without accepted handoff" : "worker failed",
                    branch: taskBranch,
                    notes: [missingHandoff
                      ? `Worker ${agentId} ended before submitting an accepted write_handoff for unit ${unit.id}`
                      : `Worker ${agentId} failed unit ${unit.id}`],
                  });
                  callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
                  callbacks.onError(
                    mission.id,
                    missingHandoff ? "worker_handoff_invalid" : "worker_failed",
                    missingHandoff
                      ? `Worker "${unit.description}" did not submit a valid handoff`
                      : `Worker "${unit.description}" failed`,
                    {
                      workerId: agentId,
                      milestoneId: milestone.id,
                      recoverable: true,
                      ...(missingHandoff ? { details: { error: result.error } } : {}),
                    },
                  );
                  failedCount++;
                  failedUnitIds.push(unit.id);
                  if (missingHandoff) handoffFailureUnitIds.push(unit.id);
                }
                await reconcileMissionLedger(lapis, {
                  missionId: mission.id,
                  milestoneId: milestone.id,
                  reason: `worker ${result.status}`,
                  actorId: "orchestrator",
                });
                handle.dispose();
              }));

              const latestChunkCompletion = chunkCompletions.sort((a, b) => b.order - a.order)[0];
              if (latestChunkCompletion) {
                workerChainBaseBranch = latestChunkCompletion.taskBranch;
              }
            }

            callbacks.onMilestoneProgress(milestone.id, "in_progress", completedCount, units.length);
          }

          // Workers may have verified/rejected research findings via their
          // verify_finding/reject_finding tools. Refresh the cached snapshot
          // now so the upcoming validator phase (and any retry iteration's
          // workers) see the latest statuses and rejection rationales instead
          // of a stale view captured before the worker phase ran.
          researchFindings = await lapis.getFindings(mission.id).catch(() => researchFindings);

          if (failedCount > 0) {
            // Per-unit retry: re-spawn only the failed units once before
            // escalating the entire milestone. This avoids discarding
            // successful workers' work when only 1-2 units failed.
            const failedUnitIdsForRetry = failedUnitIds;
            if (failedUnitIdsForRetry.length > 0 && canRetryWorkers(retryBudget)) {
              markWorkerRetry(retryBudget);
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
            const summary = handoffFailureUnitIds.length === failedCount
              ? `${handoffFailureUnitIds.length} worker unit(s) failed to submit a valid handoff after retry`
              : timeoutFailureUnitIds.length === failedCount
                ? `${timeoutFailureUnitIds.length} worker unit(s) timed out after retry`
                : `${failedCount} worker unit(s) failed after retry`;
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
            if (allTransient && canResetStaleUnits(retryBudget, "validation")) {
              markStaleUnitReset(retryBudget, "validation");
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
          const handoffLoad = await resolveValidatorHandoffs(lapis, milestone.id, validatorUnits);
          const handoffGate = validateWorkerHandoffs(validatorUnits, handoffLoad);
          const invalidHandoffUnitIds = handoffGate.invalidUnitIds;

          for (const unit of validatorUnits.filter((candidate) => invalidHandoffUnitIds.includes(candidate.id))) {
            let errors: string[];
            if (handoffLoad.fetchFailed) {
              errors = [`handoff fetch failed: ${handoffLoad.fetchError ?? "unknown error"}`];
            } else if (unit.handoff) {
              errors = validateHandoff(unit.handoff).errors;
            } else {
              errors = ["worker completed without submitting write_handoff"];
            }
            await lapis.updateWorkingUnitStatus(unit.id, "failed").catch(() => {});
            await markWorkerTodoProgress(lapis, {
              missionId: mission.id,
              unit: unit as WorkingUnit,
              workerId: "handoff-validator",
              status: "blocked",
              reason: `invalid worker handoff: ${errors.join("; ") || "validation failed"}`,
              branch: unit.taskBranch,
              notes: errors,
            });
            const errorMessage = handoffLoad.fetchFailed
              ? `Worker "${unit.description}" handoff could not be loaded from LaPis`
              : `Worker "${unit.description}" did not submit a valid handoff`;
            const errorCode = handoffLoad.fetchFailed ? "worker_handoff_fetch_failed" : "worker_handoff_invalid";
            callbacks.onError(mission.id, errorCode, errorMessage, {
              workerId: `worker-${unit.id}`,
              milestoneId: milestone.id,
              recoverable: true,
              details: { errors },
            });
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

            if (canRetryHandoffs(retryBudget)) {
              markHandoffRetry(retryBudget);
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

          const validatorTypes = selectValidatorTypes(acceptanceBehavior);
          const diffSummary = await collectValidatorDiffSummary(validatorUnits, loopConfig.gitMainBranch).catch(() => "");

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

          if (validatorWorktree && validatorWorktree.conflictedBranches.length > 0) {
            try {
              await worktreeManager.pruneWorktree(validatorWorktree.worktreePath);
            } catch (err) {
              console.warn(
                `[validator] Failed to prune conflicted merged worktree ${validatorWorktree.worktreePath}:`,
                err instanceof Error ? err.message : err,
              );
            }

            const conflictedSet = new Set(validatorWorktree.conflictedBranches);
            const conflictedUnitIds = validatorUnits
              .filter((unit) => conflictedSet.has(unit.taskBranch))
              .map((unit) => unit.id);
            const batchUnitIds = validatorUnits.map((unit) => unit.id);
            const unitsToRetry = [...validatorUnits];

            if (batchUnitIds.length > 1 && canRetryWorkers(retryBudget)) {
              markWorkerRetry(retryBudget);
              validatorUnits.length = 0;
              integrationUnits.length = 0;
              for (const unit of unitsToRetry) {
                sequentialWorkerUnitIds.add(unit.id);
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
              const runtimeForMilestone = runtimeUnitsByMilestone.get(milestone.id);
              for (const uid of batchUnitIds) {
                runtimeForMilestone?.delete(uid);
                await lapis.updateWorkingUnitStatus(uid, "planned");
              }
              completedCount = Math.max(0, completedCount - batchUnitIds.length);
              await reconcileMissionLedger(lapis, {
                missionId: mission.id,
                milestoneId: milestone.id,
                reason: "per-unit retry: workers with merge conflicts will re-run sequentially",
                actorId: "orchestrator",
              });
              loopConfig.eventBus?.emit({
                type: "mission_log",
                missionId: mission.id,
                phase: "validation",
                message: `Validator dry-merge conflict on ${conflictedUnitIds.length} unit(s); re-running ${batchUnitIds.length} worker(s) sequentially`,
                data: { conflictedUnitIds, conflictedBranches: validatorWorktree.conflictedBranches, batchUnitIds },
              });
              callbacks.onMilestoneProgress(milestone.id, "retrying", completedCount, units.length);
              loopActive = true;
              continue;
            }

            const summary = `Worker branches could not be merged for validation: ${validatorWorktree.conflictedBranches.join(", ")}`;
            callbacks.onError(
              mission.id,
              "validator_merge_conflicts",
              summary,
              {
                milestoneId: milestone.id,
                recoverable: true,
                details: { conflictedUnitIds, phase: "validator_merge" },
              },
            );
            callbacks.onEscalation(
              mission.id,
              { kind: "validation_failed", milestoneId: milestone.id },
              { summary, conflictedUnitIds, phase: "validator_merge" },
            );
            return {
              status: "checkpoint_needed",
              trigger: "validation_failed",
              milestoneId: milestone.id,
              summary,
            };
          }

          const validatorCwd = validatorWorktree?.worktreePath ?? loopConfig.repoRoot;

          const validatorResults: ValidatorRunResult[] = [];

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
              timeout: loopConfig.validatorTimeout ?? config.workerTimeouts.testHeavy,
              model: config.modelHints[validatorType],
              validatorToolCallCap: config.validatorToolCallCap ?? 0,
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            validatorResults.push({ validatorType, sessionId: handle.sessionId, result });
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);
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
          const { verdicts: currentRunVerdicts, runtimeFailures: validatorRuntimeFailures } = await ensureValidatorVerdicts(
            lapis,
            milestone.id,
            contractId,
            validatorResults,
          );

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
            verdicts: currentRunVerdicts,
            reason: "validator verdicts recorded",
          });
          await reconcileMissionLedger(lapis, {
            missionId: mission.id,
            milestoneId: milestone.id,
            reason: "validator verdicts completed",
            actorId: "orchestrator",
          });

          // Fetch retry/rescope counters without incrementing on pass cycles.
          const retryCounter = await lapis.getRetryCounter(milestone.id).catch(() => ({
            milestoneId: milestone.id,
            retries: 0,
            rescopes: 0,
          }));
          const retryCount = retryCounter.retries;
          const rescopeCount = retryCounter.rescopes;
          const effectiveMaxRescopes = Math.min(config.maxRescopes, config.maxAutoRescopes ?? AUTO_RESCOPE_BATCH_LIMIT);
          const decision = await negotiator.negotiate(
            milestone.id, retryCount, rescopeCount,
            config.maxValidatorRetries, effectiveMaxRescopes, currentRunVerdicts,
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
            try {
              await lapis.incrementRetry(milestone.id);
            } catch (err) {
              const summary = `Failed to persist validator retry counter: ${err instanceof Error ? err.message : String(err)}`;
              callbacks.onError(mission.id, "lapis_retry_counter_failed", summary, {
                milestoneId: milestone.id,
                recoverable: true,
              });
              const trigger: CheckpointTrigger = "unclassifiable_error";
              callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
              return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
            }
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
                verdicts: currentRunVerdicts,
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

          const integrationResult = await runIntegrationPhase(lapis, worktreeManager, callbacks, {
            missionId: mission.id,
            milestoneId: milestone.id,
            milestoneOrderIndex: milestone.orderIndex,
            baseBranch: loopConfig.gitMainBranch,
            integrationUnits,
            testCommands,
            repoRoot: loopConfig.repoRoot,
            onPostMilestoneScan: loopConfig.onPostMilestoneScan,
          });
          if (!integrationResult.ok) {
            callbacks.onEscalation(
              mission.id,
              { kind: integrationResult.trigger, milestoneId: milestone.id },
              { summary: integrationResult.summary, phase: integrationResult.phase },
            );
            return {
              status: "checkpoint_needed",
              trigger: integrationResult.trigger,
              milestoneId: milestone.id,
              summary: integrationResult.summary,
            };
          }

          const finalized = await finalizeMilestoneRelease(lapis, callbacks, {
            missionId: mission.id,
            milestoneId: milestone.id,
            milestoneTitle: milestone.title,
            integration: integrationResult.integration,
            onCompression: loopConfig.onCompression,
          });

          return {
            status: "checkpoint_needed",
            trigger: finalized.trigger,
            milestoneId: milestone.id,
            summary: finalized.summary,
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

  async function persistRuntimeUnit(milestoneId: string, unit: WorkingUnit) {
    if (typeof lapis.updateWorkingUnit === "function") {
      await lapis.updateWorkingUnit(unit.id, {
        taskBranch: unit.taskBranch,
        worktreePath: unit.worktreePath,
        sessionId: unit.sessionId,
      }).catch((err) => {
        console.warn(`[milestone-loop] Failed to persist runtime fields for unit ${unit.id}:`, err instanceof Error ? err.message : err);
      });
    }
    rememberRuntimeUnit(milestoneId, unit);
  }
}

// --- Affected-code scaffold helpers (issue #114) ---
// These live at module scope so the reducer logic is testable in isolation
// and the cache type is shared. They are intentionally defensive: any LaPis
// failure returns an empty cache and the scaffold simply is not injected.

interface AffectedCodeCache {
  repoName: string;
  graph?: CodeGraphInput;
  hotspots?: HotspotsInput;
}

async function loadAffectedCodeCache(
  repoRoot: string,
  lapis: LaPisClient,
  missionId: string,
  eventBus: EventBus | undefined,
): Promise<AffectedCodeCache> {
  const repoName = path.basename(repoRoot);
  const cache: AffectedCodeCache = { repoName };
  try {
    const [graph, hotspots] = await Promise.all([
      typeof lapis.getCodeGraph === "function" ? lapis.getCodeGraph(repoName).catch(() => undefined) : Promise.resolve(undefined),
      typeof lapis.getCodeHotspots === "function" ? lapis.getCodeHotspots(repoName).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    cache.graph = graph;
    cache.hotspots = hotspots;
    const nodeCount = graph?.nodes?.length ?? 0;
    const hotspotCount = hotspots?.files?.length ?? 0;
    if (nodeCount === 0 && hotspotCount === 0) {
      eventBus?.emit({ type: "mission_log", missionId, phase: "context", message: `Affected-code scaffold disabled: no graph/hotspots for repo ${repoName}.` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    eventBus?.emit({ type: "mission_log", missionId, phase: "context", message: `Affected-code scaffold disabled: ${msg}` });
  }
  return cache;
}

/**
 * Build a per-unit scaffold from the cached graph/hotspots. Returns undefined
 * when the cache is empty (no graph AND no hotspots) or the token budget is 0,
 * so `buildWorkerContext` omits the section entirely (backward-compatible).
 */
function buildScaffoldForUnit(
  unit: WorkingUnit,
  cache: AffectedCodeCache,
): AffectedCodeScaffold | undefined {
  let tokenBudget: number;
  try {
    tokenBudget = loadConfig().affectedCodeTokenBudget;
  } catch {
    // loadConfig() throws if required env vars (REPO_ROOT, LAPIS_ENDPOINT)
    // are unset — fall back to the documented default so the scaffold still
    // works in tests / partial environments.
    tokenBudget = DEFAULT_AFFECTED_CODE_TOKEN_BUDGET;
  }
  if (tokenBudget <= 0) return undefined;
  const hasGraph = cache.graph && (cache.graph.nodes?.length ?? 0) > 0;
  const hasHotspots = cache.hotspots && (cache.hotspots.files?.length ?? 0) > 0;
  if (!hasGraph && !hasHotspots) return undefined;
  return buildAffectedCodeScaffold({
    unitId: unit.id,
    declaredPaths: unit.declaredPaths ?? [],
    declaredModules: unit.declaredModules ?? [],
    graph: cache.graph ?? { nodes: [], edges: [] },
    hotspots: cache.hotspots ?? { files: [] },
    tokenBudget,
  });
}
