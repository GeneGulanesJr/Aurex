import {
  createAgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

type DefaultResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
import type { AgentType, WorkerStatus, AgentOutputEventType } from "@aurex/shared";
import { AGENT_TOOLS, needsMemoryLayer } from "./factory.js";
import { createWorkerTools } from "./worker-tools.js";
import { createValidatorTools } from "./validator-tools.js";
import { createResearchTools } from "./research-tools.js";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { AgentLogger } from "./agent-logger.js";
import type { EventBus } from "../ws/events.js";
import path from "node:path";

export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
  logger?: AgentLogger;
  eventBus?: EventBus;
  maxConcurrent?: number;
  /** Max tool calls for a validator session before auto-fail. 0 disables the cap. Default 0. */
  validatorToolCallCap?: number;
  onCost?: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export interface SpawnOptions {
  agentType: AgentType;
  agentId: string;
  unitId?: string;
  missionId: string;
  milestoneId: string;
  contractId?: string;
  cwd: string;
  skillFilePath: string;
  contextContent: string;
  taskPrompt: string;
  timeout?: number;
  /** PiNyx/OpenAI-compatible model id to use for this agent session. */
  model?: string;
  /** Overrides the configured validator tool-call cap for this session. 0 disables the cap. */
  validatorToolCallCap?: number;
  /** When true, tool/cost activity refreshes the timeout window instead of treating timeout as a hard wall clock. */
  extendTimeoutOnActivity?: boolean;
  /** Upper bound for activity-extended sessions. Defaults to the base timeout when extension is disabled. */
  maxTimeout?: number;
}

export interface SpawnHandle {
  sessionId: string;
  completed: Promise<SpawnResult>;
  abort(): void;
  dispose(): void;
}

export const TOOL_CALL_CAP_EXCEEDED = "tool_call_cap_exceeded";

export interface SpawnResult {
  status: "completed" | "timed_out" | "failed";
  sessionId: string;
  error?: string;
}

export function createAgentSpawner(config: AgentSpawnerConfig) {
  const { lapis, agentDir, defaultTimeout, logger, eventBus, maxConcurrent, validatorToolCallCap = 0 } = config;
  const activeHandles = new Map<string, SpawnHandle>();
  let missionCumulativeCost = 0;
  let missionCumulativeTokens = 0;

  function emitOutput(
    opts: SpawnOptions,
    eventType: AgentOutputEventType,
    message: string,
    data?: Record<string, unknown>,
  ) {
    eventBus?.emit({
      type: "agent_output",
      missionId: opts.missionId,
      agentId: opts.agentId,
      agentType: opts.agentType,
      eventType,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  return {
    async spawn(opts: SpawnOptions): Promise<SpawnHandle> {
      if (maxConcurrent && activeHandles.size >= maxConcurrent) {
        throw new Error(
          `AgentSpawner concurrency limit reached (${maxConcurrent}). ` +
          `Active sessions: ${[...activeHandles.keys()].join(", ")}`,
        );
      }

      const timeout = opts.timeout ?? defaultTimeout;
      let sessionId = "";
      let onWorkerHandoffAccepted: (() => void) | undefined;
      const customTools = createCustomTools(lapis, opts, () => sessionId, () => {
        onWorkerHandoffAccepted?.();
      });
      const tools = [...new Set([
        ...AGENT_TOOLS[opts.agentType],
        ...customTools.map((tool) => tool?.name).filter((name): name is string => Boolean(name)),
      ])];
      let cumulativeCost = 0;
      let cumulativeTokens = 0;

      const skillBaseDir = path.dirname(opts.skillFilePath);
      const loaderConfig: DefaultResourceLoaderOptions = {
        cwd: opts.cwd,
        agentDir,
        skillsOverride: (current: any) => ({
          skills: [
            ...current.skills,
            {
              name: "aurex-worker",
              description: "Aurex worker skill",
              filePath: opts.skillFilePath,
              baseDir: skillBaseDir,
              source: "custom",
            },
          ],
          diagnostics: current.diagnostics,
        }),
        agentsFilesOverride: (current: any) => {
          const extraFiles: Array<{ path: string; content: string }> = [];

          // For non-memory-layer agents, inject a countermanding agentsFile
          // that overrides the global AGENTS.md memory-layer enforcement.
          // The global ~/.pi/agent/AGENTS.md says "read → BLOCKED, use
          // memory-code first" but memory-code was removed by
          // extensionsOverride. Without this override the agent tries to
          // call nonexistent tools and spirals.
          if (!needsMemoryLayer(opts.agentType)) {
            extraFiles.push({
              path: "/virtual/aurex-no-memory-layer.md",
              content: [
                "# Memory-Layer Tools Not Available",
                "",
                "This session does NOT have the memory-layer extension loaded.",
                "The following tools are NOT available: memory-code, memory-doc,",
                "memory-search, memory-save, memory-get, memory-update,",
                "memory-delete, memory-related, memory-load-context.",
                "",
                "IGNORE any instructions in other context files that say to use",
                "memory-code, memory-doc, or other memory-* tools. Those rules",
                "do not apply to this session.",
                "",
                "Use `read` and `bash` directly. No outline step is required",
                "before reading files.",
              ].join("\n"),
            });
          }

          return {
            agentsFiles: [
              ...current.agentsFiles,
              {
                path: "/virtual/aurex-context.md",
                content: opts.contextContent,
              },
              ...extraFiles,
            ],
            diagnostics: current.diagnostics,
          };
        },
      };

      // Strip memory-layer extension for agents that don't need it.
      // The memory-layer extension registers memory-code/memory-search
      // tools and injects session lifecycle hooks.
      if (!needsMemoryLayer(opts.agentType)) {
        loaderConfig.extensionsOverride = (base: any) => ({
          ...base,
          // Extension has no `name` property — identify by file path.
          // The path will be something like:
          // ~/.pi/agent/git/.../LaPis/extensions/memory-layer/index.ts
          extensions: base.extensions.filter(
            (ext: any) => !ext.path.includes("memory-layer"),
          ),
        });
      }

      const loader = new DefaultResourceLoader(loaderConfig);
      await loader.reload();

      const pinyxModelConfig = await resolvePinyxModel(lapis, opts.model);

      const { session } = await createAgentSession({
        cwd: opts.cwd,
        agentDir,
        tools,
        customTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(opts.cwd),
        ...(pinyxModelConfig ? pinyxModelConfig : {}),
      });
      sessionId = session.sessionId;

      await lapis.registerAgentSession(
        opts.agentType,
        session.sessionId,
        opts.missionId,
        opts.milestoneId,
        opts.unitId,
      );

      if (opts.agentType === "worker" && opts.unitId) {
        await lapis.updateWorkingUnitStatus(opts.unitId, "spawned" as WorkerStatus);
      }

      logger?.log({
        sessionId: session.sessionId,
        agentType: opts.agentType,
        missionId: opts.missionId,
        milestoneId: opts.milestoneId,
        unitId: opts.unitId,
        event: "spawned",
      });
      emitOutput(opts, "spawned", `${opts.agentType} agent spawned`);

      let resolveCompleted!: (result: SpawnResult) => void;
      const completed = new Promise<SpawnResult>((resolve) => {
        resolveCompleted = resolve;
      });

      let settled = false;
      let workerHandoffAccepted = false;
      const workerHandoffRequired = opts.agentType === "worker"
        && customTools.some((tool) => tool?.name === "write_handoff");
      let toolCallCount = 0;
      // Repeated-tool-call loop detection. When an LLM calls the same tool
      // with the same arguments repeatedly (e.g. a stuck `cd` or `ls` loop),
      // the session will never make progress but each call refreshes the
      // activity-extended timeout, burning maxTimeout worth of tokens.
      // Abort early when the same call repeats beyond LOOP_DETECTION_THRESHOLD.
      const LOOP_DETECTION_THRESHOLD = 5;
      const recentToolCalls: string[] = [];
      const isValidatorSession = opts.agentType === "validator_scrutiny" || opts.agentType === "validator_user_testing";
      const effectiveValidatorToolCallCap = opts.validatorToolCallCap ?? validatorToolCallCap;
      const toolCallCap = isValidatorSession && effectiveValidatorToolCallCap > 0 ? effectiveValidatorToolCallCap : Infinity;
      const failSession = (message: string, data?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        logger?.log({
          sessionId: session.sessionId,
          agentType: opts.agentType,
          missionId: opts.missionId,
          milestoneId: opts.milestoneId,
          unitId: opts.unitId,
          event: "failed",
          data,
        });
        emitOutput(opts, "failed", message, data);
        resolveCompleted({ status: "failed", sessionId: session.sessionId, error: message });
      };
      const completeSuccessfully = (message: string) => {
        if (settled) return;
        settled = true;
        logger?.log({
          sessionId: session.sessionId,
          agentType: opts.agentType,
          missionId: opts.missionId,
          milestoneId: opts.milestoneId,
          unitId: opts.unitId,
          event: "completed",
        });
        emitOutput(opts, "completed", message);
        resolveCompleted({ status: "completed", sessionId: session.sessionId });
      };

      onWorkerHandoffAccepted = () => {
        workerHandoffAccepted = true;
        completeSuccessfully("Worker handoff accepted; ending session.");
        session.abort();
      };

      let refreshTimeoutOnActivity: (activity: string) => void = () => {};
      const activeToolExecutions = new Set<string>();
      let toolExecCounter = 0;

      const unsubscribe = session.subscribe(async (event: any) => {
        if (settled) return;

        if (event.type === "tool_execution_start") {
          const id = typeof event.toolCallId === "string" ? event.toolCallId : `${event.toolName ?? "tool"}:${++toolExecCounter}`;
          activeToolExecutions.add(id);
          refreshTimeoutOnActivity(`tool_start:${event.toolName ?? "unknown"}`);
        }

        if (event.type === "tool_execution_update") {
          refreshTimeoutOnActivity(`tool_update:${event.toolName ?? "unknown"}`);
        }

        if (event.type === "tool_execution_end") {
          if (typeof event.toolCallId === "string") {
            activeToolExecutions.delete(event.toolCallId);
          } else if (event.toolName) {
            const prefix = `${event.toolName}:`;
            for (const id of activeToolExecutions) {
              if (id.startsWith(prefix)) {
                activeToolExecutions.delete(id);
                break;
              }
            }
          }
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "tool_result",
            data: {
            tool: event.toolName,
            isError: event.isError,
            resultTruncated: typeof event.result === "string"
              ? event.result.slice(0, 200)
              : undefined,
            resultLength: typeof event.result === "string"
              ? event.result.length
              : undefined,
          },
          });
          refreshTimeoutOnActivity(`tool_end:${event.toolName ?? "unknown"}`);
        }

        if (event.type === "agent_end") {
          if (workerHandoffRequired && !workerHandoffAccepted) {
            failSession("Worker session ended before submitting an accepted write_handoff.", {
              error: "worker_handoff_missing",
            });
          } else {
            completeSuccessfully("Agent completed successfully");
          }
        }

        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "error") {
            settled = true;
            const errorMsg = event.assistantMessageEvent.message ?? "unknown error";
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "failed",
              data: { error: errorMsg },
            });
            emitOutput(opts, "failed", `Agent failed: ${errorMsg}`, { error: errorMsg });
            resolveCompleted({
              status: "failed",
              sessionId: session.sessionId,
              error: errorMsg,
            });
          }

          const toolName = event.assistantMessageEvent?.toolCall?.name;
          const toolInput = (event.assistantMessageEvent?.toolCall?.arguments ?? event.assistantMessageEvent?.toolCall?.input) as Record<string, unknown> | undefined;
          if (toolName) {
            toolCallCount++;

            // Loop detection: track a signature of (toolName + serialized args).
            // If the same call repeats beyond the threshold, the LLM is stuck
            // in a loop that activity-extended timeouts would otherwise let
            // run for the full maxTimeout. Abort immediately with a clear error.
            const toolSignature = `${toolName}:${JSON.stringify(toolInput ?? {})}`;
            recentToolCalls.push(toolSignature);
            if (recentToolCalls.length > LOOP_DETECTION_THRESHOLD) {
              recentToolCalls.shift();
            }
            if (
              recentToolCalls.length === LOOP_DETECTION_THRESHOLD
              && recentToolCalls.every((sig) => sig === toolSignature)
            ) {
              settled = true;
              session.abort();
              const errMsg = `tool_call_loop_detected: ${toolName} called ${LOOP_DETECTION_THRESHOLD} times consecutively with identical arguments`;
              logger?.log({
                sessionId: session.sessionId,
                agentType: opts.agentType,
                missionId: opts.missionId,
                milestoneId: opts.milestoneId,
                unitId: opts.unitId,
                event: "failed",
                data: { error: errMsg, tool: toolName, toolCallCount },
              });
              emitOutput(opts, "failed", errMsg, { error: errMsg, tool: toolName });
              resolveCompleted({
                status: "failed",
                sessionId: session.sessionId,
                error: errMsg,
              });
              return;
            }

            // Optional validator tool-call cap enforcement. By default
            // validators rely on timeout/cost bounds, but deployments can
            // configure a hard cap for tighter control.
            if (toolCallCount > toolCallCap) {
              settled = true;
              session.abort();
              const errMsg = `${TOOL_CALL_CAP_EXCEEDED}: ${toolCallCount} calls (cap ${toolCallCap})`;
              logger?.log({
                sessionId: session.sessionId,
                agentType: opts.agentType,
                missionId: opts.missionId,
                milestoneId: opts.milestoneId,
                unitId: opts.unitId,
                event: "failed",
                data: { error: errMsg, toolCallCount, toolCallCap },
              });
              emitOutput(opts, "failed", errMsg, { toolCallCount, toolCallCap });

              // NOTE: The synthetic verdict is NOT written here. The
              // subscribe callback is async but the Pi SDK doesn't await
              // it, so the verdict POST races with resolveCompleted.
              // Instead, the milestone-loop writes the synthetic verdict
              // after handle.completed resolves, guaranteeing it lands
              // before getVerdicts runs.

              resolveCompleted({
                status: "failed",
                sessionId: session.sessionId,
                error: errMsg,
              });
              return;
            }
            const snippet = extractToolSnippet(toolName, toolInput || {});
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "tool_call",
              data: { tool: toolName, input: toolInput },
            });
            emitOutput(opts, "tool_call", `${toolName} ${snippet}`, { tool: toolName, snippet });
            refreshTimeoutOnActivity(`tool:${toolName}`);
          }

          const usage = event.assistantMessageEvent?.usage;
          if (usage) {
            const promptTokens = usage.promptTokens ?? 0;
            const completionTokens = usage.completionTokens ?? 0;
            const tokenDelta = (promptTokens + completionTokens) - cumulativeTokens;
            const rawCost = usage.cost;
            let delta = typeof rawCost === "number"
              ? rawCost
              : typeof rawCost?.total === "number"
                ? rawCost.total
                : 0;

            // Warn on unexpected cost shapes (e.g. provider returns the
            // string "free" or an unstructured object) so mispriced models
            // surface in logs. We still treat them as zero-cost below.
            // Note: `delta === 0` is implied — a non-numeric rawCost with
            // no numeric `.total` always yields delta 0 above.
            const isUnexpectedCostShape =
              rawCost !== undefined &&
              typeof rawCost !== "number" &&
              typeof rawCost?.total !== "number";
            if (isUnexpectedCostShape) {
              // eslint-disable-next-line no-console
              console.warn("[spawner] Unexpected usage.cost shape:", rawCost);
            }

            // If cost is 0 (model registered with no pricing), estimate from tokens.
            // MiniMax-M3: ~$0.10/M input, ~$0.30/M output (conservative defaults).
            if (delta === 0 && (promptTokens > 0 || completionTokens > 0)) {
              const estimatedCost = (promptTokens * 0.0000001) + (completionTokens * 0.0000003);
              delta = estimatedCost;
            }

            // Nothing meaningful to record: zero cost delta AND zero
            // tokens. Skip the cost_update log/onCost so malformed or
            // empty provider payloads don't pollute cost tracking. The
            // unexpected-shape warn above already surfaced bad shapes.
            const hasNoCostOrTokens =
              delta === 0 && promptTokens === 0 && completionTokens === 0;
            if (hasNoCostOrTokens) {
              return;
            }

            // Always track tokens even if cost is 0
            const newCumulativeTokens = cumulativeTokens + promptTokens + completionTokens;
            cumulativeCost += delta;
            cumulativeTokens = newCumulativeTokens;
            missionCumulativeCost += delta;
            missionCumulativeTokens += promptTokens + completionTokens;

            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "cost_update",
              data: { cost: delta, cumulativeCost, cumulativeTokens, missionCumulativeCost, missionCumulativeTokens },
            });

            emitOutput(opts, "cost_update", `Cost: $${delta.toFixed(4)} (${promptTokens}+${completionTokens} tokens)`, { cost: delta, cumulativeCost, cumulativeTokens, missionCumulativeCost, missionCumulativeTokens, promptTokens, completionTokens });

            lapis.logCost({
              missionId: opts.missionId,
              agentSessionId: session.sessionId,
              model: opts.agentType,
              promptTokens: usage.promptTokens ?? 0,
              completionTokens: usage.completionTokens ?? 0,
              cost: delta,
              timestamp: new Date().toISOString(),
            }).catch(() => {});

            config.onCost?.(opts.missionId, missionCumulativeCost, missionCumulativeTokens, delta);
            refreshTimeoutOnActivity("usage");
          }
        }
      });

      // timeout <= 0 disables the deadline entirely — agent runs until it
      // finishes naturally or is aborted for other reasons (cost cap, tool
      // cap, explicit abort). For workers, callers can opt into an
      // activity-extended timeout: tool/cost activity refreshes the idle
      // window while maxTimeout keeps runaway sessions bounded.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutStartedAt = Date.now();
      let lastTimeoutLogAt = 0;
      const extendTimeoutOnActivity = opts.extendTimeoutOnActivity === true;
      const maxTimeout = Math.max(timeout, opts.maxTimeout ?? timeout);
      const fireTimeout = () => {
        if (settled) return;

        if (extendTimeoutOnActivity && activeToolExecutions.size > 0) {
          const elapsed = Date.now() - timeoutStartedAt;
          const remainingTotal = maxTimeout - elapsed;
          if (remainingTotal > 0) {
            const nextDelay = Math.min(timeout, remainingTotal);
            scheduleTimeout(nextDelay);
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "config_decision",
              data: {
                decision: "timeout_extended",
                activity: "active_tool_execution",
                activeToolExecutions: activeToolExecutions.size,
                nextDelay,
                maxTimeout,
                elapsed,
              },
            });
            return;
          }
        }

        settled = true;
        session.abort();
        logger?.log({
          sessionId: session.sessionId,
          agentType: opts.agentType,
          missionId: opts.missionId,
          milestoneId: opts.milestoneId,
          unitId: opts.unitId,
          event: "timed_out",
        });
        emitOutput(opts, "timed_out", "Agent timed out");
        resolveCompleted({ status: "timed_out", sessionId: session.sessionId });
      };
      const scheduleTimeout = (delayMs: number) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(fireTimeout, delayMs);
        // Avoid keeping the process alive solely because of the timeout
        if (typeof timeoutId === "object" && timeoutId && "unref" in timeoutId) {
          (timeoutId as { unref: () => void }).unref();
        }
      };
      refreshTimeoutOnActivity = (activity: string) => {
        if (!extendTimeoutOnActivity || timeout <= 0 || settled) return;
        const elapsed = Date.now() - timeoutStartedAt;
        const remainingTotal = maxTimeout - elapsed;
        if (remainingTotal <= 0) return;
        const nextDelay = Math.min(timeout, remainingTotal);
        scheduleTimeout(nextDelay);
        if (elapsed - lastTimeoutLogAt >= 10_000) {
          lastTimeoutLogAt = elapsed;
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "config_decision",
            data: { decision: "timeout_extended", activity, nextDelay, maxTimeout, elapsed },
          });
        }
      };
      if (timeout > 0) {
        scheduleTimeout(timeout);
      } else {
        logger?.log({
          sessionId: session.sessionId,
          agentType: opts.agentType,
          missionId: opts.missionId,
          milestoneId: opts.milestoneId,
          unitId: opts.unitId,
          event: "config_decision",
          data: { decision: "timeout_disabled", note: "Agent will run to completion (no deadline)", timeout },
        });
      }

      logger?.log({
        sessionId: session.sessionId,
        agentType: opts.agentType,
        missionId: opts.missionId,
        milestoneId: opts.milestoneId,
        unitId: opts.unitId,
        event: "prompt_sent",
      });
      emitOutput(opts, "prompt_sent", "Task prompt sent");

      session.prompt(opts.taskPrompt).catch((err: Error) => {
        if (!settled) {
          settled = true;
          const errMsg = err.message;
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "failed",
            data: { error: errMsg },
          });
          emitOutput(opts, "failed", `Agent failed: ${errMsg}`, { error: errMsg });
          resolveCompleted({
            status: "failed",
            sessionId: session.sessionId,
            error: errMsg,
          });
        }
      });

      const handle: SpawnHandle = {
        sessionId: session.sessionId,
        completed,
        abort() {
          if (!settled) {
            settled = true;
            session.abort();
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "aborted",
            });
            emitOutput(opts, "aborted", "Agent aborted");
            resolveCompleted({ status: "failed", sessionId: session.sessionId, error: "aborted" });
          }
        },
        dispose() {
          activeHandles.delete(session.sessionId);
          session.dispose();
        },
      };

      activeHandles.set(session.sessionId, handle);

      completed.finally(() => {
        if (timeout > 0 && typeof timeoutId !== "undefined") {
          clearTimeout(timeoutId);
        }
        unsubscribe();
        activeHandles.delete(session.sessionId);
      });

      return handle;
    },

    shutdown() {
      for (const [, handle] of activeHandles) {
        handle.abort();
        handle.dispose();
      }
      activeHandles.clear();
      pinyxModelCache.clear();
    },

    getActiveCount(): number {
      return activeHandles.size;
    },

    getActiveSessions(): string[] {
      return [...activeHandles.keys()];
    },
  };
}

