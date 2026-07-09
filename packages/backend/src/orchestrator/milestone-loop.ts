import type { CheckpointTrigger, CompressionTrigger, Mission, Milestone, WorkingUnit, WorkerStatus, EscalationTrigger, EscalationContext, AgentType, AgentStatus, MilestoneStatus, ResearchFinding, AffectedCodeScaffold } from "@aurex/shared";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { PinyxClient } from "../clients/pinyx-client.js";
import { QuotaExhaustedError } from "../clients/pinyx-quota-wrapper.js";
import { createWorktreeManager } from "./worktree.js";
import { createAgentSpawner } from "../agents/agent-spawner.js";
import type { AgentLogger } from "../agents/agent-logger.js";
import type { EventBus } from "../ws/events.js";
import { buildValidatorContext, buildWorkerContext, buildResearchContext, type ValidatorUnitContext } from "../agents/context-builder.js";
import { buildAffectedCodeScaffold, DEFAULT_AFFECTED_CODE_TOKEN_BUDGET, type CodeGraphInput, type HotspotsInput } from "./affected-code.js";
import { loadConfig } from "../config.js";
import { rescopeMilestone } from "./rescope.js";
import { validateHandoff } from "../enforcement/handoff-validator.js";
import {
  applyValidatorVerdictsToTodos,
  markWorkerTodoProgress,
  reconcileMissionLedger,
} from "./ledger-reconciler.js";
import {
  enrichWorkingUnitsForExecution,
  selectWorkerMaxTimeout,
  selectWorkerTimeout,
} from "./milestone-unit-context.js";
import {
  canRetryUnit,
  createRetryBudget,
  markUnitRetry,
} from "./milestone-retry-budget.js";
import {
  ensureValidatorVerdicts,
  selectValidatorTypes,
  type ValidatorRunResult,
} from "./milestone-validator-verdicts.js";
import { runSmokeCheck } from "./smoke-check.js";

const execFileAsync = promisify(execFile);

// Auto-rescope is disabled by default (0). When enabled, an end-of-milestone
// validator failure triggers a planner re-plan (rescope) automatically. When
// disabled (0), the loop escalates to the user after a validator failure,
// giving the human direct control over whether to rescope, retry, or abort.
const AUTO_RESCOPE_BATCH_LIMIT = 0;

/**
 * v1 runs one worker at a time (issue #119). Workers are serialized by the
 * per-unit `for` loop (each `runUnit` is awaited before the next), NOT by
 * this cap. The cap only needs to accommodate the end-of-milestone validator
 * pair (scrutiny + user_testing), which runs concurrently via `Promise.all`.
 * A cap of 1 would make the second validator spawn throw
 * "AgentSpawner concurrency limit reached". 2 = max validator pair size.
 */
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
  researchTimeout?: number;
  validatorTimeout?: number;
}

/**
 * v1 sequential milestone loop (issue #119).
 *
 * Model:
 *   Orchestrator → Planner → (Worker → per-unit smoke check) per unit,
 *   sequentially, all on ONE shared feature branch → end-of-milestone full
 *   LLM validator → on pass cut a release branch + human checkpoint; on fail,
 *   planner re-plan (rescope) up to the rescope budget, else escalate.
 *
 * The feature branch only ever contains committed-and-approved work: a failed
 * smoke check or worker handoff `git reset`s the branch to the pre-unit commit.
 */
