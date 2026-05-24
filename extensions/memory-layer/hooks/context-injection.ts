import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MEMORY_REMINDER_INTERVAL, MemResult, state } from '../state';
import { getKnownRepos, isRepoStale } from '../host/project-detector';
import { mem } from '../host/memory-client';
import { CONTEXT } from '../../../constants';
import path from 'node:path';
import fs from 'node:fs';

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

    const promptQuery = extractUserPrompt(event);
    if (isSourceAuthoritativePrompt(promptQuery)) {
      deps.state.hasInjectedContext = true;
      return {
        message: {
          customType: 'source-authoritative-guidance',
          content:
            'Current-source question detected. Answer from the working tree, not stored memory. Prefer targeted source inspection for named files, modules, or symbols; indexed code-memory may be stale.',
          display: false,
        },
      };
    }

    const contextLimit = promptQuery ? CONTEXT.PROMPT_RELEVANT_LIMIT : CONTEXT.DEFAULT_LIMIT;
    const contextResult = await deps.mem('context', {
      project: deps.state.currentProject,
      limit: String(contextLimit),
      ...(promptQuery ? { query: promptQuery } : {}),
      ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
    });

    let recentContextResult: MemResult | null = null;
    if (promptQuery && !((contextResult?.observations as any[]) || []).length) {
      recentContextResult = await deps.mem('context', {
        project: deps.state.currentProject,
        limit: String(CONTEXT.DEFAULT_LIMIT),
        ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
      });
    }

    let crossProjectResult: MemResult | null = null;

    const projectContext = recentContextResult || contextResult;

    if (!projectContext || !((projectContext.observations as any[]) || []).length) {
      crossProjectResult = await deps.mem('context', {
        'all-projects': 'true',
        limit: String(Math.max(CONTEXT.DEFAULT_LIMIT - 3, 5)),
        ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
      });
    }

    if (!projectContext && !crossProjectResult) {
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

    const effectiveContext = projectContext || crossProjectResult;

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

    // Resolve repo staleness early (needed for lightweight path decision)
    const repos = await deps.getKnownRepos();
    const resolvedCwd = path.resolve(ctx.cwd);
    const cwdRepo =
      repos.find((r) => resolvedCwd.startsWith(path.resolve(r.path))) ||
      repos.find((r) => r.name.toLowerCase() === deps.state.currentProject?.toLowerCase());
    const isStale = cwdRepo ? deps.isRepoStale(cwdRepo) : false;

    // Lightweight path: stale index + no observations + no personal prefs
    // Emit only the stale guidance instead of a full context block
    if (observations.length === 0 && personal.length === 0 && !crossProjectResult) {
      if (isStale && cwdRepo) {
        deps.state.hasInjectedContext = true;
        const lines: string[] = [
          '## Memory Context (auto-loaded)',
          '',
          `Project: **${deps.state.currentProject}** | ${stats?.total_memories || 0} memories | ${stats?.total_personal || 0} personal preferences`,
          '',
          CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo.name),
          '',
          'Use `memory-save`, `memory-search`, and `memory-get` tools to interact with memory.',
        ];

        // Extension location hint
        appendExtensionHint(lines, ctx.cwd);

        return {
          message: {
            customType: 'memory-context',
            content: lines.join('\n'),
            display: false,
          },
        };
      }
      return;
    }

    const isNewProject = crossProjectResult !== null && !projectContext;
    const effectiveObservations = isNewProject ? (crossProjectResult!.observations as any[]) || [] : observations;
    const effectiveStats = isNewProject ? (crossProjectResult!.stats as any) : stats;

    deps.state.hasInjectedContext = true;

    const topicNote = topic ? ` | topic: ${topic}` : '';
    const lines: string[] = ['## Memory Context (auto-loaded)', ''];

    // Lightweight mode: stale index + no relevant observations + no personal prefs
    const useLightweight = isStale && effectiveObservations.length === 0 && personal.length === 0;

    if (useLightweight) {
      lines.push(
        `Project: **${deps.state.currentProject}** | ${stats?.total_memories || 0} memories | ${stats?.total_personal || 0} personal preferences`,
      );
      lines.push('');
      lines.push(CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo!.name));
      lines.push('');
      lines.push('Use `memory-save`, `memory-search`, and `memory-get` tools to interact with memory.');
    } else {
      // Full context (existing behavior)
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

      if (!cwdRepo) {
        lines.push('');
        lines.push(
          `⚠️ **Code not indexed:** Project "${deps.state.currentProject}" has no code index yet. Run \`memory-code index-repo --path ${ctx.cwd} --name ${deps.state.currentProject}\` to enable memory-code analysis.`,
        );
      } else if (isStale) {
        lines.push('');
        lines.push(CONTEXT.STALE_GUIDANCE.replace('{repo}', cwdRepo.name));
      }
    }

    // Extension location hint
    appendExtensionHint(lines, ctx.cwd);

    return {
      message: {
        customType: 'memory-context',
        content: lines.join('\n'),
        display: false,
      },
    };
  });
}

/**
 * Pull the current user prompt out of Pi hook events when available. The
 * before-agent hook runs after Pi has assembled messages, but exact event shape
 * differs across Pi versions, so this accepts the known string and content-part
 * forms and falls back quietly.
 */
export function extractUserPrompt(event: unknown): string | null {
  const eventAny = event as any;
  const candidates: unknown[] = [eventAny?.prompt, eventAny?.input, eventAny?.query];
  const messages = Array.isArray(eventAny?.messages) ? eventAny.messages : [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user') {
      candidates.push(message.content);
      break;
    }
  }

  for (const candidate of candidates) {
    const text = contentToText(candidate);
    if (text) {
      return text.length > 500 ? `${text.slice(0, 500)}...` : text;
    }
  }

  return null;
}

export function isSourceAuthoritativePrompt(prompt: string | null): boolean {
  if (!prompt) {
    return false;
  }

  const normalized = prompt.toLowerCase();
  return (
    /\bcurrent source\b/.test(normalized) ||
    /\bcurrent code\b/.test(normalized) ||
    /\bfrom the code\b/.test(normalized) ||
    /\banswer from (?:the )?code\b/.test(normalized)
  );
}

function contentToText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed || null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof (part as any).text === 'string') {
          return (part as any).text;
        }
        return '';
      })
      .join('\n')
      .trim();
    return text || null;
  }

  return null;
}

/**
 * Append a one-line hint about the extension source location when the project
 * has a local extensions/memory-layer/ directory. This prevents the LLM from
 * searching ~/.pi/agent/ paths when looking for extension code.
 */
function appendExtensionHint(lines: string[], cwd: string) {
  const extensionDir = path.join(cwd, 'extensions', 'memory-layer');
  try {
    const extStat = fs.statSync(extensionDir);
    if (extStat.isDirectory()) {
      lines.push('');
      lines.push('📂 Extension source: `extensions/memory-layer/` in this project repo.');
    }
  } catch {
    // No local extension dir — skip hint
  }
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
