import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentType, WorkerStatus } from "@aurex/shared";
import { AGENT_TOOLS } from "./factory.js";
import { createWorkerTools } from "./worker-tools.js";
import { createValidatorTools } from "./validator-tools.js";
import { createResearchTools } from "./research-tools.js";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { AgentLogger } from "./agent-logger.js";
import path from "node:path";

export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
  logger?: AgentLogger;
  maxConcurrent?: number;
  onCost?: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export interface SpawnOptions {
  agentType: AgentType;
  unitId?: string;
  missionId: string;
  milestoneId: string;
  contractId?: string;
  cwd: string;
  skillFilePath: string;
  contextContent: string;
  taskPrompt: string;
  timeout?: number;
}

export interface SpawnHandle {
  sessionId: string;
  completed: Promise<SpawnResult>;
  abort(): void;
  dispose(): void;
}

export interface SpawnResult {
  status: "completed" | "timed_out" | "failed";
  sessionId: string;
  error?: string;
}

export function createAgentSpawner(config: AgentSpawnerConfig) {
  const { lapis, agentDir, defaultTimeout, logger, maxConcurrent } = config;
  const activeHandles = new Map<string, SpawnHandle>();

  return {
    async spawn(opts: SpawnOptions): Promise<SpawnHandle> {
      if (maxConcurrent && activeHandles.size >= maxConcurrent) {
        throw new Error(
          `AgentSpawner concurrency limit reached (${maxConcurrent}). ` +
          `Active sessions: ${[...activeHandles.keys()].join(", ")}`,
        );
      }

      const timeout = opts.timeout ?? defaultTimeout;
      const tools = AGENT_TOOLS[opts.agentType];
      let sessionId = "";
      const customTools = createCustomTools(lapis, opts, () => sessionId);
      let cumulativeCost = 0;
      let cumulativeTokens = 0;

      const skillBaseDir = path.dirname(opts.skillFilePath);
      const loader = new DefaultResourceLoader({
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
        agentsFilesOverride: (current: any) => ({
          agentsFiles: [
            ...current.agentsFiles,
            {
              path: "/virtual/aurex-context.md",
              content: opts.contextContent,
            },
          ],
          diagnostics: current.diagnostics,
        }),
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: opts.cwd,
        agentDir,
        tools,
        customTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(opts.cwd),
      });
      sessionId = session.sessionId;

      if ((opts as any)._validatorCtx) {
        (opts as any)._validatorCtx.sessionId = session.sessionId;
      }

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

      let resolveCompleted!: (result: SpawnResult) => void;
      const completed = new Promise<SpawnResult>((resolve) => {
        resolveCompleted = resolve;
      });

      let settled = false;
      const unsubscribe = session.subscribe((event: any) => {
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
          resolveCompleted({ status: "completed", sessionId: session.sessionId });
        }

        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "error") {
            settled = true;
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "failed",
              data: { error: event.assistantMessageEvent.message },
            });
            resolveCompleted({
              status: "failed",
              sessionId: session.sessionId,
              error: event.assistantMessageEvent.message ?? "unknown error",
            });
          }

          const toolName = event.assistantMessageEvent?.toolCall?.name;
          if (toolName) {
            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "tool_call",
              data: { tool: toolName },
            });
          }

          const usage = event.assistantMessageEvent?.usage;
          if (usage && typeof usage.cost === "number") {
            const delta = usage.cost;
            cumulativeCost += delta;
            cumulativeTokens += usage.totalTokens ?? 0;

            logger?.log({
              sessionId: session.sessionId,
              agentType: opts.agentType,
              missionId: opts.missionId,
              milestoneId: opts.milestoneId,
              unitId: opts.unitId,
              event: "cost_update",
              data: { cost: delta, cumulativeCost, cumulativeTokens },
            });

            lapis.logCost({
              missionId: opts.missionId,
              agentSessionId: session.sessionId,
              model: opts.agentType,
              promptTokens: usage.promptTokens ?? 0,
              completionTokens: usage.completionTokens ?? 0,
              cost: delta,
              timestamp: new Date().toISOString(),
            }).catch(() => {});

            config.onCost?.(opts.missionId, cumulativeCost, cumulativeTokens, delta);
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

      session.prompt(opts.taskPrompt).catch((err: Error) => {
        if (!settled) {
          settled = true;
          logger?.log({
            sessionId: session.sessionId,
            agentType: opts.agentType,
            missionId: opts.missionId,
            milestoneId: opts.milestoneId,
            unitId: opts.unitId,
            event: "failed",
            data: { error: err.message },
          });
          resolveCompleted({
            status: "failed",
            sessionId: session.sessionId,
            error: err.message,
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
      authorId: getSessionId(),
    });
  }

  return [];
}
