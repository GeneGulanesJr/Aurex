// packages/backend/src/agents/agent-spawner.ts
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentType, WorkerStatus } from "@aurex/shared";
import { AGENT_TOOLS } from "./factory";
import { createWorkerTools } from "./worker-tools";
import type { LaPisClient } from "../clients/lapis-client";
import path from "node:path";

export interface AgentSpawnerConfig {
  lapis: LaPisClient;
  agentDir: string;
  defaultTimeout: number;
}

export interface SpawnOptions {
  agentType: AgentType;
  unitId: string;
  missionId: string;
  milestoneId: string;
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
      const workerTools = createWorkerTools(lapis, opts.unitId);

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
        customTools: workerTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(opts.cwd),
      });

      // Register in LaPis
      await lapis.registerAgentSession(
        opts.agentType,
        session.sessionId,
        opts.missionId,
        opts.milestoneId,
        opts.unitId,
      );

      // Update unit status
      await lapis.updateWorkingUnitStatus(opts.unitId, "spawned" as WorkerStatus);

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