export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
  loopConfig: MilestoneLoopConfig,
) {
  const worktreeManager = createWorktreeManager(loopConfig.repoRoot);
  let cumulativeCost = 0;
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

          await lapis.updateMilestoneStatus(milestone.id, "in_progress");
          callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);
          await reconcileMissionLedger(lapis, {
            missionId: mission.id,
            milestoneId: milestone.id,
            reason: "milestone started",
            actorId: "orchestrator",
          });

          const milestoneResult = await runMilestone(mission, milestone, {
            throwIfAborted,
            activeHandles,
          });
          if (milestoneResult.status !== "continue") return milestoneResult;
        }

        await lapis.updateMissionStatus(mission.id, "completed");
        return { status: "completed" };
      } finally {
        signal?.removeEventListener("abort", abortListener);
        activeHandles.clear();
      }
    },
  };

  /**
   * Run a single milestone to completion (or a checkpoint/escalation). Returns
   * `{ status: "continue" }` when the milestone finished cleanly so the outer
   * loop advances to the next milestone; otherwise returns a terminal result.
   */
  async function runMilestone(
    mission: Mission,
    milestone: Milestone,
    ctx: { throwIfAborted: () => void; activeHandles: Set<{ abort: () => void }> },
  ): Promise<MilestoneLoopResult | { status: "continue" }> {
    const config = mission.configJson;
    const maxPerUnitRetries = config.maxPerUnitRetries ?? loadConfigDefensive().maxPerUnitRetries ?? 2;

    // --- Setup: ONE feature worktree off main for the whole milestone ---
    const featureWorktree = await worktreeManager.createFeatureWorktree(
      mission.id, milestone.orderIndex, milestone.id, loopConfig.gitMainBranch,
    );
    await worktreeManager.installBranchGuard(featureWorktree.worktreePath, featureWorktree.featureBranch);

    let researchFindings: ResearchFinding[] = await loadResearchFindings(
      mission.id,
      milestone.id,
      [],
      "research_findings_fetch_failed",
      "Could not load research findings from LaPis",
    );
    let preResearchAttempted = false;
    const retryBudget = createRetryBudget();

    const affectedCodeCache = await loadAffectedCodeCache(loopConfig.repoRoot, lapis, mission.id, loopConfig.eventBus);

    // Re-planning loop: a milestone can be re-planned (rescoped) after an
    // end-of-milestone validator failure. Each rescope produces fresh units
    // that run through the same worker → smoke → validator pipeline.
    let milestoneActive = true;
    while (milestoneActive) {
      milestoneActive = false;
      ctx.throwIfAborted();

      let fetchedUnits: WorkingUnit[];
      try {
        fetchedUnits = await lapis.getWorkingUnitsForMilestone(milestone.id);
      } catch (err) {
        const summary = `Failed to load working units from LaPis for milestone ${milestone.id}: ${err instanceof Error ? err.message : String(err)}`;
        return unitFetchFailure(mission.id, milestone.id, summary);
      }
      const units = enrichWorkingUnitsForExecution(fetchedUnits, mission, milestone, loopConfig.repoRoot);

      // --- Pre-worker research (once per milestone plan) ---
      if (researchFindings.length === 0 && !preResearchAttempted) {
        preResearchAttempted = true;
        researchFindings = await runPreWorkerResearch(mission, milestone, units, featureWorktree.worktreePath, ctx);
      }

      const contractHistory = await lapis.getContractHistory(milestone.id).catch(() => [] as any[]);
      const contract = contractHistory.reduce(
        (latest: any, entry: any) => (!latest || (entry?.version ?? 0) > (latest?.version ?? 0) ? entry : latest),
        undefined as any,
      ) as any;
      const contractContent = contract?.content ?? {};
      const criteria = contractContent.criteria ?? [];
      const testCommands: string[] = contractContent.testCommands ?? [];
      const acceptanceBehavior = contractContent.acceptanceBehavior ?? "";
      const contractId = contract?.id || milestone.validationContractId || "unknown-contract";

      // Reset any transient (interrupted) units back to planned so the
      // sequential loop picks them up after a pause/checkpoint.
      const transientStatuses: WorkerStatus[] = ["spawned", "working", "committing"];
      const staleUnits = units.filter((u) => transientStatuses.includes(u.status));
      for (const u of staleUnits) {
        await lapis.updateWorkingUnitStatus(u.id, "planned");
      }

      // --- Sequential per-unit worker + smoke loop ---
      let completedCount = units.filter((u) => u.status === "completed").length;
      for (const unit of units) {
        if (unit.status === "completed") continue;
        ctx.throwIfAborted();

        // Cost cap check BEFORE spawning the next unit too: retries of a
        // prior unit (or a single expensive worker) can push cumulativeCost
        // past the cap without a unit completing. Stopping here avoids
        // spending more on the next unit before the human approves.
        if (config.costCap > 0 && cumulativeCost >= config.costCap) {
          const summary = `Mission cost cap exceeded: ${cumulativeCost.toFixed(2)} >= ${config.costCap.toFixed(2)}`;
          return { status: "checkpoint_needed", trigger: "cost_cap_exceeded", milestoneId: milestone.id, summary };
        }

        const unitOutcome = await runUnit({
          mission, milestone, unit, units, criteria, testCommands,
          featureWorktree, researchFindings, contract, retryBudget,
          maxPerUnitRetries, affectedCodeCache, completedCount, ctx,
        });
        if (unitOutcome.status !== "continue") return unitOutcome;
        completedCount += 1;
        callbacks.onMilestoneProgress(milestone.id, "in_progress", completedCount, units.length);

        // Cost cap check after each unit.
        if (config.costCap > 0 && cumulativeCost >= config.costCap) {
          const summary = `Mission cost cap exceeded: ${cumulativeCost.toFixed(2)} >= ${config.costCap.toFixed(2)}`;
          return { status: "checkpoint_needed", trigger: "cost_cap_exceeded", milestoneId: milestone.id, summary };
        }
      }

      // --- End-of-milestone full LLM validator (against feature branch HEAD) ---
      // Refresh research findings first: workers may have verified/rejected
      // findings via verify_finding/reject_finding, and the validator (and any
      // rescope iteration) must see the latest statuses.
      researchFindings = await loadResearchFindings(
        mission.id,
        milestone.id,
        researchFindings,
        "research_findings_fetch_failed",
        "Could not refresh research findings from LaPis",
      );
      const validatorOutcome = await runEndOfMilestoneValidation({
        mission, milestone, units, criteria, testCommands, acceptanceBehavior,
        contractId, researchFindings, featureWorktree, ctx,
      });
      if (validatorOutcome.status !== "pass") {
        if (validatorOutcome.status === "checkpoint") return validatorOutcome.result;
        // validatorOutcome.status === "fail" → planner re-plan or escalate
        const rescopes = await lapis.getRetryCounter(milestone.id).catch(() => ({ milestoneId: milestone.id, retries: 0, rescopes: 0 })).then((c) => c.rescopes);
        const effectiveMaxRescopes = Math.min(config.maxRescopes, config.maxAutoRescopes ?? AUTO_RESCOPE_BATCH_LIMIT);

        if (effectiveMaxRescopes > 0 && rescopes < effectiveMaxRescopes) {
          const rescopeResult = await rescopeMilestone({
            pinyx, lapis, mission,
            milestone: { id: milestone.id, title: milestone.title, description: milestone.description },
            model: config.modelHints.orchestrator,
            reason: validatorOutcome.reason,
            verdicts: validatorOutcome.verdicts,
            researchFindings,
            completedUnitSummaries: units
              .filter((u) => u.status === "completed")
              .map((u) => ({ description: u.description, declaredPaths: u.declaredPaths, declaredModules: u.declaredModules })),
          });
          if (!rescopeResult.ok) {
            const summary = rescopeResult.error === "pinyx_threw"
              ? `Rescope re-planning failed: ${rescopeResult.message}`
              : `Rescope re-planning failed: ${rescopeResult.content}`;
            callbacks.onError(mission.id, "rescope_failed", summary, { milestoneId: milestone.id, recoverable: false });
            return { status: "checkpoint_needed", trigger: "rescope_limit", milestoneId: milestone.id, summary };
          }
          await lapis.logRescope(milestone.id, {
            milestoneId: milestone.id, contractId,
            reason: validatorOutcome.reason,
            previousScope: units.map((u) => u.description).join("; "),
            newScope: rescopeResult.units.map((u) => u.description).join("; "),
          }).catch((err: unknown) => {
            console.warn(`[milestone-loop] Failed to log rescope:`, err instanceof Error ? err.message : err);
          });
          preResearchAttempted = false;
          milestoneActive = true;
          continue;
        }

        // Auto-rescope disabled or exhausted → escalate to human.
        const autoRescopeNote = effectiveMaxRescopes > 0
          ? ` Aurex auto-rescopes at most ${effectiveMaxRescopes} times before asking for direction.`
          : " Auto-rescope is disabled, so Aurex is asking for direction instead of re-planning automatically.";
        const summary = `${validatorOutcome.reason}.${autoRescopeNote}`;
        callbacks.onEscalation(mission.id, { kind: "validation_failed", milestoneId: milestone.id }, { summary });
        return { status: "checkpoint_needed", trigger: "validation_failed", milestoneId: milestone.id, summary };
      }

      // --- Validator passed: cut release branch + milestone-complete checkpoint ---
      const releaseBranch = await worktreeManager.cutReleaseBranch(
        mission.id, milestone.orderIndex, milestone.id, featureWorktree.featureBranch,
      ).catch(() => `release/${mission.id}/${milestone.orderIndex + 1}-${milestone.id}`);

      if (loopConfig.onPostMilestoneScan) {
        try { await loopConfig.onPostMilestoneScan(mission.id, loopConfig.repoRoot); }
        catch (err) {
          console.warn(`[bumblebee] Post-milestone scan failed for mission ${mission.id}:`, err instanceof Error ? err.message : err);
        }
      }

      callbacks.onEscalation(
        mission.id,
        { kind: "milestone_complete", milestoneId: milestone.id, releaseBranch },
        { releaseBranch } as EscalationContext,
      );

      const compressionTrigger: CompressionTrigger = "post_milestone";
      try {
        if (loopConfig.onCompression) await loopConfig.onCompression(mission.id, compressionTrigger);
        else await lapis.runCompression(mission.id, compressionTrigger);
      } catch (err) {
        console.warn(`[milestone-loop] Post-milestone compression failed:`, err instanceof Error ? err.message : err);
      }

      try { await worktreeManager.pruneWorktree(featureWorktree.worktreePath); }
      catch (err) {
        console.warn(`[milestone-loop] Failed to prune feature worktree ${featureWorktree.worktreePath}:`, err instanceof Error ? err.message : err);
      }

      return {
        status: "checkpoint_needed",
        trigger: "milestone_complete",
        milestoneId: milestone.id,
        summary: `Milestone "${milestone.title}" passed validation. Release branch: ${releaseBranch}`,
      };
    }

    return { status: "continue" };
  }

  /** Run a single working unit: worker → handoff check → smoke check, with retries. */
  async function runUnit(args: {
    mission: Mission; milestone: Milestone; unit: WorkingUnit; units: WorkingUnit[];
    criteria: string[]; testCommands: string[];
    featureWorktree: { worktreePath: string; featureBranch: string };
    researchFindings: ResearchFinding[]; contract: any;
    retryBudget: ReturnType<typeof createRetryBudget>; maxPerUnitRetries: number;
    affectedCodeCache: AffectedCodeCache;
    completedCount: number;
    ctx: { throwIfAborted: () => void; activeHandles: Set<{ abort: () => void }> };
  }): Promise<MilestoneLoopResult | { status: "continue" }> {
    const { mission, milestone, unit, featureWorktree, affectedCodeCache, ctx } = args;
    const config = mission.configJson;

    let attemptFeedback = "";
    // Retry loop for this single unit.
    for (;;) {
      ctx.throwIfAborted();
      const baseSha = await worktreeManager.currentHead(featureWorktree.worktreePath);

      // --- Spawn worker on the shared feature branch ---
      const agentId = `worker-${unit.id}`;
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
        contractCriteria: args.criteria,
        testCommands: args.testCommands,
        researchFindings: args.researchFindings,
        affectedCode,
      });

      callbacks.onAgentStatus(agentId, "worker", "spawned", milestone.id, {
        declaredPaths: unit.declaredPaths,
        declaredModules: unit.declaredModules,
        taskBranch: featureWorktree.featureBranch,
        worktreePath: featureWorktree.worktreePath,
        sessionId: "",
        description: unit.description,
      });
      await markWorkerTodoProgress(lapis, {
        missionId: mission.id,
        unit: { ...unit, taskBranch: featureWorktree.featureBranch, worktreePath: featureWorktree.worktreePath },
        workerId: agentId,
        status: "in_progress",
        reason: "worker spawned and claimed unit",
        branch: featureWorktree.featureBranch,
        notes: [`Worker ${agentId} started in ${featureWorktree.worktreePath}`],
      });
      await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: "worker spawned", actorId: "orchestrator" });

      const workerTimeout = selectWorkerTimeout(unit, config.workerTimeouts);
      let handle;
      try {
        handle = await spawner.spawn({
          agentType: "worker",
          agentId,
          unitId: unit.id,
          missionId: mission.id,
          milestoneId: milestone.id,
          cwd: featureWorktree.worktreePath,
          baseCommitHash: baseSha || undefined,
          skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/worker.md`,
          contextContent,
          taskPrompt: [
            `Implement: ${unit.description}`,
            "",
            attemptFeedback ? `FEEDBACK FROM PRIOR ATTEMPT (address this):\n${attemptFeedback}` : "",
            "Research findings from the research agent are in your context under 'Research Findings'. Use them directly. Do NOT re-read files already documented there.",
            "",
            "Follow your skill instructions carefully.",
            "You MUST run `git add` and `git commit` on the feature branch, then call write_handoff with the real `git rev-parse HEAD` hash. The hash is verified: it must be a NEW commit on your branch (not the starting commit). For analysis-only tasks with no code changes, commit a documentation/notes update or an empty commit so there is a real commit to validate against.",
            "When useful work is committed, verification is blocked, or time is running short, call write_handoff immediately with partial/blocking details.",
          ].join("\n"),
          timeout: workerTimeout,
          extendTimeoutOnActivity: true,
          maxTimeout: selectWorkerMaxTimeout(workerTimeout),
          model: config.modelHints.worker,
        });
      } catch (spawnErr) {
        // spawn() threw before returning a handle (e.g. model-resolution
        // failure, spawner concurrency limit, session creation error). The
        // "spawned"/"in_progress" status callbacks above already fired, so we
        // must roll the unit/branch back to a consistent state. Reset the
        // branch to the pre-unit commit, record a recoverable error, and feed
        // the attempt through the SAME retry/escalate path as any other worker
        // failure rather than crashing the whole milestone.
        callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
        callbacks.onError(
          mission.id, "worker_spawn_failed",
          `Worker "${unit.description}" could not be spawned: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
          { workerId: agentId, milestoneId: milestone.id, recoverable: true, details: { error: spawnErr instanceof Error ? spawnErr.message : String(spawnErr) } },
        );
        await worktreeManager.resetTo(featureWorktree.worktreePath, baseSha).catch((resetErr: unknown) => {
          console.warn(`[milestone-loop] Failed to reset feature branch after spawn failure for worker ${agentId}:`, resetErr instanceof Error ? resetErr.message : resetErr);
        });
        await markWorkerTodoProgress(lapis, {
          missionId: mission.id,
          unit: { ...unit, taskBranch: "", worktreePath: "" },
          workerId: agentId,
          status: "blocked",
          reason: `worker spawn failed: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
          branch: "",
          notes: [`Worker ${agentId} spawn failed`],
        });
        await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: "worker spawn failed", actorId: "orchestrator" });

        const failureRecord: UnitFailure = {
          kind: "failed", code: "worker_spawn_failed",
          message: `Worker "${unit.description}" could not be spawned`,
          feedback: `The previous worker attempt failed to spawn (${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}). Retry the implementation.`,
        };
        // Only retry spawn failures that have a chance of succeeding on a
        // re-attempt. A DETERMINISTIC spawn error (model not registered, bad
        // provider/config, "no such provider") will fail identically on every
        // retry — burning the per-unit retry budget for nothing. Retry only
        // TRANSIENT spawn errors (concurrency limit, which clears when another
        // agent finishes; or an opaque session-creation error that might be a
        // transient network blip). Deterministic errors escalate immediately.
        const isDeterministicSpawnError = isDeterministicSpawnFailure(spawnErr);
        if (!isDeterministicSpawnError && canRetryUnit(args.retryBudget, unit.id, args.maxPerUnitRetries)) {
          markUnitRetry(args.retryBudget, unit.id);
          await lapis.updateWorkingUnitStatus(unit.id, "planned");
          callbacks.onMilestoneProgress(milestone.id, "retrying", args.completedCount, args.units.length);
          attemptFeedback = failureRecord.feedback;
          continue; // retry THIS unit
        }
        const attemptNote = isDeterministicSpawnError
          ? " (configuration/model error — not retried)"
          : ` after ${args.maxPerUnitRetries + 1} attempt(s)`;
        const summary = `${failureRecord.message}${attemptNote}.`;
        callbacks.onEscalation(mission.id, { kind: "unclassifiable_error", milestoneId: milestone.id }, { summary });
        return { status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId: milestone.id, summary };
      }
      ctx.activeHandles.add(handle);
      callbacks.onAgentStatus(agentId, "worker", "working", milestone.id);

      // Await the worker. A worker that completes-but-failed (timeout, aborted,
      // no handoff) RESOLVES with a failure status and is handled by
      // classifyWorkerFailure below, which resets the branch. But the awaited
      // promise can also REJECT — e.g. QuotaExhaustedError thrown mid-session
      // after the worker already ran `git commit` but before write_handoff.
      // A rejecting path bypasses classifyWorkerFailure, so an unvalidated
      // partial commit would otherwise survive on the feature branch. Catch
      // here, reset to the pre-unit commit, then re-throw so the caller's
      // quota/abort handling still runs. (On resume, createFeatureWorktree
      // preserves the branch — now correctly back at the last approved commit.)
      let result;
      try {
        result = await handle.completed;
      } catch (err) {
        ctx.activeHandles.delete(handle);
        handle.dispose();
        await worktreeManager.resetTo(featureWorktree.worktreePath, baseSha).catch((resetErr: unknown) => {
          console.warn(`[milestone-loop] Failed to reset feature branch after interrupted worker ${agentId}:`, resetErr instanceof Error ? resetErr.message : resetErr);
        });
        throw err;
      }
      ctx.activeHandles.delete(handle);
      handle.dispose();

      // Classify the attempt: worker failure, invalid handoff, smoke-check
      // failure, or success. A failure yields feedback for the retry; success
      // advances to the next unit. Retries re-enter THIS loop (same unit),
      // not the outer per-unit loop.
      const failure = await classifyWorkerFailure(mission, milestone, unit, agentId, result, args.criteria);
      let retryFeedback: string | null = null;
      let failureRecord: UnitFailure | null = failure;

      if (!failure) {
        // --- Per-unit smoke check (cheap, deterministic) ---
        const smokeCommands = resolveSmokeCommands(args.testCommands);
        const smoke = await runSmokeCheck({
          worktreePath: featureWorktree.worktreePath,
          testCommand: smokeCommands.test,
          typecheckCommand: smokeCommands.typecheck,
          lintCommand: smokeCommands.lint,
        });
        if (!smoke.pass) {
          const feedback = smoke.failures.join("\n");
          callbacks.onError(mission.id, "smoke_check_failed", `Smoke check failed for unit "${unit.description}":\n${feedback}`, { workerId: agentId, milestoneId: milestone.id, recoverable: true, details: { failures: smoke.failures } });
          loopConfig.eventBus?.emit({ type: "mission_log", missionId: mission.id, phase: "worker", message: `Smoke check failed for unit ${unit.id}; resetting feature branch and retrying`, data: { unitId: unit.id, failures: smoke.failures } });
          failureRecord = { kind: "smoke", code: "smoke_check_failed", message: `Smoke check failed for unit "${unit.description}"`, feedback };
          retryFeedback = feedback;
        }
      } else {
        retryFeedback = failure.feedback;
      }

      if (failureRecord) {
        // Reset the feature branch so it only ever holds approved work.
        await worktreeManager.resetTo(featureWorktree.worktreePath, baseSha);
        await markWorkerTodoProgress(lapis, {
          missionId: mission.id,
          unit: { ...unit, taskBranch: "", worktreePath: "" },
          workerId: agentId,
          status: "blocked",
          reason: failureRecord.message,
          branch: "",
          notes: [failureRecord.feedback],
        });
        await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: `worker ${failureRecord.kind} failure`, actorId: "orchestrator" });

        if (canRetryUnit(args.retryBudget, unit.id, args.maxPerUnitRetries)) {
          markUnitRetry(args.retryBudget, unit.id);
          await lapis.updateWorkingUnitStatus(unit.id, "planned");
          // Report meaningful progress (completed so far / total) instead of
          // 0/0, so UI consumers don't flicker the progress bar during a retry.
          callbacks.onMilestoneProgress(milestone.id, "retrying", args.completedCount, args.units.length);
          attemptFeedback = retryFeedback ?? "";
          continue; // retry THIS unit
        }

        // Budget exhausted → escalate.
        const summary = `${failureRecord.message} after ${args.maxPerUnitRetries + 1} attempt(s).`;
        callbacks.onEscalation(mission.id, { kind: "unclassifiable_error", milestoneId: milestone.id }, { summary });
        return { status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId: milestone.id, summary };
      }

      // --- Unit passed ---
      await lapis.updateWorkingUnitStatus(unit.id, "completed");
      await markWorkerTodoProgress(lapis, {
        missionId: mission.id,
        unit: { ...unit, taskBranch: featureWorktree.featureBranch, worktreePath: featureWorktree.worktreePath },
        workerId: agentId,
        status: "implemented",
        reason: "worker completed successfully",
        branch: featureWorktree.featureBranch,
        notes: [`Worker ${agentId} completed unit ${unit.id}`],
      });
      callbacks.onAgentStatus(agentId, "worker", "completed", milestone.id);
      await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: "worker completed", actorId: "orchestrator" });
      return { status: "continue" };
    }
  }

  /**
   * Decide whether a completed worker produced a valid, reviewable unit.
   * Returns `null` when the unit is good (worker completed + valid handoff),
   * or a {@link UnitFailure} describing why it must be retried/reset.
   */
  async function classifyWorkerFailure(
    mission: Mission, milestone: Milestone, unit: WorkingUnit, agentId: string,
    result: { status: string; sessionId?: string; error?: string },
    _criteria: string[],
  ): Promise<UnitFailure | null> {
    if (result.status === "timed_out") {
      callbacks.onAgentStatus(agentId, "worker", "timed_out", milestone.id);
      callbacks.onError(mission.id, "worker_timeout", `Worker "${unit.description}" timed out`, { workerId: agentId, milestoneId: milestone.id, recoverable: true });
      return { kind: "timeout", code: "worker_timeout", message: `Worker "${unit.description}" timed out`, feedback: `The previous worker attempt for unit "${unit.description}" timed out. Resume the implementation and commit your work before the deadline.` };
    }
    if (result.status !== "completed") {
      const missingHandoff = result.error?.includes("write_handoff") || result.error?.includes("worker_handoff_missing");
      callbacks.onAgentStatus(agentId, "worker", "failed", milestone.id);
      callbacks.onError(
        mission.id,
        missingHandoff ? "worker_handoff_invalid" : "worker_failed",
        missingHandoff ? `Worker "${unit.description}" did not submit a valid handoff` : `Worker "${unit.description}" failed`,
        { workerId: agentId, milestoneId: milestone.id, recoverable: true, ...(missingHandoff ? { details: { error: result.error } } : {}) },
      );
      return {
        kind: "failed",
        code: missingHandoff ? "worker_handoff_invalid" : "worker_failed",
        message: missingHandoff ? `Worker "${unit.description}" did not submit a valid handoff` : `Worker "${unit.description}" failed`,
        feedback: missingHandoff
          ? `The previous worker attempt ended before submitting a valid write_handoff. You MUST run 'git add' and 'git commit' on the feature branch, then call write_handoff with the real 'git rev-parse HEAD' hash. Error: ${result.error ?? "no handoff"}`
          : `The previous worker attempt failed. Retry the implementation. Error: ${result.error ?? "unknown"}`,
      };
    }

    // Worker reported completed — validate its handoff for this unit.
    let handoff;
    try {
      handoff = await lapis.getHandoffForUnit(unit.id);
    } catch (err) {
      const fetchError = err instanceof Error ? err.message : String(err);
      callbacks.onError(mission.id, "worker_handoff_fetch_failed", `Worker "${unit.description}" handoff could not be loaded from LaPis`, { workerId: agentId, milestoneId: milestone.id, recoverable: true, details: { errors: [`handoff fetch failed: ${fetchError}`] } });
      return { kind: "handoff", code: "worker_handoff_fetch_failed", message: `Worker "${unit.description}" handoff could not be loaded from LaPis`, feedback: `The handoff for unit "${unit.description}" could not be loaded from LaPis (${fetchError}). Re-run and resubmit write_handoff.` };
    }
    if (!handoff) {
      callbacks.onError(mission.id, "worker_handoff_invalid", `Worker "${unit.description}" did not submit a valid handoff`, { workerId: agentId, milestoneId: milestone.id, recoverable: true, details: { errors: ["worker completed without submitting write_handoff"] } });
      return { kind: "handoff", code: "worker_handoff_invalid", message: `Worker "${unit.description}" did not submit a valid handoff`, feedback: `The previous worker attempt completed without submitting a write_handoff. Call write_handoff with the real 'git rev-parse HEAD' hash after committing.` };
    }
    const handoffErrors = validateHandoff(handoff).errors;
    if (handoffErrors.length > 0) {
      callbacks.onError(mission.id, "worker_handoff_invalid", `Worker "${unit.description}" did not submit a valid handoff`, { workerId: agentId, milestoneId: milestone.id, recoverable: true, details: { errors: handoffErrors } });
      return { kind: "handoff", code: "worker_handoff_invalid", message: `Worker "${unit.description}" did not submit a valid handoff`, feedback: `The previous handoff was rejected:\n- ${handoffErrors.join("\n- ")}\nRe-run and resubmit a complete write_handoff.` };
    }
    return null;
  }

  /** End-of-milestone full LLM validator pair, run against the feature branch HEAD. */
  async function runEndOfMilestoneValidation(args: {
    mission: Mission; milestone: Milestone; units: WorkingUnit[];
    criteria: string[]; testCommands: string[]; acceptanceBehavior: string;
    contractId: string; researchFindings: ResearchFinding[];
    featureWorktree: { worktreePath: string; featureBranch: string };
    ctx: { throwIfAborted: () => void; activeHandles: Set<{ abort: () => void }> };
  }): Promise<
    | { status: "pass" }
    | { status: "fail"; reason: string; verdicts: import("@aurex/shared").ValidationVerdict[] }
    | { status: "checkpoint"; result: MilestoneLoopResult }
  > {
    const { mission, milestone, units, featureWorktree, ctx } = args;
    const config = mission.configJson;

    await lapis.updateMilestoneStatus(milestone.id, "validating");
    callbacks.onMilestoneProgress(milestone.id, "validating", units.length, units.length);
    await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: "validation started", actorId: "orchestrator" });

    const validatorTypes = selectValidatorTypes(args.acceptanceBehavior);
    let diffSummary: string | undefined;
    try {
      const diff = await collectFeatureDiff(featureWorktree.worktreePath, loopConfig.gitMainBranch);
      diffSummary = diff || undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onError(
        mission.id,
        "feature_diff_failed",
        `Could not collect feature diff for validation: ${msg}`,
        {
          milestoneId: milestone.id,
          recoverable: true,
          details: { worktreePath: featureWorktree.worktreePath, baseBranch: loopConfig.gitMainBranch, error: msg },
        },
      );
      diffSummary = `[Feature diff unavailable: ${msg}]`;
    }

    const validatorUnits: ValidatorUnitContext[] = units.map((u) => ({
      id: u.id, description: u.description,
      declaredPaths: u.declaredPaths, declaredModules: u.declaredModules,
      taskBranch: featureWorktree.featureBranch, worktreePath: featureWorktree.worktreePath,
    }));

      const validatorResults: ValidatorRunResult[] = [];
      const outcomes = await Promise.allSettled(validatorTypes.map(async (validatorType) => {
        const agentId = `${validatorType}-${milestone.id}`;
        const contextContent = buildValidatorContext({
          validatorType,
          missionDescription: mission.description,
          milestoneTitle: milestone.title,
          milestoneDescription: milestone.description,
          contractId: args.contractId,
          contractCriteria: args.criteria,
          testCommands: args.testCommands,
          acceptanceBehavior: args.acceptanceBehavior,
          baseBranch: loopConfig.gitMainBranch,
          units: validatorUnits,
          researchFindings: args.researchFindings,
          diffSummary: diffSummary || undefined,
          validatorToolCallCap: config.validatorToolCallCap ?? 0,
          validatorWorktree: {
            path: featureWorktree.worktreePath,
            mergedBranches: [featureWorktree.featureBranch],
            conflictedBranches: [],
          },
        });
        callbacks.onAgentStatus(agentId, validatorType, "spawned", milestone.id);
        const handle = await spawner.spawn({
          agentType: validatorType, agentId, missionId: mission.id, milestoneId: milestone.id,
          contractId: args.contractId, cwd: featureWorktree.worktreePath,
          skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/validator.md`,
          contextContent,
          taskPrompt: `Validate milestone "${milestone.title}" as ${validatorType}. Use write_verdict when done.`,
          timeout: loopConfig.validatorTimeout ?? config.workerTimeouts.testHeavy,
          model: config.modelHints[validatorType],
          validatorToolCallCap: config.validatorToolCallCap ?? 0,
        });
        ctx.activeHandles.add(handle);
        callbacks.onAgentStatus(agentId, validatorType, "reviewing", milestone.id);
        try {
          const result = await handle.completed;
          return { validatorType, sessionId: handle.sessionId, result } satisfies ValidatorRunResult;
        } finally {
          // Dispose THIS handle in finally, regardless of pass/fail. Previously
          // dispose ran only after a successful await; if a sibling validator
          // rejected, Promise.all rejected and the surviving handle was never
          // disposed (a runaway/orphaned session). allSettled + per-handle
          // finally guarantees every validator session is torn down.
          ctx.activeHandles.delete(handle);
          handle.dispose();
        }
      }));

      // allSettled: rejections are failures to spawn/run a validator (e.g.
      // spawn() throw, session crash, or an abort). QuotaExhaustedError is
      // special — it must propagate to the mission-runner's quota-recovery
      // path rather than be treated as a milestone-level validation failure.
      // Other rejections become failed ValidatorRunResults below so the
      // existing synthetic-verdict machinery (ensureValidatorVerdicts) can
      // record a fail verdict for the type and route through the normal
      // validation_failed → rescope/escalate path.
      for (const o of outcomes) {
        if (o.status === "rejected" && o.reason instanceof QuotaExhaustedError) {
          throw o.reason;
        }
      }

      // Collect results. Fulfillments carry a usable ValidatorRunResult;
      // non-quota rejections are turned into a "failed" ValidatorRunResult so
      // the downstream verdict reconciliation can synthesize a fail verdict
      // for the type. outcomes are in validatorTypes order → index maps to type.
      outcomes.forEach((o, i) => {
        const validatorType = validatorTypes[i];
        const agentId = `${validatorType}-${milestone.id}`;
        if (o.status === "fulfilled") {
          callbacks.onAgentStatus(agentId, validatorType, o.value.result.status === "completed" ? "completed" : o.value.result.status, milestone.id);
          validatorResults.push(o.value);
        } else {
          callbacks.onAgentStatus(agentId, validatorType, "failed", milestone.id);
          validatorResults.push({
            validatorType, sessionId: "",
            result: { status: "failed", sessionId: "", error: `validator rejected: ${o.reason instanceof Error ? o.reason.message : String(o.reason)}` },
          });
        }
      });

    const { verdicts, runtimeFailures } = await ensureValidatorVerdicts(lapis, milestone.id, args.contractId, validatorResults);
    if (runtimeFailures.length > 0) {
      const summary = ["Validator did not produce a usable verdict.", ...runtimeFailures, "This is a validator runtime/compliance failure, not evidence that the milestone scope is wrong."].join(" ");
      callbacks.onError(mission.id, "validator_runtime_failure", summary, { milestoneId: milestone.id, recoverable: true });
      callbacks.onEscalation(mission.id, { kind: "unclassifiable_error", milestoneId: milestone.id }, { summary });
      return { status: "checkpoint", result: { status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId: milestone.id, summary } };
    }

    await applyValidatorVerdictsToTodos(lapis, { missionId: mission.id, verdicts, reason: "validator verdicts recorded" });
    await reconcileMissionLedger(lapis, { missionId: mission.id, milestoneId: milestone.id, reason: "validator verdicts completed", actorId: "orchestrator" });

    const allPass = verdicts.length > 0 && verdicts.every((v) => v.verdict === "pass");
    if (allPass) return { status: "pass" };

    const failFindings = verdicts
      .filter((v) => v.verdict === "fail")
      .map((v) => `${v.validatorType}: ${v.findings}`)
      .join("; ");
    return { status: "fail", reason: failFindings || "Validator reported failure", verdicts };
  }

  /** Optional pre-worker research agent (unchanged from the prior design). */
  async function runPreWorkerResearch(
    mission: Mission, milestone: Milestone, units: WorkingUnit[], repoRoot: string,
    ctx: { throwIfAborted: () => void; activeHandles: Set<{ abort: () => void }> },
  ): Promise<ResearchFinding[]> {
    const config = mission.configJson;
    const preResearchPaths = units.flatMap((u) => u.declaredPaths);
    const preResearchModules = [...new Set(units.flatMap((u) => u.declaredModules))];
    const preResearchId = `research-${milestone.id}`;
    const preResearchContext = buildResearchContext({
      missionDescription: mission.description,
      milestoneTitle: milestone.title,
      milestoneDescription: milestone.description,
      unitDescriptions: units.map((u) => u.description),
      declaredPaths: preResearchPaths,
      declaredModules: preResearchModules,
    });

    callbacks.onAgentStatus(preResearchId, "research", "spawned", milestone.id);
    let preResearchHandle;
    try {
      preResearchHandle = await spawner.spawn({
        agentType: "research",
        agentId: preResearchId,
        missionId: mission.id,
        milestoneId: milestone.id,
        cwd: repoRoot,
        skillFilePath: `${loopConfig.aurexRoot}/packages/backend/src/skills/research.md`,
        contextContent: preResearchContext,
        taskPrompt: `Research domain knowledge for milestone "${milestone.title}" BEFORE workers begin. Investigate the codebase areas relevant to the declared paths and modules. Submit findings using write_finding.`,
        timeout: loopConfig.researchTimeout ?? config.workerTimeouts.testHeavy,
        model: config.modelHints.research,
      });
    } catch (spawnErr) {
      const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      callbacks.onAgentStatus(preResearchId, "research", "failed", milestone.id);
      callbacks.onError(
        mission.id,
        "research_spawn_failed",
        `Pre-worker research could not be spawned: ${msg}`,
        { milestoneId: milestone.id, recoverable: true, details: { error: msg } },
      );
      return [];
    }
    ctx.activeHandles.add(preResearchHandle);
    callbacks.onAgentStatus(preResearchId, "research", "researching", milestone.id);
    const preResearchResult = await preResearchHandle.completed;
    ctx.activeHandles.delete(preResearchHandle);
    callbacks.onAgentStatus(preResearchId, "research", preResearchResult.status === "completed" ? "completed" : preResearchResult.status, milestone.id);
    preResearchHandle.dispose();
    if (preResearchResult.status !== "completed") {
      const msg = preResearchResult.status === "failed"
        ? "Pre-worker research agent failed"
        : `Pre-worker research ended with status ${preResearchResult.status}`;
      callbacks.onError(
        mission.id,
        "research_failed",
        msg,
        { milestoneId: milestone.id, recoverable: true, details: { status: preResearchResult.status } },
      );
    }
    return loadResearchFindings(
      mission.id,
      milestone.id,
      [],
      "research_findings_fetch_failed",
      "Could not load research findings after pre-worker research",
    );
  }

  async function loadResearchFindings(
    missionId: string,
    milestoneId: string,
    fallback: ResearchFinding[],
    errorCode: string,
    errorContext: string,
  ): Promise<ResearchFinding[]> {
    try {
      return await lapis.getFindings(missionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onError(
        missionId,
        errorCode,
        `${errorContext}: ${msg}`,
        { milestoneId, recoverable: true, details: { error: msg } },
      );
      return fallback;
    }
  }

  function unitFetchFailure(missionId: string, milestoneId: string, summary: string): MilestoneLoopResult {
    callbacks.onError(missionId, "lapis_units_fetch_failed", summary, { milestoneId, recoverable: true });
    callbacks.onEscalation(missionId, { kind: "unclassifiable_error", milestoneId }, { summary });
    return { status: "checkpoint_needed", trigger: "unclassifiable_error", milestoneId, summary };
  }
}