/**
 * Extract a human-readable snippet from tool input for display.
 */
function extractToolSnippet(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read": {
      const path = input?.path as string;
      const offset = input?.offset as number | undefined;
      const limit = input?.limit as number | undefined;
      if (offset !== undefined || limit !== undefined) {
        return `${path || "?"}${offset !== undefined ? `:${offset}` : ""}${limit !== undefined ? `-${limit}` : ""}`;
      }
      return path || "?";
    }
    case "write": {
      const path = input?.path as string;
      const content = input?.content as string | undefined;
      const preview = content?.slice(0, 60).replace(/\n/g, " ") || "";
      return `${path || "?"}${preview ? ` — "${preview}${content && content.length > 60 ? "…" : ""}"` : ""}`;
    }
    case "edit": {
      const path = input?.path as string;
      const oldText = input?.oldText as string | undefined;
      const preview = oldText?.slice(0, 40).replace(/\n/g, " ") || "";
      return `${path || "?"}${preview ? ` — "${preview}${oldText && oldText.length > 40 ? "…" : ""}"` : ""}`;
    }
    case "bash": {
      const command = input?.command as string | undefined;
      const preview = command?.slice(0, 60).replace(/\n/g, " ") || "";
      return `"${preview}${command && command.length > 60 ? "…" : ""}"`;
    }
    case "grep": {
      const pattern = input?.pattern || input?.query || "?";
      const path = input?.path as string | undefined;
      return `\`${pattern}\`${path ? ` in ${path}` : ""}`;
    }
    case "find": {
      const path = input?.path as string | undefined;
      const name = input?.name as string | undefined;
      return `${path || "."}${name ? ` -name "${name}"` : ""}`;
    }
    case "ls": {
      const path = input?.path as string | undefined;
      return path || ".";
    }
    default:
      return Object.keys(input || {}).slice(0, 3).map(k => `${k}=${JSON.stringify(input?.[k])?.slice(0, 30)}`).join(" ") || "";
  }
}

