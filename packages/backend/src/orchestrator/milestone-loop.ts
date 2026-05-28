// packages/backend/src/orchestrator/milestone-loop.ts
import type { CheckpointTrigger, CompressionTrigger, Mission, Milestone, WorkingUnit, EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { createNegotiator } from "./negotiator.js";
import { createWorktreeManager } from "./worktree.js";
import { createAgentSpawner } from "../agents/agent-spawner.js";
import { buildValidatorContext, buildWorkerContext, buildResearchContext, type ValidatorUnitContext } from "../agents/context-builder.js";
import { createIntegrationLifecycle } from "./integration-lifecycle.js";
import { validateHandoff } from "../enforcement/handoff-validator.js";

export type MilestoneLoopResult =
  | { status: "completed" }
  | { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string }
  | { status: "failed"; reason: string };

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: EscalationTrigger, context: EscalationContext) => void;
  onAgentStatus: (agentId: string, agentType: AgentType, status: AgentStatus, milestoneId: string) => void;
  onMilestoneProgress: (milestoneId: string, status: MilestoneStatus | string, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export interface MilestoneLoopConfig {
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
  onCompression?: (missionId: string, trigger: CompressionTrigger) => Promise<void>;
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

        // --- WORKER + VALIDATION + NEGOTIATION LOOP ---
        // Retries re-spawn failed workers and re-validate.
        // Rescopes re-plan the milestone via PiNyx and start fresh.
        let loopActive = true;
        while (loopActive) {
          loopActive = false;

          // Fetch current units (may change after rescope)
          const units = await lapis.getWorkingUnitsForMilestone(milestone.id);
          const contracts = await lapis.getContractHistory(milestone.id);
          const contract = contracts[0] as any;

          let completedCount = 0;
          let failedCount = 0;
          const integrationUnits: WorkingUnit[] = [];
          const validatorUnits: ValidatorUnitContext[] = [];

          // --- WORKER PHASE ---
          const pendingUnits = units.filter((u: WorkingUnit) => u.status !== "completed");
          const completedUnits = units.filter((u: WorkingUnit) => u.status === "completed");
          completedCount = completedUnits.length;
          integrationUnits.push(...completedUnits);
          validatorUnits.push(...completedUnits.map((u: WorkingUnit) => ({
            id: u.id, description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules, taskBranch: u.taskBranch, worktreePath: u.worktreePath,
          })));

          // Group pending units into non-overlapping batches
          const batches: WorkingUnit[][] = [];
          const remaining = [...pendingUnits];
          while (remaining.length > 0) {
            const batch: WorkingUnit[] = [remaining.shift()!];
            const batchScope = { paths: new Set(batch[0].declaredPaths), modules: new Set(batch[0].declaredModules) };
            for (let i = remaining.length - 1; i >= 0; i--) {
              const candidate = remaining[i];
              const hasOverlap = candidate.declaredPaths.some((p: string) => batchScope.paths.has(p))
                || candidate.declaredModules.some((m: string) => batchScope.modules.has(m));
              if (!hasOverlap) {
                batch.push(candidate);
                candidate.declaredPaths.forEach((p: string) => batchScope.paths.add(p));
                candidate.declaredModules.forEach((m: string) => batchScope.modules.add(m));
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
              });

              callbacks.onAgentStatus(agentId, "worker", "spawned", milestone.id);
              const handle = await spawner.spawn({
                agentType: "worker",
                unitId: unit.id,
                missionId: mission.id,
                milestoneId: milestone.id,
                cwd: worktreePath,
                skillFilePath: `${loopConfig.repoRoot}/packages/backend/src/skills/worker.md`,
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
                callbacks.onAgentStatus(agentId, "worker", "timed_out", milestone.id);
                failedCount++;
              } else {
                await lapis.updateWorkingUnitStatus(unit.id, "failed");
                callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
                failedCount++;
              }
              handle.dispose();
            }));

            callbacks.onMilestoneProgress(milestone.id, "in_progress", completedCount, units.length);
          }

          if (failedCount > 0) {
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
            missionId: mission.id,
            milestoneId: milestone.id,
            cwd: loopConfig.repoRoot,
            skillFilePath: `${loopConfig.repoRoot}/packages/backend/src/skills/research.md`,
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

          // --- VALIDATOR PHASE ---
          const handoffs = await lapis.getHandoffsForMilestone(milestone.id);
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

          const validatorTypes: Array<"validator_scrutiny" | "validator_user_testing"> = ["validator_scrutiny"];
          if (acceptanceBehavior.trim().length > 0 && acceptanceBehavior.trim().toLowerCase() !== "none") {
            validatorTypes.push("validator_user_testing");
          }

          for (const validatorType of validatorTypes) {
            const agentId = `${validatorType}-${milestone.id}`;
            const contextContent = buildValidatorContext({
              validatorType, missionDescription: mission.description,
              milestoneTitle: milestone.title, milestoneDescription: milestone.description,
              contractId, contractCriteria: criteria, testCommands, acceptanceBehavior,
              baseBranch: loopConfig.gitMainBranch, units: validatorUnits,
            });

            callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
            const handle = await spawner.spawn({
              agentType: validatorType, missionId: mission.id, milestoneId: milestone.id,
              contractId, cwd: loopConfig.repoRoot,
              skillFilePath: `${loopConfig.repoRoot}/packages/backend/src/skills/validator.md`,
              contextContent,
              taskPrompt: `Validate milestone "${milestone.title}" as ${validatorType}. Use write_verdict when done.`,
              timeout: config.workerTimeouts.testHeavy,
            });
            activeHandles.add(handle);

            callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
            const result = await handle.completed;
            activeHandles.delete(handle);
            callbacks.onAgentStatus(agentId, validatorType, result.status === "completed" ? "completed" : result.status, milestone.id);
            handle.dispose();
          }

          // --- NEGOTIATION PHASE ---
          const retryCounter = await lapis.incrementRetry(milestone.id);
          const decision = await negotiator.negotiate(
            milestone.id, retryCounter.retries, retryCounter.rescopes,
            config.maxValidatorRetries, config.maxRescopes,
          );

          if (decision.decision === "escalate") {
            const trigger: CheckpointTrigger = "rescope_limit";
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, {});
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary: decision.reason };
          }

          if (decision.decision === "retry") {
            // Reset failed units to "planned" and re-run worker+validator
            const failedIds = decision.failedUnitIds ?? [];
            for (const uid of failedIds) {
              await lapis.updateWorkingUnitStatus(uid, "planned");
            }
            // Reset validator verdicts by creating a fresh contract snapshot
            // Then loop again
            loopActive = true;
            continue;
          }

          if (decision.decision === "rescope") {
            // Re-plan this milestone via PiNyx
            await lapis.updateMilestoneStatus(milestone.id, "in_progress");
            callbacks.onMilestoneProgress(milestone.id, "rescoping", completedCount, units.length);

            const resp = await pinyx.chat({
              model: config.modelHints.orchestrator,
              messages: [
                { role: "system", content: "You are a mission planner. Re-plan this milestone given the validation failures. Respond with JSON: { units: [{ description, declaredPaths, declaredModules }] }" },
                { role: "user", content: `Milestone: ${milestone.title}\nDescription: ${milestone.description}\nFailed units: ${decision.reason}\nMission: ${mission.description}` },
              ],
            });

            try {
              const newPlan = JSON.parse(resp.content) as { units: Array<{ description: string; declaredPaths: string[]; declaredModules: string[] }> };
              // Delete old units and create new ones
              // (LaPis handles this — we just create new units against the same milestone)
              for (const newUnit of newPlan.units) {
                await lapis.createWorkingUnit(milestone.id, newUnit);
              }
            } catch {
              // If re-planning fails, escalate
              const trigger: CheckpointTrigger = "rescope_limit";
              const summary = `Rescope re-planning failed: ${resp.content}`;
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
          } catch (error) {
            const trigger: CheckpointTrigger = "unclassifiable_error";
            const summary = `Integration failed after validation pass: ${error instanceof Error ? error.message : String(error)}`;
            callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, { summary, phase: "integration" });
            return { status: "checkpoint_needed", trigger, milestoneId: milestone.id, summary };
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
