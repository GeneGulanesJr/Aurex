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
import { createPlanner, type CodeSummary, type CodeGraphSummary, type CodeHotspotsSummary } from "./planner.js";
import { optimizeMissionPrompt } from "./prompt-optimizer.js";
import { createCompressionService } from "./compression.js";
import { prepareRepoForMission } from "./repo-prep.js";
import { runCheckpointLoop, type CheckpointLoopDeps } from "./checkpoint-loop.js";
import { resetWindow } from "../enforcement/quota-gate.js";
import type { ExecutionQueueStore } from "../queue/execution-queue-store.js";
import path from "path";

export interface RunnerStatus {
  state: "idle" | "planning" | "executing" | "waiting_checkpoint" | "completed" | "failed" | "aborted";
  missionId: string | null;
}

export interface MissionRunner {
  start(missionId: string): void;
  abort(): void;
  getStatus(): RunnerStatus;
  getActiveMissionId(): string | null;
  waitForCompletion(): Promise<void>;
}

/** A claimed execution-queue job whose lifetime this runner mirrors. */
export interface RunnerJobHandle {
  jobId: string;
  claimToken: string;
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
  /** Hard timeout (ms) for research agent sessions (RESEARCH_TIMEOUT). */
  researchTimeout?: number;
  /** Hard timeout (ms) for validator agent sessions (VALIDATOR_TIMEOUT). */
  validatorTimeout?: number;
  /**
   * When provided alongside {@link job}, the runner mirrors the execution-queue
   * job's lifetime: it heartbeats periodically while running and
   * completes/fails the job when the mission reaches a terminal state. When
   * omitted, the runner operates exactly as before (no queue interaction).
   */
  queue?: ExecutionQueueStore;
  /** A pre-claimed execution-queue job this runner owns. */
  job?: RunnerJobHandle;
}

const MAX_REENTRY = 3;

/**
 * Sentinel thrown by {@link planAndBuild} when the planner reports a failure.
 * The error + status update have already been emitted at that point, so the
 * outer catch must recognize this and exit silently instead of emitting a
 * duplicate `mission_crash`.
 */
