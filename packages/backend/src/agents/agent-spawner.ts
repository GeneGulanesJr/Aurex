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
  /** Max tool calls for a validator session before auto-fail. Default 25. */
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
  const { lapis, agentDir, defaultTimeout, logger, eventBus, maxConcurrent, validatorToolCallCap = 40 } = config;
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
      const customTools = createCustomTools(lapis, opts, () => sessionId);
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
      let toolCallCount = 0;
      const isValidatorSession = opts.agentType === "validator_scrutiny" || opts.agentType === "validator_user_testing";
      const toolCallCap = isValidatorSession ? validatorToolCallCap : Infinity;

      const unsubscribe = session.subscribe(async (event: any) => {
        if (settled) return;

        if (event.type === "agent_end") {
          settled = true;
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "completed",
          });
          emitOutput(opts, "completed", "Agent completed successfully");
          resolveCompleted({ status: "completed", sessionId: session.sessionId });
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
            // Validator tool-call cap enforcement: abort and force a
            // synthetic fail verdict if the model keeps making tool calls
            // without producing a verdict. The cap is the only thing
            // bounding the validator's runtime — the Pi SDK session loop
            // has no built-in maxSteps.
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
          }

          const usage = event.assistantMessageEvent?.usage;
          if (usage) {
            const rawCost = usage.cost;
            const delta = typeof rawCost === "number"
              ? rawCost
              : typeof rawCost?.total === "number"
                ? rawCost.total
                : 0;
            if (delta === 0 && typeof usage.totalTokens !== "number") return;
            cumulativeCost += delta;
            cumulativeTokens += usage.totalTokens ?? 0;
            missionCumulativeCost += delta;
            missionCumulativeTokens += usage.totalTokens ?? 0;

            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "cost_update",
              data: { cost: delta, cumulativeCost, cumulativeTokens, missionCumulativeCost, missionCumulativeTokens },
            });

            emitOutput(opts, "cost_update", `Cost: $${delta.toFixed(4)}`, { cost: delta, cumulativeCost, cumulativeTokens, missionCumulativeCost, missionCumulativeTokens });

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
          }
        }
      });

      const timeoutId = setTimeout(() => {
        if (!settled) {
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
        }
      }, timeout);

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
        clearTimeout(timeoutId);
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
) {
  if (opts.agentType === "worker") {
    if (!opts.unitId) {
      throw new Error("worker spawn requires unitId");
    }
    return createWorkerTools(lapis, opts.unitId);
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

  const cached = pinyxModelCache.get(modelId);
  if (cached) return cached;

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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
  pinyxModelCache.set(modelId, result);
  return result;
}
