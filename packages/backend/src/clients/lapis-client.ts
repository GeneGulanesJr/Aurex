import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';

const execFileAsync = promisify(execFile);

export interface MemoryResult {
  id: string;
  type: string;
  title: string;
  content: string;
  project: string;
  score: number;
}

export interface ContextResult {
  memories: MemoryResult[];
  project: string;
}

export interface LaPisClient {
  saveMemory(params: {
    type: string;
    title: string;
    content: string;
    project?: string;
  }): Promise<{ id: string }>;

  searchMemory(
    query: string,
    opts?: { project?: string; includeCode?: boolean },
  ): Promise<MemoryResult[]>;

  getContext(project: string): Promise<ContextResult>;

  injectMemories(sessionId: string, memoryIds: string[]): Promise<void>;
}

export function createLaPisClient(config: AppConfig): LaPisClient {
  const dbArgs = ['--db', config.lapisDbPath];

  async function runCli(command: string, extra: string[]): Promise<string> {
    const args = [command, ...dbArgs, ...extra];

    const cmd = config.lapisCliPath || 'npx';
    const fullArgs = config.lapisCliPath
      ? args
      : ['@genegulanesjr/lapis', ...args];

    try {
      const { stdout } = await execFileAsync(cmd, fullArgs, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      throw new Error(
        `LaPis CLI error: ${error.stderr || error.message || String(err)}`,
      );
    }
  }

  return {
    async saveMemory({ type, title, content, project }) {
      const extra = ['--type', type, '--title', title, '--content', content];
      if (project) extra.push('--project', project);
      const output = await runCli('save', extra);
      const parsed = JSON.parse(output);
      return { id: String(parsed.id || parsed) };
    },

    async searchMemory(query, opts = {}) {
      const extra = ['--query', query];
      if (opts.project) extra.push('--project', opts.project);
      if (opts.includeCode) extra.push('--include-code');
      const output = await runCli('search', extra);
      return JSON.parse(output) as MemoryResult[];
    },

    async getContext(project) {
      const args = ['--project', project];
      const output = await runCli('context', args);
      return JSON.parse(output) as ContextResult;
    },

    async injectMemories(sessionId, memoryIds) {
      const extra = [
        '--session', sessionId,
        '--memory-ids', memoryIds.join(','),
      ];
      await runCli('inject', extra);
    },
  };
}