interface UnitFailure {
  kind: "timeout" | "failed" | "handoff" | "smoke";
  code: string;
  message: string;
  feedback: string;
}

/**
 * Classify a worker `spawn()` failure as deterministic (will fail identically
 * on every retry) vs. transient (might succeed on re-attempt). Deterministic
 * failures should NOT consume the per-unit retry budget.
 *
 * Deterministic signals (from the spawner / Pi SDK):
 *   - "Unable to register PiNyx model" — the configured model id is invalid
 *   - "no such provider" / model-resolution failures — bad provider config
 *   - "requires unitId" / "requires contractId" — programming-contract errors
 *
 * Transient signals (retry-worthy):
 *   - "AgentSpawner concurrency limit reached" — clears when an agent finishes
 *   - other opaque session-creation errors — might be a transient network blip
 *
 * The list is intentionally conservative: when unclear, default to TRANSIENT
 * (retry), because a wasted retry is cheaper than wrongly giving up on a unit
 * that might have succeeded.
 */
function isDeterministicSpawnFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unable to register (pinyx )?model|no such provider|requires (unitId|contractId)|model resolution failed/i.test(msg);
}

/** Resolve smoke-check commands: config overrides, else contract test command for tests. */
function resolveSmokeCommands(contractTestCommands: string[]): { test?: string; typecheck?: string; lint?: string } {
  const cfg = loadConfigDefensive();
  const test = cfg.smokeCheckCommands?.test ?? contractTestCommands[0];
  return {
    test,
    typecheck: cfg.smokeCheckCommands?.typecheck,
    lint: cfg.smokeCheckCommands?.lint,
  };
}