const PLANNER_FAILED = Symbol("planner_failed");

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

  // --- Execution-queue job lifecycle mirroring (durability) ---
  const HEARTBEAT_INTERVAL_MS = 60_000;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startHeartbeat() {
    if (!config.queue || !config.job) return;
    stopHeartbeat();
    const { jobId, claimToken } = config.job;
    heartbeatTimer = setInterval(() => {
      config.queue!.heartbeat(jobId, claimToken).catch((err: unknown) => {
        console.warn("[runner] heartbeat failed:", err instanceof Error ? err.message : err);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /** Map the runner's terminal state to a queue complete/fail and clean up. */
  async function finalizeJob(finalState: RunnerStatus["state"]): Promise<void> {
    stopHeartbeat();
    if (!config.queue || !config.job) return;
    const { jobId, claimToken } = config.job;
    try {
      if (finalState === "completed") {
        await config.queue.complete(jobId, claimToken);
      } else {
        // failed, aborted — and any non-terminal remainder (shouldn't happen
        // at finalization, but fail defensively).
        const code = finalState === "aborted" ? "MISSION_ABORTED" : "MISSION_FAILED";
        const msg = finalState === "aborted" ? "Mission aborted by user" : `Mission ended in state: ${finalState}`;
        await config.queue.fail(jobId, claimToken, code, msg);
      }
    } catch (err) {
      console.warn("[runner] job finalization failed:", err instanceof Error ? err.message : err);
    }
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
      onQuotaUpdate: (event) => eventBus.emit(event),
    });
  }

  function throwIfAborted(): void {
    if (abortController?.signal.aborted) {
      throw new Error("Mission aborted");
    }
  }

  function createLoopForMission(
    pinyx: PinyxClient,
    missionId: string,
    missionRepoRoot: string,
    mission: Awaited<ReturnType<LaPisClient["getMission"]>>,
  ) {
    return createMilestoneLoop(
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
      { agentDir, repoRoot: missionRepoRoot, aurexRoot, gitMainBranch, eventBus, logger: config.logger, onCompression: (mId, trigger) => compression.run(mId, trigger), onPostMilestoneScan: config.onPostMilestoneScan, researchTimeout: config.researchTimeout, validatorTimeout: config.validatorTimeout },
    );
  }

  async function buildMilestonesFromPlan(
    missionId: string,
    planMilestones: Array<{ id: string; title: string; description: string }>,
    existingMilestones?: Milestone[],
  ): Promise<Milestone[]> {
    const contractLookup = new Map<string, string>();
    for (const ms of planMilestones) {
      const contracts = await lapis.getContractHistory(ms.id).catch(() => [] as any[]);
      const latest = contracts.reduce(
        (a: any, b: any) => ((b as any).version > (a as any).version ? b : a),
        contracts[0],
      );
      if (latest) contractLookup.set(ms.id, (latest as any).id);
    }
    const milestones = planMilestones.map((ms, i) => {
      const existing = existingMilestones?.find((m) => m.id === ms.id);
      return {
        id: ms.id,
        missionId,
        title: ms.title,
        description: ms.description,
        orderIndex: existing?.orderIndex ?? i,
        status: existing?.status ?? ("planned" as const),
        validationContractId: contractLookup.get(ms.id) ?? existing?.validationContractId ?? "",
      };
    });
    eventBus.emit({ type: "milestones_set", missionId, milestones });
    return milestones;
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

    try {
      setStatus("planning", missionId);

      // --- Planning phase with inline quota recovery ---
      // If quota is exhausted during planning (before the loop exists), recover
      // and retry planning inline rather than void-re-entering (which defeated
      // the reentryCount guard via finally resetting it to 0).
      let planOutcome: { loop: ReturnType<typeof createMilestoneLoop>; milestones: Milestone[] };
      for (;;) {
        try {
          planOutcome = await planAndBuild(missionId);
          break;
        } catch (err) {
          if (!(err instanceof QuotaExhaustedError)) throw err;
          reentryCount++;
          if (reentryCount > MAX_REENTRY) throw err;
          const approved = await recoverFromQuota(missionId, err);
          if (!approved) {
            await lapis.updateMissionStatus(missionId, "aborted");
            setStatus("aborted", missionId);
            eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
            return;
          }
          setStatus("planning", missionId);
        }
      }

      const { loop, milestones: currentMilestones } = planOutcome;
      await lapis.updateMissionStatus(missionId, "running");
      setStatus("executing", missionId);
      eventBus.emit({ type: "mission_status", missionId, status: "running" });
      startHeartbeat();

      // --- Execution phase with inline quota recovery ---
      // Previously the second runCheckpointLoop call lived inside the catch
      // block, so a second QuotaExhaustedError escaped as an unhandled
      // rejection. Now both calls are inside the same protected retry loop.
      let costCapApproved = false;
      let pinyx = await resolvePinyx();
      for (;;) {
        try {
          const checkpointDeps: CheckpointLoopDeps = { checkpointManager, lapis, pinyx, eventBus, setStatus };
          const refreshedMission = await lapis.getMission(missionId);
          const result = await runCheckpointLoop(loop, {
            missionId,
            mission: refreshedMission,
            milestones: currentMilestones,
            signal: abortController?.signal,
            costCapApproved,
          }, checkpointDeps);
          currentMilestones.length = 0;
          currentMilestones.push(...result.milestones);
          costCapApproved = result.costCapApproved;
          setStatus(result.status === "completed" ? "completed" : "failed", missionId);
          break;
        } catch (err) {
          if (!(err instanceof QuotaExhaustedError)) throw err;
          reentryCount++;
          if (reentryCount > MAX_REENTRY) throw err;
          const approved = await recoverFromQuota(missionId, err);
          if (!approved) {
            await lapis.updateMissionStatus(missionId, "aborted");
            setStatus("aborted", missionId);
            eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
            return;
          }
          // Re-resolve pinyx (quota window was reset) before retrying.
          pinyx = await resolvePinyx();
          await lapis.updateMissionStatus(missionId, "running");
          setStatus("executing", missionId);
          eventBus.emit({ type: "mission_status", missionId, status: "running" });
        }
      }
    } catch (error) {
      if (error === PLANNER_FAILED) {
        // Planner already emitted its own error + set status to failed.
        // Nothing more to do here.
      } else if (error instanceof QuotaExhaustedError) {
        const msg = `Mission ${missionId} exhausted quota recovery budget (${MAX_REENTRY}).`;
        eventBus.emit({ type: "mission_error", missionId, code: "runner_reentry_limit", message: msg, recoverable: false });
        await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
        setStatus("failed", missionId);
        eventBus.emit({ type: "mission_status", missionId, status: "failed" });
      } else if (error instanceof Error && error.message === "Mission aborted") {
        await lapis.updateMissionStatus(missionId, "aborted").catch(() => {});
        setStatus("aborted", missionId);
        eventBus.emit({ type: "mission_status", missionId, status: "aborted" });
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
      await finalizeJob(status.state);
      completeWaiters();
    }
  }

  /**
   * Resolve pinyx, fetch the mission, prepare the repo, index code, plan
   * milestones, and build the milestone loop. Throws QuotaExhaustedError if
   * quota is hit during planning; the caller recovers and retries.
   */
  async function planAndBuild(missionId: string): Promise<{ loop: ReturnType<typeof createMilestoneLoop>; milestones: Milestone[] }> {
    throwIfAborted();
    const pinyx = await resolvePinyx();
    throwIfAborted();
    const mission = await lapis.getMission(missionId);
    eventBus.emit({ type: "mission_log", missionId, phase: "setup", message: `Resolving repo for mission: ${mission.description.slice(0, 80)}…` });
    const { repoPath: missionRepoRoot } = await prepareRepoForMission({ lapis, parentRepoRoot: repoRoot, cloneUrl: mission.configJson.cloneUrl });
    throwIfAborted();

    const existingMilestones = await lapis.getMilestonesForMission(missionId).catch(() => [] as Milestone[]);
    if (existingMilestones.length > 0) {
      eventBus.emit({
        type: "mission_log",
        missionId,
        phase: "planning",
        message: `Resuming mission with ${existingMilestones.length} existing milestone(s) — skipping re-plan.`,
      });
      const loop = createLoopForMission(pinyx, missionId, missionRepoRoot, mission);
      const milestones = await buildMilestonesFromPlan(
        missionId,
        existingMilestones.map((ms) => ({ id: ms.id, title: ms.title, description: ms.description })),
        existingMilestones,
      );
      return { loop, milestones };
    }

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
    let codeGraph: CodeGraphSummary | undefined;
    let codeHotspots: CodeHotspotsSummary | undefined;
    try {
      const repoName = path.basename(missionRepoRoot);
      const existingSummary = await lapis.getCodeSummary(repoName).catch(() => null);
      if (existingSummary && existingSummary.files > 0) {
        eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Repo ${repoName} already indexed (${existingSummary.files} files), skipping…`, data: { indexingDone: true, files: existingSummary.files, symbols: existingSummary.symbols ?? 0, edges: (existingSummary as any).import_edges ?? 0 } });
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
      if (codeSummary) {
        const [graphRes, hotspotsRes] = await Promise.all([
          lapis.getCodeGraph(repoName).catch(() => undefined),
          lapis.getCodeHotspots(repoName).catch(() => undefined),
        ]);
        codeGraph = graphRes;
        codeHotspots = hotspotsRes;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      eventBus.emit({ type: "mission_log", missionId, phase: "indexing", message: `Indexing skipped: ${msg}` });
    }

    const planner = createPlanner(lapis, pinyx, { model, eventBus, missionId, codeSummary, codeGraph, codeHotspots, maxMilestones: mission.configJson.maxMilestones, maxUnitsPerMilestone: mission.configJson.maxUnitsPerMilestone });

    const refinedDescription = await optimizeMissionPrompt(pinyx, mission.description, { model, eventBus, missionId });
    throwIfAborted();
    if (refinedDescription !== mission.description) {
      eventBus.emit({ type: "mission_log", missionId, phase: "planning", message: `Mission prompt optimized (${mission.description.length} → ${refinedDescription.length} chars).` });
    }

    const planResult = await planner.plan(refinedDescription, missionId).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      eventBus.emit({ type: "mission_error", missionId, code: "planner_failed", message: `Planning failed: ${msg}`, recoverable: true });
      await lapis.updateMissionStatus(missionId, "failed").catch(() => {});
      setStatus("failed", missionId);
      return null;
    });
    if (!planResult) throw PLANNER_FAILED;

    const loop = createLoopForMission(pinyx, missionId, missionRepoRoot, mission);
    const milestones = await buildMilestonesFromPlan(missionId, planResult.milestones);
    return { loop, milestones };
  }

  /**
   * Create a quota-exhaustion checkpoint, wait for the user's decision, reset
   * the provider's quota window, and pause the mission. Returns `true` if the
   * user approved (continue), `false` if rejected (abort).
   */
  async function recoverFromQuota(missionId: string, error: QuotaExhaustedError): Promise<boolean> {
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

    const resolved = await checkpointManager.waitForResolution(cpId, abortController?.signal);

    if (resolved.decision === "reject") {
      return false;
    }

    const allWindows = (await lapis.getSetting<Record<string, QuotaWindow>>("quota_windows")) ?? {};
    const providerWindow = allWindows[error.providerId];
    if (providerWindow) {
      allWindows[error.providerId] = resetWindow(providerWindow, new Date());
      await lapis.setSetting("quota_windows", allWindows);
    }

    return true;
  }

  return {
    start(missionId) {
      if (!["idle", "completed", "failed", "aborted"].includes(status.state)) {
        return;
      }

      abortController = new AbortController();
      setStatus("planning", missionId);
      void runMission(missionId);
    },

    abort() {
      abortController?.abort();
      stopHeartbeat();
    },

    getStatus() {
      return { ...status };
    },

    getActiveMissionId() {
      return status.missionId;
    },

    waitForCompletion() {
      if (status.state === "completed" || status.state === "failed" || status.state === "aborted") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        completionWaiters.push(resolve);
      });
    },
  };
}
