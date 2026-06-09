import type { CheckpointTrigger, CompressionTrigger, Mission, Milestone, WorkingUnit, EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, ResearchFinding } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import { createNegotiator } from "./negotiator.js";
import { createWorktreeManager, type CreateValidatorWorktreeResult } from "./worktree.js";
import { createAgentSpawner } from "../agents/agent-spawner.js";
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

const AUTO_RESCOPE_BATCH_LIMIT = 2;

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
  onCompression?: (missionId: string, trigger: CompressionTrigger) => Promise<void>;
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
  const spawner = createAgentSpawner({
    lapis,
    agentDir: loopConfig.agentDir,
    defaultTimeout: 120_000,
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
        while (loopActive) {
          loopActive = false;

          // Fetch current units (may change after rescope)
          const units = await lapis.getWorkingUnitsForMilestone(milestone.id).catch(() => [] as import("@aurex/shared").WorkingUnit[]);
          const contracts = await lapis.getContractHistory(milestone.id).catch(() => [] as any[]);
          const contract = contracts[0] as any;

          let completedCount = 0;
          let failedCount = 0;
          const integrationUnits: WorkingUnit[] = [];
          const validatorUnits: ValidatorUnitContext[] = [];

          // --- WORKER PHASE ---
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

          // Process each batch concurrently
          for (const batch of batches) {
            const handles = await Promise.all(batch.map(async (unit) => {
              const agentId = `worker-${unit.id}`;
              const { worktreePath, taskBranch } = await worktreeManager.createWorktree(
                agentId, unit.id, loopConfig.gitMainBranch,
              );
              await worktreeManager.installBranchGuard(worktreePath, taskBranch);
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
                taskPrompt: `Implement: ${unit.description}\n\nFollow your skill instructions carefully. Use write_handoff when done.`,
                timeout: config.workerTimeouts.simple,
              });
              activeHandles.add(handle);

              callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);
              return { unit, agentId, worktreePath, taskBranch, handle };
            }));

            await Promise.all(handles.map(async ({ unit, agentId, worktreePath, taskBranch, handle }) => {
              const result = await handle.completed;
              activeHandles.delete(handle);
              if (result.status === "completed") {
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
              } else {
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
            await reconcileMissionLedger(lapis, {
              missionId: mission.id,
              milestoneId: milestone.id,
              reason: "worker failure before validation",
              actorId: "orchestrator",
            });
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `${failedCount} worker unit(s) failed before validation`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // Cost cap check — pause if budget exceeded
          if (config.costCap > 0 && cumulativeCost >= config.costCap) {
            const trigger: CheckpointTrigger = "cost_cap_exceeded";
            const summary = `Mission cost cap exceeded: $${cumulativeCost.toFixed(2)} >= $${config.costCap.toFixed(2)}`;
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          // --- RESEARCH PHASE ---
          const allDeclaredPaths = units.flatMap((u: WorkingUnit) => u.declaredPaths);
          const allDeclaredModules = [...new Set(units.flatMap((u: WorkingUnit) => u.declaredModules))];
          const researchAgentId = `research-${milestone.id}`;
          const researchContext = buildResearchContext({
            missionDescription: mission.description,
            milestoneTitle: milestone.title,
            milestoneDescription: milestone.description,
            unitDescriptions: units.map((u: WorkingUnit) => u.description),
            declaredPaths: allDeclaredPaths,
            declaredModules: allDeclaredModules,
          });

          callbacks.onAgentStatus(researchAgentId, "research", "spawned", milestone.id);
          const researchHandle = await spawner.spawn({
            agentType: "research",
            agentId: researchAgentId,
            missionId: mission.id,
            milestoneId: milestone.id,
            cwd: loopConfig.repoRoot,
            skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/research.md`,
            contextContent: researchContext,
            taskPrompt: `Research domain knowledge for milestone "${milestone.title}". Investigate the codebase areas relevant to the declared paths and modules. Submit findings using write_finding.`,
            timeout: config.workerTimeouts.build,
          });
          activeHandles.add(researchHandle);

          callbacks.onAgentStatus(researchAgentId, "research", "researching", milestone.id);
          const researchResult = await researchHandle.completed;
          activeHandles.delete(researchHandle);
          callbacks.onAgentStatus(
            researchAgentId,
            "research",
            researchResult.status === "completed" ? "completed" : researchResult.status,
            milestone.id,
          );
          researchHandle.dispose();

          researchFindings = await lapis.getFindings(mission.id).catch(() => researchFindings);

          // --- VALIDATOR PHASE ---
          const handoffs = await lapis.getHandoffsForMilestone(milestone.id).catch(() => [] as any[]);
          const handoffsByUnitId = new Map(handoffs.map((handoff: any) => [handoff.unitId, handoff]));
          for (const unit of validatorUnits) {
            unit.handoff = handoffsByUnitId.get(unit.id);
          }

          // Validate handoffs — fail units with invalid handoffs
          const invalidHandoffUnitIds: string[] = [];
          for (const unit of validatorUnits) {
            if (unit.handoff) {
              const validation = validateHandoff(unit.handoff as any);
              if (!validation.valid) {
                console.warn(`[enforcement] Invalid handoff for unit ${unit.id}:`, validation.errors);
                await lapis.updateWorkingUnitStatus(unit.id, "failed").catch(() => {});
                await markWorkerTodoProgress(lapis, {
                  missionId: mission.id,
                  unit: unit as WorkingUnit,
                  workerId: "handoff-validator",
                  status: "blocked",
                  reason: `invalid worker handoff: ${validation.errors.join("; ")}`,
                  branch: unit.taskBranch,
                  notes: validation.errors,
                });
                invalidHandoffUnitIds.push(unit.id);
              }
            }
          }
          if (invalidHandoffUnitIds.length > 0) {
            failedCount += invalidHandoffUnitIds.length;
            const invalidSet = new Set(invalidHandoffUnitIds);
            // Remove invalid units from subsequent phases
            for (let i = validatorUnits.length - 1; i >= 0; i--) {
              if (invalidSet.has(validatorUnits[i].id)) validatorUnits.splice(i, 1);
            }
            for (let i = integrationUnits.length - 1; i >= 0; i--) {
              if (invalidSet.has((integrationUnits[i] as WorkingUnit).id)) integrationUnits.splice(i, 1);
            }
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

          for (const validatorType of validatorTypes) {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({
              validatorType, missionDescription: mission.description,
              milestoneTitle: milestone.title, milestoneDescription: milestone.description,
              contractId, contractCriteria: criteria, testCommands, acceptanceBehavior,
              baseBranch: loopConfig.gitMainBranch, units: validatorUnits,
              researchFindings,
              diffSummary: diffSummary || undefined,
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
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);

            // If the validator was killed by the tool-call cap, write a
            // synthetic fail verdict here (in the milestone-loop's control
            // flow) instead of in the spawner's subscribe callback. The
            // subscribe callback's async writeVerdict races with
            // resolveCompleted, causing the verdict to be missing when
            // getVerdicts runs (root cause of the rescope death spiral).
            if (result.status === "failed" && result.error?.includes("tool_call_cap_exceeded")) {
              try {
                await lapis.writeVerdict(handle.sessionId, {
                  milestoneId: milestone.id,
                  contractId,
                  validatorType: validatorType as "validator_scrutiny" | "validator_user_testing",
                  verdict: "fail",
                  findings: `Validator auto-failed: exceeded tool-call cap without producing a verdict. The model exhausted its tool-call budget without writing a grounded verdict. This usually means the validator couldn't find real issues but also couldn't confidently pass — review the worker output and contract criteria manually.`,
                  failedUnitIds: [],
                  timestamp: new Date().toISOString(),
                });
              } catch (err) {
                console.warn(`[milestone-loop] Failed to write synthetic cap-hit verdict:`, err instanceof Error ? err.message : err);
              }
            }

            handle.dispose();
          }

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
          const verdicts = await lapis.getVerdicts(milestone.id).catch(() => [] as import("@aurex/shared").ValidationVerdict[]);
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
          const effectiveMaxRescopes = Math.min(config.maxRescopes, AUTO_RESCOPE_BATCH_LIMIT);
          const decision = await negotiator.negotiate(
            milestone.id, retryCounter.retries, retryCounter.rescopes,
            config.maxValidatorRetries, effectiveMaxRescopes, verdicts,
          );

          if (decision.decision === "escalate") {
            const trigger: CheckpointTrigger = "rescope_limit";
            const summary = `${decision.reason}. Aurex auto-rescopes at most ${AUTO_RESCOPE_BATCH_LIMIT} times before asking for direction so missions do not rescope endlessly.`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
          }

          if (decision.decision === "retry") {
            // Reset failed units to "planned" and re-run worker+validator
            const failedIds = decision.failedUnitIds ?? [];
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

            loopActive = true;
            continue;
          }

          // decision === "pass"
          let integration;
          try {
            integration = await integrationLifecycle.integrate({
              missionId: mission.id, milestoneId: milestone.id,
              milestoneOrderIndex: milestone.orderIndex,
              baseBranch: loopConfig.gitMainBranch, units: integrationUnits,
            });
            await markMergedTodos(lapis, {
              missionId: mission.id,
              units: integrationUnits,
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
}