function createCustomTools(
  lapis: LaPisClient,
  opts: SpawnOptions,
  getSessionId: () => string,
  onWorkerHandoffAccepted?: () => void,
) {
  if (opts.agentType === "worker") {
    if (!opts.unitId) {
      throw new Error("worker spawn requires unitId");
    }
    return createWorkerTools(lapis, opts.unitId, {
      onHandoffAccepted: onWorkerHandoffAccepted,
      worktreePath: opts.cwd,
    });
  }

  if (opts.agentType === "validator_scrutiny" || opts.agentType === "validator_user_testing") {
    if (!opts.contractId) {
      throw new Error(`${opts.agentType} spawn requires contractId`);
    }
    return createValidatorTools(lapis, {
      milestoneId: opts.milestoneId,
      contractId: opts.contractId,
      validatorType: opts.agentType,
      getSessionId,
    });
  }

  if (opts.agentType === "research") {
    return createResearchTools(lapis, {
      missionId: opts.missionId,
      getAuthorId: getSessionId,
    });
  }

  return [];
}

// Cache resolved PiNyx model configs keyed by model ID to avoid
// re-creating AuthStorage/ModelRegistry on every spawn call.
const pinyxModelCache = new Map<string, { model: any; modelRegistry: any; authStorage: any }>();