/**
 * Load config without throwing when required env vars are unset (tests/partial
 * envs). Env vars are static for the process lifetime, so the result is
 * memoized — `resolveSmokeCommands` and `buildScaffoldForUnit` call this
 * per-unit and would otherwise re-parse env on every worker spawn.
 *
 * NOTE: the cache is never invalidated. This is correct for the current design
 * (env does not change at runtime), but if hot-reloading of config is ever
 * added, this cache MUST be invalidated/reloaded or it will serve stale values
 * for the rest of the process.
 */
let _defensiveConfig: { maxPerUnitRetries: number; smokeCheckCommands: { test?: string; typecheck?: string; lint?: string } } | null = null;
function loadConfigDefensive(): {
  maxPerUnitRetries: number;
  smokeCheckCommands: { test?: string; typecheck?: string; lint?: string };
} {
  if (_defensiveConfig) return _defensiveConfig;
  try {
    const c = loadConfig();
    _defensiveConfig = { maxPerUnitRetries: c.maxPerUnitRetries, smokeCheckCommands: c.smokeCheckCommands };
    return _defensiveConfig;
  } catch {
    _defensiveConfig = { maxPerUnitRetries: 2, smokeCheckCommands: {} };
    return _defensiveConfig;
  }
}

/**
 * One diff for the whole milestone: feature branch vs main.
 *
 * Uses the THREE-dot form (`main...HEAD`) deliberately: it diffs against the
 * merge-base of `baseBranch` and HEAD, i.e. the commit the feature branch was
 * cut from. This captures the milestone's FULL change set even when:
 *  - `baseBranch` has advanced since the worktree was cut (unrelated merges
 *    on main don't pollute the diff), and
 *  - the milestone was resumed after a checkpoint (prior units' commits are
 *    already on the feature branch and remain included).
 * Two-dot (`main..HEAD`) would instead diff against main's CURRENT tip and
 * could either omit work or include unrelated main-side changes.
 */
async function collectFeatureDiff(worktreePath: string, baseBranch: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", worktreePath, "diff", `${baseBranch}...HEAD`, "--"],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

// --- Affected-code scaffold helpers (issue #114) ---
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

function buildScaffoldForUnit(
  unit: WorkingUnit,
  cache: AffectedCodeCache,
): AffectedCodeScaffold | undefined {
  let tokenBudget: number;
  try {
    tokenBudget = loadConfig().affectedCodeTokenBudget;
  } catch {
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
