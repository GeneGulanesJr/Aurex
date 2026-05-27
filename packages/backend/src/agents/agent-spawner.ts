// packages/backend/src/agents/agent-spawner.ts
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
import path from "node:path";

export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
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
  /** Resolves when the agent finishes (success, failure, or timeout) */
  completed: Promise<SpawnResult>;
  /** Abort the agent immediately */
  abort(): void;
  /** Dispose of the session resources */
  dispose(): void;
}

export interface SpawnResult {
  status: "completed" | "timed_out" | "failed";
  sessionId: string;
  error?: string;
}

export function createAgentSpawner(config: AgentSpawnerConfig) {
  const { lapis, agentDir, defaultTimeout } = config;

  return {
    async spawn(opts: SpawnOptions): Promise<SpawnHandle> {
      const timeout = opts.timeout ?? defaultTimeout;
      const tools = AGENT_TOOLS[opts.agentType];
      let sessionId = "";
      const customTools = createCustomTools(lapis, opts, () => sessionId);

      // Build ResourceLoader with injected context and skill
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

      // Create Pi SDK session
      const { session } = await createAgentSession({
        cwd: opts.cwd,
        agentDir,
        tools,
        customTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(opts.cwd),
      });
      sessionId = session.sessionId;

      // Register in LaPis
      await lapis.registerAgentSession(
        opts.agentType,
        session.sessionId,
        opts.missionId,
        opts.milestoneId,
        opts.unitId,
      );

      // Update unit status
      if (opts.agentType === "worker" && opts.unitId) {
        await lapis.updateWorkingUnitStatus(opts.unitId, "spawned" as WorkerStatus);
      }

      // Set up completion tracking
      let resolveCompleted!: (result: SpawnResult) => void;
      const completed = new Promise<SpawnResult>((resolve) => {
        resolveCompleted = resolve;
      });

      // Subscribe to events for lifecycle tracking
      let settled = false;
      const unsubscribe = session.subscribe((event: any) => {
        if (settled) return;

        if (event.type === "agent_end") {
          settled = true;
          resolveCompleted({ status: "completed", sessionId: session.sessionId });
        }

        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "error") {
            settled = true;
            resolveCompleted({
              status: "failed",
              sessionId: session.sessionId,
              error: event.assistantMessageEvent.message ?? "unknown error",
            });
          }
        }
      });

      // Start timeout race
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          session.abort();
          resolveCompleted({ status: "timed_out", sessionId: session.sessionId });
        }
      }, timeout);

      // Send the task prompt — completion tracked via events
      session.prompt(opts.taskPrompt).catch((err: Error) => {
        if (!settled) {
          settled = true;
          resolveCompleted({
            status: "failed",
            sessionId: session.sessionId,
            error: err.message,
          });
        }
      });

      // Cleanup on completion
      completed.finally(() => {
        clearTimeout(timeoutId);
        unsubscribe();
      });

      return {
        sessionId: session.sessionId,
        completed,
        abort() {
          if (!settled) {
            settled = true;
            session.abort();
            resolveCompleted({ status: "failed", sessionId: session.sessionId, error: "aborted" });
          }
        },
        dispose() {
          session.dispose();
        },
      };
    },

    shutdown() {
      // Future: track all active handles and abort them
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