async function resolvePinyxModel(lapis: LaPisClient, modelId: string | undefined) {
  if (!modelId) return null;

  if (typeof lapis.getSetting !== "function") {
    console.warn(`[spawner] Cannot resolve PiNyx model "${modelId}": lapis.getSetting is not available`);
    return null;
  }
  const saved = await lapis.getSetting<{ endpoint?: string }>("pinyx_config").catch((err) => {
    console.warn(`[spawner] Failed to fetch pinyx_config for model "${modelId}":`, err instanceof Error ? err.message : err);
    return null;
  });
  const endpoint = saved?.endpoint?.replace(/\/$/, "");
  if (!endpoint) {
    console.warn(`[spawner] Cannot resolve PiNyx model "${modelId}": no endpoint configured in pinyx_config`);
    return null;
  }

  const cacheKey = `${endpoint}::${modelId}`;
  const cached = pinyxModelCache.get(cacheKey);
  if (cached) return cached;

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("pinyx", "pinyx");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider("pinyx", {
    name: "PiNyx",
    baseUrl: `${endpoint}/v1`,
    apiKey: "pinyx",
    api: "openai-completions",
    models: [{
      id: modelId,
      name: modelId,
      api: "openai-completions",
      baseUrl: `${endpoint}/v1`,
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 16_384,
      cost: resolveModelCost(modelId),
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    }],
  });

  const model = modelRegistry.find("pinyx", modelId);
  if (!model) {
    throw new Error(`Unable to register PiNyx model ${modelId}`);
  }

  const result = { model, modelRegistry, authStorage };
  pinyxModelCache.set(cacheKey, result);
  return result;
}

