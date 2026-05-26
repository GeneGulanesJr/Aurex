import { MEMORY_REMINDER_INTERVAL, MemResult, state } from '../state';
import { getKnownRepos, isRepoStale } from '../host/project-detector';
import { CONTEXT } from '../../../constants';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import { mem } from '../host/memory-client';
import path from 'node:path';

interface ContextDeps {
  state: typeof state;
  mem: typeof mem;
  getKnownRepos: typeof getKnownRepos;
  isRepoStale: typeof isRepoStale;
  /**
   * Optional settings reader provided by the extension host.
   * Returns the `contextLimit` setting value (number) or undefined when not set.
   */
  getSettings?: () => { contextLimit?: number };
}

export function registerBeforeAgentStart(pi: ExtensionAPI, deps: ContextDeps) {
  pi.on('before_agent_start', async (event, ctx) => {
    if (!deps.state.currentProject) {
      return;
    }

    const promptQuery = extractUserPrompt(event);
    if (isSourceAuthoritativePrompt(promptQuery)) {
      const repos = await deps.getKnownRepos();
      const guidance = buildSourceLookupGuidance(repos, ctx.cwd, deps.state.currentProject);
      if (guidance) {
        return {
          message: {
            customType: 'memory-code-guidance',
            content: guidance,
            display: false,
          },
        };
      }
      return;
    }

    // Read optional contextLimit override from extension settings; fall back to defaults
    const settingsContextLimit = deps.getSettings?.().contextLimit;
    const contextLimit = settingsContextLimit != null && settingsContextLimit > 0
      ? settingsContextLimit
      : (promptQuery ? CONTEXT.PROMPT_RELEVANT_LIMIT : CONTEXT.PROJECT_SUMMARY_LIMIT);
    const contextResult = await deps.mem('context', {
      project: deps.state.currentProject,
      limit: String(contextLimit),
      ...(promptQuery ? { query: promptQuery } : {}),
      ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
    });

    let crossProjectResult: MemResult | null = null;
    const projectContext = contextResult;
    if (!projectContext) {
      crossProjectResult = await deps.mem('context', {
        'all-projects': 'true',
        limit: String(CONTEXT.PROJECT_SUMMARY_LIMIT),
        ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
      });
    }

    if (!projectContext && !crossProjectResult) {
      return {
        message: {
          customType: 'memory-context',
          content:
            '⚠️ Memory context failed to load. Use `memory-search` and `memory-save` manually.',
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
        content?: string;
      }>) || [];

    const stats = effectiveContext.stats as { total_memories: number; total_personal: number };

    // Resolve repo staleness
    const repos = await deps.getKnownRepos();
    const resolvedCwd = path.resolve(ctx.cwd);
    const cwdRepo =
      repos.find((r) => resolvedCwd.startsWith(path.resolve(r.path))) ||
      repos.find((r) => r.name.toLowerCase() === deps.state.currentProject?.toLowerCase());
    const isStale = cwdRepo ? deps.isRepoStale(cwdRepo) : false;

    const isNewProject = crossProjectResult !== null && !projectContext;
    let effectiveObservations: any[] = [];
    if (promptQuery) {
      effectiveObservations = isNewProject ? (crossProjectResult!.observations as any[]) || [] : observations;
    }
    const effectiveStats = isNewProject ? (crossProjectResult!.stats as any) : stats;

    deps.state.hasInjectedContext = true;

    const projectDir = cwdRepo?.path || ctx.cwd;
    const projectSummary = getProjectSummary(projectDir);
    const lines: string[] = [];

    // --- Lean header (one line) ---
    if (isNewProject) {
      lines.push(
        `🧠 **${deps.state.currentProject}** — new project · ${effectiveStats?.total_memories || 0} memories across all projects`,
      );
    } else {
      const indexPart = cwdRepo
        ? `${cwdRepo.file_count} files indexed${isStale ? ' (stale)' : ''}`
        : 'not indexed';
      lines.push(
        `🧠 **${deps.state.currentProject}** — ${effectiveStats?.total_memories || 0} memories · ${indexPart} · ${projectSummary}`,
      );
    }

    // --- Prompt-matched observation: max 1, high trust only, title only ---
    if (effectiveObservations.length > 0) {
      const top = effectiveObservations[0];
      if ((top.trust_score ?? 0) >= CONTEXT.MIN_OBSERVATION_TRUST) {
        lines.push(`- [${top.type}] ${top.title}`);
      }
    }

    // --- Footer (one line) ---
    const footerParts = ['`memory-search` for recall', '`memory-save` for decisions'];
    if (isStale && cwdRepo) {
      footerParts.push(`reindex: \`memory-code reindex-repo --repo ${cwdRepo.name}\``);
    } else if (!cwdRepo) {
      footerParts.push(
        `index: \`memory-code index-repo --path ${ctx.cwd} --name ${deps.state.currentProject}\``,
      );
    }
    lines.push(footerParts.join(' · '));

    return {
      message: {
        customType: 'memory-context',
        content: lines.join('\n'),
        display: false,
      },
    };
  });
}

function buildSourceLookupGuidance(
  repos: Awaited<ReturnType<typeof getKnownRepos>>,
  cwd: string,
  currentProject: string | null,
): string | null {
  const resolvedCwd = path.resolve(cwd);
  const cwdRepo =
    repos.find((r) => resolvedCwd.startsWith(path.resolve(r.path))) ||
    repos.find((r) => r.name.toLowerCase() === currentProject?.toLowerCase());

  if (!cwdRepo) {
    return null;
  }

  return [
    '## Code Lookup Guidance',
    '',
    `Current-source prompt: skip memory facts and verify against code in indexed repo \`${cwdRepo.name}\`.`,
    `For exact symbol or return-shape questions, use \`memory-code search --repo ${cwdRepo.name} --query <query>\`, then a small targeted \`read\` around the reported file/line if the search result is not enough.`,
    'Avoid broad shell code search and skip `memory-code outline` unless the task needs file structure.',
  ].join('\n');
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

export function isHistoricalMemoryPrompt(prompt: string | null): boolean {
  if (!prompt) {
    return false;
  }

  const normalized = prompt.toLowerCase();
  return (
    /\bwhy did\b/.test(normalized) ||
    /\bwhat bug led to\b/.test(normalized) ||
    /\brationale\b/.test(normalized) ||
    /\bdecision\b/.test(normalized) ||
    /\bchoose\b/.test(normalized) ||
    /\bchose\b/.test(normalized)
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

function getProjectSummary(cwd: string): string {
  const packagePath = path.join(cwd, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (typeof pkg.description === 'string' && pkg.description.trim()) {
      return pkg.description.trim();
    }
    if (typeof pkg.name === 'string' && pkg.name.trim()) {
      return `Local project ${pkg.name.trim()}.`;
    }
  } catch {
    // Non-Node projects or unreadable package files fall back to directory name.
  }
  return `Local project directory ${path.basename(cwd) || cwd}.`;
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
