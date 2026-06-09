import type { CheckpointTrigger, Milestone } from "@aurex/shared";
import type { EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, QuotaWindow, QuotaConfig } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { createPinyxClient } from "../clients/pinyx-client.js";
import { createQuotaAwarePinyxClient, QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import type { EventBus } from "../ws/events.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import { createCheckpointManager } from "./checkpoint-manager.js";
import { createMilestoneLoop } from "./milestone-loop.js";
import { createPlanner, type CodeSummary } from "./planner.js";
import { createCompressionService } from "./compression.js";
import { prepareRepoForMission } from "./repo-prep.js";
import { runCheckpointLoop, type CheckpointLoopDeps } from "./checkpoint-loop.js";
import { resetWindow } from "../enforcement/quota-gate.js";
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
  aurexRoot: string;
  gitMainBranch: string;
  onPostMilestoneScan?: (missionId: string, root: string) => Promise<void>;
}

const MAX_REENTRY = 3;

export function createMissionRunner(config: MissionRunnerConfig): MissionRunner {
  const { lapis, eventBus, agentDir, repoRoot, aurexRoot, gitMainBranch } = config;
  const checkpointManager = createCheckpointManager(lapis);
  const compression = createCompressionService(lapis, eventBus);

  let status: RunnerStatus = { state: "idle", missionId: null };
  let abortController: AbortController | null = null;
  let completionWaiters: Array<() => void> = [];
  let reentryCount = 0;

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
    reentryCount++;
    if (reentryCount > MAX_REENTRY) {
      const msg = `Mission runner exceeded max re-entry attempts (${MAX_REENTRY}). Last trigger: quota exhaustion loop.`;
      eventBus.emit({ type: "mission_error", missionId, code: "runner_reentry_limit", message: msg, recoverable: false });
      await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
      setStatus("failed", missionId);
      eventBus.emit({ type: "mission_status", missionId, status: "failed" });
      return;
    }

    let loop: ReturnType<typeof createMilestoneLoop> | null = null;
    let currentMilestones: Milestone[] = [];
    let costCapApproved = false;

    try {
      setStatus("planning", missionId);
      const pinyx = await resolvePinyx();
      const mission = await lapis.getMission(missionId);
      eventBus.emit({ type: "mission_log", missionId, phase: "setup", message: `Resolving repo for mission: ${mission.description.slice(0, 80)}…` });
      const { repoPath: missionRepoRoot } = await prepareRepoForMission({ lapis, parentRepoRoot: repoRoot, cloneUrl: mission.configJson.cloneUrl });
      eventBus.emit({ type: "mission_log", missionId, phase: "planning", message: `Calling ${mission.configJson.modelHints.orchestrator} to plan milestones…` });
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

      let codeSummary: CodeSummary | undefined;
      try {
        const repoName = path.basename(missionRepoRoot);
        const existingSummary = await lapis.getCodeSummary(repoName).catch(() => null);
        if (existingSummary && existingSummary.files > 0) {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Repo ${repoName} already indexed (${existingSummary.files} files), skipping…` });
          await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
          codeSummary = existingSummary;
        } else {
          eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing repo ${repoName} for code context…` });
          const indexResult = await lapis.indexRepo(missionRepoRoot, repoName);
          if (indexResult.error) {
            eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing warning: ${indexResult.error}` });
          } else {
            eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexed ${indexResult.files ?? 0} files, ${indexResult.symbols ?? 0} symbols`, data: { indexingDone: true, files: indexResult.files ?? 0, symbols: indexResult.symbols ?? 0, edges: (indexResult as any).import_edges ?? 0 } });
            await lapis.setSetting(`mission:${missionId}:repoName`, repoName);
            codeSummary = await lapis.getCodeSummary(repoName).catch(() => undefined);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing skipped: ${msg}` });
      }

      const planner = createPlanner(lapis, pinyx, { model, eventBus, missionId, codeSummary });

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
      eventBus.emit({ type: "mission_status", missionId, status: "running" });

      loop = createMilestoneLoop(
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
        { agentDir, repoRoot: missionRepoRoot, aurexRoot, gitMainBranch, eventBus, logger: config.logger, onCompression: (mId, trigger) => compression.run(mId, trigger), onPostMilestoneScan: config.onPostMilestoneScan },
      );

      const contractLookup = new Map<string, string>();
      for (const ms of planResult.milestones) {
        const contracts = await lapis.getContractHistory(ms.id).catch(() => [] as any[]);
        const latest = contracts.reduce(
          (a: any, b: any) => ((b as any).version > (a as any).version ? b : a),
          contracts[0],
        );
        if (latest) contractLookup.set(ms.id, (latest as any).id);
      }
      currentMilestones = planResult.milestones.map((ms, i) => ({
        id: ms.id,
        missionId,
        title: ms.title,
        description: ms.description,
        orderIndex: i,
        status: "planned" as const,
        validationContractId: contractLookup.get(ms.id) ?? "",
      }));
      eventBus.emit({ type: "milestones_set", missionId, milestones: currentMilestones });

      // --- Shared checkpoint loop (happy path) ---
      const checkpointDeps: CheckpointLoopDeps = { checkpointManager, lapis, pinyx, eventBus, setStatus };
      const refreshedMission = await lapis.getMission(missionId);
      const result = await runCheckpointLoop(loop, {
        missionId,
        mission: refreshedMission,
        milestones: currentMilestones,
        signal: abortController?.signal,
        costCapApproved,
      }, checkpointDeps);

      currentMilestones = result.milestones;
      costCapApproved = result.costCapApproved;
      setStatus(result.status === "completed" ? "completed" : "failed", missionId);
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        const currentMilestoneId = status.missionId
          ? (await lapis.getMilestonesForMission(status.missionId).catch(() => [] as Milestone[])).find(
              (m) => m.status === "in_progress" || m.status === "validating",
            )?.id ?? ""
          : "";

        setStatus("waiting_checkpoint", missionId);
        await lapis.updateMissionStatus(missionId, "paused");
        eventBus.emit({ type: "mission_status", missionId, status: "paused" });

        const cpId = await checkpointManager.create({
          missionId,
          trigger: "quota_exhausted" as CheckpointTrigger,
          milestoneId: currentMilestoneId,
          summary: `Quota exhausted for provider ${error.providerId}. Window resets at ${error.windowResetsAt}`,
        });

        eventBus.emit({
          type: "quota_exhausted",
          providerId: error.providerId,
          windowResetsAt: error.windowResetsAt,
        });

        eventBus.emit({
          type: "escalation",
          missionId,
          checkpointId: cpId,
          trigger: { kind: "quota_exhausted", milestoneId: currentMilestoneId, windowResetsAt: error.windowResetsAt } as EscalationTrigger,
          context: { summary: `Quota exhausted for provider ${error.providerId}. Window resets at ${error.windowResetsAt}` } as EscalationContext,
        });

        const resolved = await checkpointManager.waitForResolution(cpId);

        if (resolved.decision === "reject") {
          await lapis.updateMissionStatus(missionId, "aborted");
          setStatus("failed", missionId);
          eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
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
        eventBus.emit({ type: "mission_status", missionId, status: "running" });

        if (loop && currentMilestones.length > 0) {
          // Re-use the shared checkpoint loop after quota recovery
          const pinyx = await resolvePinyx();
          const refreshedMission = await lapis.getMission(missionId);
          const result = await runCheckpointLoop(loop, {
            missionId,
            mission: refreshedMission,
            milestones: currentMilestones,
            signal: abortController?.signal,
            costCapApproved,
          }, { checkpointManager, lapis, pinyx, eventBus, setStatus });

          currentMilestones = result.milestones;
          costCapApproved = result.costCapApproved;
          setStatus(result.status === "completed" ? "completed" : "failed", missionId);
        } else {
          // No loop exists yet — re-enter planning from scratch (guarded)
          void runMission(missionId);
          return;
        }
      } else {
        console.error(`[runner] Mission ${missionId} failed:`, error instanceof Error ? error.message : error);
        const msg = error instanceof Error ? error.message : String(error);
        eventBus.emit({ type: "mission_error", missionId, code: "mission_crash", message: `Mission crashed: ${msg}`, recoverable: false });
        await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
        setStatus("failed", missionId);
        eventBus.emit({ type: "mission_status", missionId, status: "failed" });
      }
    } finally {
      reentryCount = 0;
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
