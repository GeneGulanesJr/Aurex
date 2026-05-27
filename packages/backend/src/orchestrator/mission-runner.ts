import type { CheckpointDecision, Milestone } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import type { EventBus } from "../ws/events.js";
import { createCheckpointManager } from "./checkpoint-manager.js";
import { createMilestoneLoop } from "./milestone-loop.js";
import { createPlanner } from "./planner.js";

export interface RunnerStatus {
  state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed";
  missionId: string | null;
}

export interface MissionRunner {
  start(missionId: string): void;
  abort(): void;
  getStatus(): RunnerStatus;
  getActiveMissionId(): string | null;
  waitForCompletion(): Promise<void>;
}

export interface MissionRunnerConfig {
  lapis: LaPisClient;
  pinyx: PinyxClient;
  eventBus: EventBus;
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
}

export function createMissionRunner(config: MissionRunnerConfig): MissionRunner {
  const { lapis, pinyx, eventBus, agentDir, repoRoot, gitMainBranch } = config;
  const checkpointManager = createCheckpointManager(lapis);

  let status: RunnerStatus = { state: "idle", missionId: null };
  let abortController: AbortController | null = null;
  let completionWaiters: Array<() => void> = [];

  function setStatus(state: RunnerStatus["state"], missionId = status.missionId) {
    status = { state, missionId };
  }

  function completeWaiters() {
    const waiters = completionWaiters;
    completionWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function runMission(missionId: string): Promise<void> {
    try {
      setStatus("planning", missionId);
      const mission = await lapis.getMission(missionId);
      const planner = createPlanner(lapis, pinyx, { model: mission.configJson.modelHints.orchestrator });
      const planResult = await planner.plan(mission.description, missionId);

      await lapis.updateMissionStatus(missionId, "running");
      setStatus("executing", missionId);

      const loop = createMilestoneLoop(
        lapis,
        pinyx,
        {
          onEscalation: (mId, trigger, context) => {
            eventBus.emit({ type: "escalation", missionId: mId, trigger, context } as any);
          },
          onAgentStatus: (agentId, agentType, agentStatus, milestoneId) => {
            eventBus.emit({ type: "agent_status", agentId, agentType, status: agentStatus, milestoneId } as any);
          },
          onMilestoneProgress: (milestoneId, milestoneStatus, completedUnits, totalUnits) => {
            eventBus.emit({ type: "milestone_progress", milestoneId, status: milestoneStatus, completedUnits, totalUnits } as any);
          },
          onCostUpdate: (mId, totalCost, totalTokens, delta) => {
            eventBus.emit({ type: "cost_update", missionId: mId, totalCost, totalTokens, delta } as any);
          },
        },
        { agentDir, repoRoot, gitMainBranch },
      );

      const plannedMilestones: Milestone[] = planResult.milestones.map((milestone, index) => ({
        id: milestone.id,
        missionId,
        title: milestone.title,
        description: milestone.title,
        orderIndex: index,
        status: "planned",
        validationContractId: "",
      }));

      const latestMission = await lapis.getMission(missionId);
      const result = await loop.run(latestMission, plannedMilestones);

      if (abortController?.signal.aborted) {
        await lapis.updateMissionStatus(missionId, "aborted");
        setStatus("failed", missionId);
        return;
      }

      if (result.status === "checkpoint_needed") {
        setStatus("waiting_checkpoint", missionId);
        await lapis.updateMissionStatus(missionId, "paused");

        const checkpointId = await checkpointManager.create({
          missionId,
          trigger: result.trigger,
          milestoneId: result.milestoneId,
          summary: result.summary,
        });

        eventBus.emit({
          type: "escalation",
          missionId,
          trigger: { kind: result.trigger, milestoneId: result.milestoneId },
          context: { summary: result.summary, checkpointId },
        } as any);

        const resolved = await checkpointManager.waitForResolution(checkpointId);
        const decision = resolved.decision as CheckpointDecision | undefined;

        if (decision === "reject" || decision === "rescope") {
          await lapis.updateMissionStatus(missionId, decision === "reject" ? "aborted" : "failed");
          setStatus("failed", missionId);
          return;
        }

        await lapis.updateMissionStatus(missionId, "running");
        setStatus("executing", missionId);
      }

      if (result.status === "failed") {
        await lapis.updateMissionStatus(missionId, "failed");
        setStatus("failed", missionId);
        return;
      }

      await lapis.updateMissionStatus(missionId, "completed");
      setStatus("completed", missionId);
    } catch (error) {
      console.error(`[runner] Mission ${missionId} failed:`, error instanceof Error ? error.message : error);
      await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
      setStatus("failed", missionId);
    } finally {
      completeWaiters();
    }
  }

  return {
    start(missionId) {
      if (!["idle", "completed", "failed"].includes(status.state)) {
        throw new Error(`Runner already running (state: ${status.state}, mission: ${status.missionId})`);
      }

      abortController = new AbortController();
      setStatus("planning", missionId);
      void runMission(missionId);
    },

    abort() {
      abortController?.abort();
    },

    getStatus() {
      return { ...status };
    },

    getActiveMissionId() {
      return status.missionId;
    },

    waitForCompletion() {
      if (status.state === "completed" || status.state === "failed") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        completionWaiters.push(resolve);
      });
    },
  };
}
