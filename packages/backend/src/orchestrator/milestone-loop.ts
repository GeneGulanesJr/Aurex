// packages/backend/src/orchestrator/milestone-loop.ts
import type { CheckpointTrigger, Mission, Milestone, WorkingUnit } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { createNegotiator } from "./negotiator.js";
import { createWorktreeManager } from "./worktree.js";
import { checkPreSpawnOverlap } from "./overlap.js";
import { createAgentSpawner } from "../agents/agent-spawner.js";
import { buildWorkerContext } from "../agents/context-builder.js";

export type MilestoneLoopResult =
  | { status: "completed" }
  | { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string }
  | { status: "failed"; reason: string };

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: unknown, context: unknown) => void;
  onAgentStatus: (agentId: string, agentType: unknown, status: unknown, milestoneId: string) => void;
  onMilestoneProgress: (milestoneId: string, status: unknown, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export interface MilestoneLoopConfig {
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
  loopConfig: MilestoneLoopConfig,
) {
  const worktreeManager = createWorktreeManager(loopConfig.repoRoot);
  const spawner = createAgentSpawner({
    lapis,
    agentDir: loopConfig.agentDir,
    defaultTimeout: 120_000,
  });

  return {
    async run(mission: Mission, milestones: Milestone[]): Promise<MilestoneLoopResult> {
      const config = mission.configJson;
      const negotiator = createNegotiator(lapis);

      for (const milestone of milestones) {
        if (milestone.status === "completed") continue;

        // Update milestone status
        await lapis.updateMilestoneStatus(milestone.id, "in_progress");
        callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);

        // Get working units for this milestone
        const units = await lapis.getWorkingUnitsForMilestone(milestone.id);

        // Get contract for context building
        const contracts = await lapis.getContractHistory(milestone.id);
        const contract = contracts[0] as any;

        let completedCount = 0;
        let failedCount = 0;

        for (const unit of units) {
          if (unit.status === "completed") {
            completedCount++;
            continue;
          }

          // Pre-spawn overlap check
          const activeUnits = units.filter(
            (u) => u.status === "working" || u.status === "spawned",
          );
          const overlap = checkPreSpawnOverlap(
            { declaredPaths: unit.declaredPaths, declaredModules: unit.declaredModules },
            activeUnits,
          );
          if (overlap.overlap) {
            // Skip for now — will be picked up in next iteration
            continue;
          }

          // Create worktree for isolation
          const agentId = `worker-${unit.id}`;
          const { worktreePath, taskBranch } = await worktreeManager.createWorktree(
            agentId,
            unit.id,
            loopConfig.gitMainBranch,
          );

          // Build context
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

          // Determine timeout based on complexity (default: simple)
          const timeout = config.workerTimeouts.simple;

          // Spawn worker
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
            timeout,
          });

          callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);

          // Wait for completion
          const result = await handle.completed;

          if (result.status === "completed") {
            await lapis.updateWorkingUnitStatus(unit.id, "completed");
            callbacks.onAgentStatus(agentId, "worker", "completed", milestone.id);
            completedCount++;
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

          callbacks.onMilestoneProgress(
            milestone.id,
            "in_progress",
            completedCount,
            units.length,
          );
        }

        // --- VALIDATOR PHASE ---
        // After all workers complete, spawn a validator pair
        if (failedCount === 0 && completedCount > 0) {
          await lapis.updateMilestoneStatus(milestone.id, "validating");
          callbacks.onMilestoneProgress(milestone.id, "validating", completedCount, units.length);

          const validatorSkill = `${loopConfig.repoRoot}/packages/backend/src/skills/validator.md`;
          const validatorCwd = loopConfig.repoRoot; // validators don't need worktrees — read-only
          const contractId = contract?.id ?? "";

          const validatorTypes: Array<"validator_scrutiny" | "validator_user_testing"> = ["validator_scrutiny", "validator_user_testing"];
          const validatorHandles = await Promise.all(
            validatorTypes.map(async (vType) => {
              const vAgentId = `validator-${vType}-${milestone.id}`;
              callbacks.onAgentStatus(vAgentId, vType, "spawned", milestone.id);

              const vContext = {
                missionDescription: mission.description,
                milestoneTitle: milestone.title,
                milestoneDescription: milestone.description,
                unitDescription: `Validate milestone: ${milestone.title}`,
                unitDeclaredPaths: [],
                unitDeclaredModules: [],
                contractCriteria: contract?.content?.criteria ?? [],
                testCommands: contract?.content?.testCommands ?? [],
              };

              const handle = await spawner.spawn({
                agentType: vType,
                unitId: milestone.id, // milestone-level, not unit-level
                missionId: mission.id,
                milestoneId: milestone.id,
                cwd: validatorCwd,
                skillFilePath: validatorSkill,
                contextContent: buildWorkerContext(vContext), // reuse context builder for contract info
                taskPrompt: `Validate milestone "${milestone.title}" against contract. You are a ${vType === "validator_scrutiny" ? "Scrutiny" : "User-Testing"} validator. Follow your skill instructions.`,
                timeout: config.workerTimeouts.build, // use build timeout for validators
                validatorContext: {
                  milestoneId: milestone.id,
                  contractId,
                  validatorType: vType,
                  sessionId: "", // will be set by spawner after session creation
                },
              });

              callbacks.onAgentStatus(vAgentId, vType, "working", milestone.id);
              return { vType, vAgentId, handle };
            }),
          );

          // Wait for all validators to complete
          for (const { vType, vAgentId, handle } of validatorHandles) {
            const vResult = await handle.completed;
            if (vResult.status === "completed") {
              callbacks.onAgentStatus(vAgentId, vType, "completed", milestone.id);
            } else {
              callbacks.onAgentStatus(vAgentId, vType, vResult.status === "timed_out" ? "timed_out" : "failed", milestone.id);
            }
            handle.dispose();
          }
        }

        // Negotiate verdicts
        const retryCounter = await lapis.incrementRetry(milestone.id);
        const decision = await negotiator.negotiate(
          milestone.id,
          retryCounter.retries,
          retryCounter.rescopes,
          config.maxValidatorRetries,
          config.maxRescopes,
        );

        if (decision.decision === "escalate") {
          const trigger: CheckpointTrigger = "rescope_limit";
          callbacks.onEscalation(mission.id, { kind: trigger, milestoneId: milestone.id }, {});
          return {
            status: "checkpoint_needed",
            trigger,
            milestoneId: milestone.id,
            summary: decision.reason,
          };
        }

        if (decision.decision === "pass") {
          await lapis.updateMilestoneStatus(milestone.id, "completed");
          callbacks.onMilestoneProgress(milestone.id, "completed", completedCount, units.length);
        }
      }

      await lapis.updateMissionStatus(mission.id, "completed");
      return { status: "completed" };
    },
  };
}
