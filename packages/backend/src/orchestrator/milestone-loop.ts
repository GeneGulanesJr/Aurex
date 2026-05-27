// packages/backend/src/orchestrator/milestone-loop.ts
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";
import { createNegotiator } from "./negotiator";
import { createWorktreeManager } from "./worktree";
import { checkPreSpawnOverlap } from "./overlap";
import { createAgentSpawner } from "../agents/agent-spawner";
import { buildWorkerContext } from "../agents/context-builder";

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
    async run(mission: Mission, milestones: Milestone[]): Promise<boolean> {
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
          callbacks.onEscalation(mission.id, { kind: "rescope_limit", milestoneId: milestone.id }, {});
          return false;
        }

        if (decision.decision === "pass") {
          await lapis.updateMilestoneStatus(milestone.id, "completed");
          callbacks.onMilestoneProgress(milestone.id, "completed", completedCount, units.length);
        }
      }

      await lapis.updateMissionStatus(mission.id, "completed");
      return true;
    },
  };
}
