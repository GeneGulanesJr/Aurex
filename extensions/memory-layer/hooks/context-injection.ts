import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MEMORY_REMINDER_INTERVAL, MemResult, state } from '../state';
import { getKnownRepos, isRepoStale } from '../host/project-detector';
import { mem } from '../host/memory-client';
import { CONTEXT } from '../../../../constants';
import path from 'node:path';

interface ContextDeps {
  state: typeof state;
  mem: typeof mem;
  getKnownRepos: typeof getKnownRepos;
  isRepoStale: typeof isRepoStale;
}

export function registerBeforeAgentStart(pi: ExtensionAPI, deps: ContextDeps) {
  pi.on('before_agent_start', async (event, ctx) => {
    if (!deps.state.currentProject) {
      return;
    }

    const contextResult = await deps.mem('context', {
      project: deps.state.currentProject,
      limit: String(CONTEXT.DEFAULT_LIMIT),
      ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
    });

    let crossProjectResult: MemResult | null = null;

    if (!contextResult || !((contextResult.observations as any[]) || []).length) {
      crossProjectResult = await deps.mem('context', {
        'all-projects': 'true',
        limit: String(Math.max(CONTEXT.DEFAULT_LIMIT - 3, 5)),
        ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
      });
    }

    if (!contextResult && !crossProjectResult) {
      return {
        message: {
          customType: 'memory-context',
          content:
            '⚠️ **Memory context failed to load.** Memory operations may be unreliable this session.\n' +
            'Use `memory-search` and `memory-save` manually if needed.',
          display: true,
        },
      };
    }

    const effectiveContext = contextResult || crossProjectResult;

    const observations =
      (effectiveContext.observations as Array<{
        id: number;
        title: string;
        type: string;
        scope: string;
        topic_key: string;
        trust_score: number;
        type_priority: number;
      }>) || [];

    const personal =
      (effectiveContext.personal as Array<{
        id: number;
        title: string;
        type: string;
      }>) || [];

    const stats = effectiveContext.stats as { total_memories: number; total_personal: number };
    const topic = effectiveContext.topic as string | null;

    if (observations.length === 0 && personal.length === 0 && !crossProjectResult) {
      return;
    }

    const isNewProject = crossProjectResult !== null && !contextResult;
    const effectiveObservations = isNewProject ? (crossProjectResult!.observations as any[]) || [] : observations;
    const effectiveStats = isNewProject ? (crossProjectResult!.stats as any) : stats;

    deps.state.hasInjectedContext = true;

    const topicNote = topic ? ` | topic: ${topic}` : '';
    const lines: string[] = ['## Memory Context (auto-loaded)', ''];

    if (isNewProject) {
      lines.push(
        `Project: **${deps.state.currentProject}** | 🆕 new project | ${effectiveStats?.total_memories || 0} total memories across all projects | ${stats?.total_personal || 0} personal preferences`,
      );
      lines.push('');

      const byProject = new Map<string, any[]>();
      for (const o of effectiveObservations) {
        const proj = o.project || 'unknown';
        if (!byProject.has(proj)) {
          byProject.set(proj, []);
        }
        byProject.get(proj)!.push(o);
      }

      if (byProject.size > 0) {
        lines.push('### 🔗 Related memories from other projects');
        for (const [proj, mems] of byProject) {
          lines.push(`**${proj}** (${mems.length} memories)`);
          for (const m of mems.slice(0, 5)) {
            const trust = m.trust_score < 0.5 ? ' ⚠️' : m.trust_score < 0.7 ? ' 🔎' : '';
            lines.push(`- [${m.type}] ${m.title}${trust}`);
          }
        }
        lines.push('');
      }
    } else {
      lines.push(
        `Project: **${deps.state.currentProject}** | ${stats?.total_memories || 0} memories | ${stats?.total_personal || 0} personal preferences${topicNote}`,
      );
      lines.push('');

      if (effectiveObservations.length > 0) {
        lines.push('### Recent Relevant Memory');
        for (const o of effectiveObservations) {
          const trust = o.trust_score < 0.5 ? '⚠️' : o.trust_score < 0.8 ? '🔎' : '';
          lines.push(`- [${o.type}] ${o.title} ${trust}`);
        }
        lines.push('');
      }
    }

    if (personal.length > 0) {
      lines.push('### Your Preferences (cross-project)');
      for (const p of personal.slice(0, 5)) {
        lines.push(`- ${p.title}`);
      }
      lines.push('');
    }

    lines.push('Use `memory-save`, `memory-search`, and `memory-get` tools to interact with memory.');

    const repos = await deps.getKnownRepos();
    const resolvedCwd = path.resolve(ctx.cwd);
    const cwdRepo =
      repos.find((r) => resolvedCwd.startsWith(path.resolve(r.path))) ||
      repos.find((r) => r.name.toLowerCase() === deps.state.currentProject?.toLowerCase());
    if (!cwdRepo) {
      lines.push('');
      lines.push(
        `⚠️ **Code not indexed:** Project \"${deps.state.currentProject}\" has no code index yet. Run \`memory-code index-repo --path ${ctx.cwd} --name ${deps.state.currentProject}\` to enable memory-code analysis.`,
      );
    } else if (deps.isRepoStale(cwdRepo)) {
      lines.push('');
      lines.push(CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo.name));
    }

    return {
      message: {
        customType: 'memory-context',
        content: lines.join('\n'),
        display: false,
      },
    };
  });
}

export function registerContextReminder(pi: ExtensionAPI, deps: ContextDeps) {
  pi.on('context', async (event, _ctx) => {
    if (deps.state.hasInjectedContext) {
      deps.state.hasInjectedContext = false;
      return;
    }

    deps.state.callsSinceLastMemory++;

    if (deps.state.callsSinceLastMemory < MEMORY_REMINDER_INTERVAL) {
      return;
    }

    if (Date.now() - deps.state.lastMemoryToolCall < 180000) {
      return;
    }

    // Reset counter after firing
    deps.state.callsSinceLastMemory = 0;

    return {
      messages: [
        ...event.messages,
        {
          role: 'user' as const,
          content:
            '💡 Memory reminder: Use `memory-search` before decisions to avoid repeating past mistakes. Use `memory-save` for decisions, bugfixes, and discoveries.',
        },
      ],
    };
  });
}