/** Resolve per-token cost (USD) for known models. Returns 0 for unknown models,
 *  which causes the spawner's token-based fallback to estimate cost instead. */
function resolveModelCost(modelId: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  // Pricing per 1 token (USD). Convert from per-million by dividing by 1,000,000.
  const KNOWN_COSTS: Record<string, { input: number; output: number }> = {
    // MiniMax
    "minimax/MiniMax-M3": { input: 0.1 / 1_000_000, output: 0.3 / 1_000_000 },
    "minimax/MiniMax-M1": { input: 0.1 / 1_000_000, output: 0.3 / 1_000_000 },
    // OpenAI
    "openai/gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    "openai/gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    "openai/o3": { input: 2.0 / 1_000_000, output: 8.0 / 1_000_000 },
    "openai/o4-mini": { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
    // Anthropic
    "anthropic/claude-sonnet-4-20250514": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    "anthropic/claude-3.5-sonnet": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    // Google
    "google/gemini-2.5-pro": { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
    "google/gemini-2.5-flash": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  };

  // Try exact match first, then prefix match
  const exact = KNOWN_COSTS[modelId];
  if (exact) return { input: exact.input, output: exact.output, cacheRead: 0, cacheWrite: 0 };

  const prefix = modelId.split("/")[0] + "/";
  const prefixMatch = Object.entries(KNOWN_COSTS).find(([k]) => k.startsWith(prefix));
  if (prefixMatch) return { input: prefixMatch[1].input, output: prefixMatch[1].output, cacheRead: 0, cacheWrite: 0 };

  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
