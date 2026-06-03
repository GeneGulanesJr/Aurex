import type { CheckpointDecision, CheckpointTrigger, Milestone } from "@aurex/shared";
import type { EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, QuotaWindow, QuotaConfig } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { createPinyxClient } from "../clients/pinyx-client.js";
import { createQuotaAwarePinyxClient, QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import type { EventBus } from "../ws/events.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import type { AppConfig } from "../config.js";
import { createCheckpointManager } from "./checkpoint-manager.js";
import { createMilestoneLoop } from "./milestone-loop.js";
import { createPlanner } from "./planner.js";
import { createCompressionService } from "./compression.js";
import { prepareRepoForMission } from "./repo-prep.js";
import { checkQuota, resetWindow } from "../enforcement/quota-gate.js";
import path from "path";

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
  eventBus: EventBus;
  logger?: AgentLogger;
  agentDir: string;
  repoRoot: string;
  gitMainBranch: string;
  onPostMilestoneScan?: (missionId: string, root: string) => Promise<void>;
  quotaEnabled?: boolean;
}

export function createMissionRunner(config: MissionRunnerConfig): MissionRunner {
  const { lapis, eventBus, agentDir, repoRoot, gitMainBranch } = config;
  const checkpointManager = createCheckpointManager(lapis);
  const compression = createCompressionService(lapis, eventBus);

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

  async function resolvePinyx(): Promise<PinyxClient> {
    const saved = await lapis.getSetting<{ endpoint: string }>("pinyx_config");
    if (!saved?.endpoint) throw new Error("PiNyx is not configured. Configure it in the Integrations panel.");
    const inner = createPinyxClient({ endpoint: saved.endpoint });
    return createQuotaAwarePinyxClient(inner, {
      getQuotaConfig: () => lapis.getSetting<QuotaConfig>("quota_config").then((c) => c ?? { enabled: false, windowDurationMs: 5 * 3600_000, burnDurationMs: 3600_000, providers: [] }),
      getQuotaWindow: (providerId) => {
        const all = lapis.getSetting<Record<string, QuotaWindow>>("quota_windows").then((w) => w ?? {});
        return all.then((w) => w[providerId] ?? null);
      },
      saveQuotaWindow: async (providerId, w) => {
        const all = (await lapis.getSetting<Record<string, QuotaWindow>>("quota_windows")) ?? {};
        all[providerId] = w;
        await lapis.setSetting("quota_windows", all);
      },
    });
  }

  async function runMission(missionId: string): Promise<void> {
    try {
      setStatus("planning", missionId);
      const pinyx = await resolvePinyx();
      const mission = await lapis.getMission(missionId);
      eventBus.emit({ type: "mission_log", missionId, phase: "setup", message: `Resolving repo for mission: ${mission.description.slice(0, 80)}…` });
      const { repoPath: missionRepoRoot } = await prepareRepoForMission({ lapis, parentRepoRoot: repoRoot, cloneUrl: mission.configJson.cloneUrl });
      eventBus.emit({ type: "mission_log", missionId, phase: "planning", message: `Calling ${mission.configJson.modelHints.orchestrator} to plan milestones…` });
      // Resolve model: prefer stored hint, but verify it exists in PiNyx.
      // If not found (e.g. kilo/kilo-auto/free with only Z.AI key), discover a working one.
      let model = mission.configJson.modelHints.orchestrator || "kilo/kilo-auto/free";
      try {
        const saved = await lapis.getSetting<{ endpoint: string }>("pinyx_config");
        const endpoint = saved?.endpoint?.replace(/\/$/, "");
        if (endpoint) {
          const res = await fetch(`${endpoint}/v1/models`, { method: "GET", signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const body = await res.json() as { data?: { id: string }[] };
            const available = (body.data ?? []).map((m) => m.id);
            if (!available.includes(model)) {
              const real = available.find((m) => !m.includes("/free"));
              const resolved = real ?? available[0];
              if (resolved && resolved !== model) {
                eventBus.emit({ type: "mission_log", missionId, phase: "planning", message: `Model ${model} not available, using ${resolved}` });
                model = resolved;
              }
            }
          }
        }
      } catch { /* discovery failed, use configured model */ }

      eventBus.emit({ type: "mission_log", missionId, phase: "planning", message: `Calling ${model} to plan milestones…` });
      const planner = createPlanner(lapis, pinyx, { model, eventBus, missionId });

      // Index repo before planning so the planner has code context
      try {
        const repoName = path.basename(missionRepoRoot);
        eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing repo ${repoName} for code context…` });
        const indexResult = await lapis.indexRepo(missionRepoRoot, repoName);
        if (indexResult.error) {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing warning: ${indexResult.error}` });
        } else {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexed ${indexResult.files ?? 0} files, ${indexResult.symbols ?? 0} symbols`, data: { indexingDone: true, files: indexResult.files ?? 0, symbols: indexResult.symbols ?? 0, edges: (indexResult as any).import_edges ?? 0 } });
          // Store repo name for code context proxy
          await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing skipped: ${msg}` });
      }

      const planResult = await planner.plan(mission.description, missionId).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        eventBus.emit({ type: "mission_error", missionId, code: "planner_failed", message: `Planning failed: ${msg}`, recoverable: true });
        await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
        setStatus("failed", missionId);
        return null;
      });
      if (!planResult) return;

      await lapis.updateMissionStatus(missionId, "running");
      setStatus("executing", missionId);

      const loop = createMilestoneLoop(
        lapis,
        pinyx,
        {
          onEscalation: (mId, trigger, context) => {
            const summary = "summary" in context && typeof context.summary === "string"
              ? context.summary
              : `Escalation: ${trigger.kind}`;
            eventBus.emit({ type: "mission_log", missionId: mId, phase: "escalation", message: summary, data: { trigger, context } });
          },
          onAgentStatus: (agentId, agentType, agentStatus, milestoneId, workerSnapshot) => {
            eventBus.emit({ type: "agent_status", agentId, agentType: agentType as AgentType, status: agentStatus as AgentStatus, milestoneId, workerSnapshot });
          },
          onMilestoneProgress: (milestoneId, milestoneStatus, completedUnits, totalUnits) => {
            eventBus.emit({ type: "milestone_progress", milestoneId, status: milestoneStatus as MilestoneStatus, completedUnits, totalUnits });
          },
          onCostUpdate: (mId, totalCost, totalTokens, delta) => {
            eventBus.emit({ type: "cost_update", missionId: mId, totalCost, totalTokens, delta });
            if (mission.configJson.costCap > 0 && totalCost >= mission.configJson.costCap * 0.8) {
              compression.run(mId, "budget_threshold" as any).catch(() => {});
            }
          },
          onError: (mId, code, message, opts) => {
            eventBus.emit({ type: "mission_error", missionId: mId, code, message, workerId: opts?.workerId, milestoneId: opts?.milestoneId, recoverable: opts?.recoverable ?? false, details: opts?.details });
          },
        },
        { agentDir, repoRoot: missionRepoRoot, gitMainBranch, eventBus, logger: config.logger, onCompression: (mId, trigger) => compression.run(mId, trigger), onPostMilestoneScan: config.onPostMilestoneScan },
      );

      // Use milestones from the plan result directly — they were just created
      // in LaPis by the planner, so we already have their IDs and titles.
      // (Avoids GET /missions/:id/milestones which may not exist in LaPis.)
      const contractLookup = new Map<string, string>();
      for (const ms of planResult.milestones) {
        const contracts = await lapis.getContractHistory(ms.id).catch(() => [] as any[]);
        const latest = contracts.reduce(
          (a: any, b: any) => ((b as any).version > (a as any).version ? b : a),
          contracts[0],
        );
        if (latest) contractLookup.set(ms.id, (latest as any).id);
      }
      const plannedMilestones: Milestone[] = planResult.milestones.map((ms, i) => ({
        id: ms.id,
        missionId,
        title: ms.title,
        description: ms.title,
        orderIndex: i,
        status: "planned" as const,
        validationContractId: contractLookup.get(ms.id) ?? "",
      }));

      // Run milestone loop — handles checkpoint_needed by re-running
      let currentMilestones = plannedMilestones;
      let costCapApproved = false;
      let refreshedMission = await lapis.getMission(missionId);
      let loopResult = await loop.run(refreshedMission, currentMilestones, abortController?.signal);

      while (loopResult.status === "checkpoint_needed") {
        if (abortController?.signal.aborted) {
          await lapis.updateMissionStatus(missionId, "aborted");
          setStatus("failed", missionId);
          return;
        }

        setStatus("waiting_checkpoint", missionId);
        await lapis.updateMissionStatus(missionId, "paused");

        const checkpointId = await checkpointManager.create({
          missionId,
          trigger: loopResult.trigger,
          milestoneId: loopResult.milestoneId,
          summary: loopResult.summary,
        });

        eventBus.emit({
          type: "escalation",
          missionId,
          checkpointId,
          trigger: { kind: loopResult.trigger, milestoneId: loopResult.milestoneId } as EscalationTrigger,
          context: { summary: loopResult.summary } as EscalationContext,
        });

        const resolved = await checkpointManager.waitForResolution(checkpointId);
        const decision = resolved.decision as CheckpointDecision | undefined;

        if (decision === "reject" || decision === "rescope") {
          await lapis.updateMissionStatus(missionId, decision === "reject" ? "aborted" : "failed");
          setStatus("failed", missionId);
          return;
        }

        const cpResult = loopResult as { status: "checkpoint_needed"; trigger: CheckpointTrigger; milestoneId: string; summary: string };

        // For milestone_complete: mark the milestone done, then continue.
        // For cost_cap_exceeded: approval means continue this mission run over budget.
        if (cpResult.trigger === "milestone_complete") {
          await lapis.updateMilestoneStatus(cpResult.milestoneId, "completed");
          currentMilestones = currentMilestones.map((ms) =>
            ms.id === cpResult.milestoneId ? { ...ms, status: "completed" as const } : ms,
          );
        }
        if (cpResult.trigger === "cost_cap_exceeded") {
          costCapApproved = true;
        }

        await lapis.updateMissionStatus(missionId, "running");
        setStatus("executing", missionId);

        // Re-run loop with updated milestones (completed ones are skipped)
        const baseMission = await lapis.getMission(missionId);
        const nextMission = costCapApproved
          ? { ...baseMission, configJson: { ...baseMission.configJson, costCap: 0 } }
          : baseMission;
        loopResult = await loop.run(nextMission, currentMilestones, abortController?.signal);
      }

      if (loopResult.status === "failed") {
        await lapis.updateMissionStatus(missionId, "failed");
        setStatus("failed", missionId);
        return;
      }

      await lapis.updateMissionStatus(missionId, "completed");
      setStatus("completed", missionId);
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        const currentMilestoneId = status.missionId
          ? (await lapis.getMilestonesForMission(status.missionId).catch(() => [] as Milestone[])).find(
              (m) => m.status === "in_progress" || m.status === "validating",
            )?.id ?? ""
          : "";

        setStatus("waiting_checkpoint", missionId);
        await lapis.updateMissionStatus(missionId, "paused");

        const checkpointId = await checkpointManager.create({
          missionId,
          trigger: "quota_exhausted",
          milestoneId: currentMilestoneId,
          summary: `Quota exhausted for provider ${error.providerId}. Window resets at ${error.windowResetsAt}`,
        });

        eventBus.emit({
          type: "quota_exhausted" as any,
          providerId: error.providerId,
          windowResetsAt: error.windowResetsAt,
        } as any);

        eventBus.emit({
          type: "escalation",
          missionId,
          checkpointId,
          trigger: { kind: "quota_exhausted", milestoneId: currentMilestoneId, windowResetsAt: error.windowResetsAt } as EscalationTrigger,
          context: { summary: `Quota exhausted for provider ${error.providerId}. Window resets at ${error.windowResetsAt}` } as EscalationContext,
        });

        const resolved = await checkpointManager.waitForResolution(checkpointId);
        const decision = resolved.decision as CheckpointDecision | undefined;

        if (decision === "reject") {
          await lapis.updateMissionStatus(missionId, "aborted");
          setStatus("failed", missionId);
          return;
        }

        const allWindows = (await lapis.getSetting<Record<string, QuotaWindow>>("quota_windows")) ?? {};
        const providerWindow = allWindows[error.providerId];
        if (providerWindow) {
          allWindows[error.providerId] = resetWindow(providerWindow, new Date());
          await lapis.setSetting("quota_windows", allWindows);
        }

        await lapis.updateMissionStatus(missionId, "running");
        setStatus("executing", missionId);
        void runMission(missionId);
        return;
      }

      console.error(`[runner] Mission ${missionId} failed:`, error instanceof Error ? error.message : error);
      const msg = error instanceof Error ? error.message : String(error);
      eventBus.emit({ type: "mission_error", missionId, code: "mission_crash", message: `Mission crashed: ${msg}`, recoverable: false });
      await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
      setStatus("failed", missionId);
    } finally {
      completeWaiters();
    }
  }

  return {
    start(missionId) {
      if (!["idle", "completed", "failed"].includes(status.state)) {
        return;
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
