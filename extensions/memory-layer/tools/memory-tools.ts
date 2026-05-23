import { mem, memCmd } from '../host/memory-client';
import { state, trustIcon } from '../state';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from './schema';
import { normalizeToolResult } from './tool-result';
import { renderCompactToolResult } from './render';

interface MemoryDeps {
  state: typeof state;
  mem: typeof mem;
  memCmd: typeof memCmd;
  trustIcon: typeof trustIcon;
}

export function registerMemoryTools(pi: ExtensionAPI, deps: MemoryDeps) {
  pi.registerTool({
    name: 'memory-save',
    label: 'Save Memory',
    description: 'Save persistent memory; checks duplicates. Use What/Why/Where/Learned content.',
    parameters: Type.Object({
      title: Type.String({ description: 'Short searchable title' }),
      content: Type.String({ description: 'What/Why/Where/Learned content' }),
      type: Type.Optional(
        Type.String({
          description: 'decision|bugfix|architecture|pattern|discovery|config|preference|learning',
          default: 'manual',
        }),
      ),
      scope: Type.Optional(
        Type.String({
          description: 'project|personal',
          default: 'project',
        }),
      ),
      topic_key: Type.Optional(
        Type.String({
          description: 'Optional topic key',
        }),
      ),
      force: Type.Optional(Type.Boolean({ description: 'Bypass duplicate warning', default: false })),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        deps.state.memoriesSavedThisSession++;
        const result = await deps.mem('save', {
          title: params.title,
          content: params.content,
          type: params.type || 'manual',
          project: deps.state.currentProject || 'unknown',
          scope: params.scope || 'project',
          ...(params.topic_key ? { 'topic-key': params.topic_key } : {}),
          ...(params.force ? { force: 'true' } : {}),
        });

        if (!result) {
          return { content: [{ type: 'text', text: 'Failed to save memory.' }], details: {}, isError: true };
        }

        if (result.auto_merged) {
          const sim = result.similarity != null ? (result.similarity * 100).toFixed(0) : '?';
          return {
            content: [
              {
                type: 'text',
                text: `✅ Memory saved [#${result.id}] ${result.title}\n🔄 Auto-merged: superseded older [#${result.superseded_id}] "${result.superseded_title ?? ''}" (${sim}% similar)`,
              },
            ],
            details: result ?? {},
          };
        }

        if (result.status === 'potential_duplicate') {
          const matches = (result.matches as any[]) || [];
          return {
            content: [
              {
                type: 'text',
                text: `⚠️ Potential duplicate detected:\n${matches.map((m: any) => `  - [#${m.id}] ${m.title} (${m.similarity}% similar)`).join('\n')}\n\nUse force=true to save anyway.`,
              },
            ],
            details: result ?? {},
            isError: false,
          };
        }

        return {
          content: [{ type: 'text', text: `✅ Memory saved: [#${result.id}] ${result.title}` }],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-search',
    label: 'Search Memory',
    description: 'Search persistent memory for decisions, bugfixes, patterns, and discoveries.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      type: Type.Optional(
        Type.String({
          description: 'Optional type filter',
        }),
      ),
      scope: Type.Optional(Type.String({ description: 'project|personal' })),
      limit: Type.Optional(Type.Number({ description: 'Max results', default: 10 })),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        let result = deps.state.currentProject
          ? await deps.mem('search', {
              query: params.query,
              ...(params.type ? { type: params.type } : {}),
              ...(params.scope ? { scope: params.scope } : {}),
              ...(params.limit ? { limit: String(params.limit) } : {}),
              project: deps.state.currentProject,
              ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
            })
          : null;

        if (!result || !((result.results as any[]) || []).length) {
          result = await deps.mem('search', {
            query: params.query,
            ...(params.type ? { type: params.type } : {}),
            ...(params.scope ? { scope: params.scope } : {}),
            ...(params.limit ? { limit: String(params.limit) } : {}),
            ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
          });
        }

        if (!result) {
          return { content: [{ type: 'text', text: 'Search failed.' }], details: {}, isError: true };
        }

        const results = (result.results as any[]) || [];
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No memories found.' }], details: result ?? {} };
        }

        const lines = results.map((r: any) => {
          const score = r._score ? ` (${r._score.toFixed(2)})` : '';
          const trust = r.trust_score != null && r.trust_score < 0.5 ? ' ⚠️' : '';
          return `- [#${r.id}] [${r.type}] ${r.title}${score}${trust}${r.snippet ? `\n  ${r.snippet}` : ''}`;
        });

        return normalizeToolResult({
          content: [{ type: 'text', text: `Found ${results.length} memories:\n${lines.join('\n')}` }],
          details: result ?? {},
        });
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-get',
    label: 'Get Memory',
    description: 'Get full memory details by ID.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Memory ID' }),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await deps.mem('get', { id: String(params.id) });
        if (!result || result.error) {
          return { content: [{ type: 'text', text: `Memory #${params.id} not found.` }], details: {}, isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: `## #${result.id} — ${result.title}\nType: ${result.type} | Scope: ${result.scope} | Project: ${result.project}\n\n${result.content}`,
            },
          ],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-update',
    label: 'Update Memory',
    description: 'Update an existing memory in place by ID.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Memory ID' }),
      title: Type.Optional(Type.String({ description: 'New title' })),
      content: Type.Optional(Type.String({ description: 'New content' })),
      type: Type.Optional(
        Type.String({
          description: 'New type',
        }),
      ),
      scope: Type.Optional(Type.String({ description: 'New scope' })),
      topic_key: Type.Optional(Type.String({ description: 'New topic key' })),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const args: Record<string, string> = { id: String(params.id) };
        if (params.title) {
          args.title = params.title;
        }
        if (params.content) {
          args.content = params.content;
        }
        if (params.type) {
          args.type = params.type;
        }
        if (params.scope) {
          args.scope = params.scope;
        }
        if (params.topic_key) {
          args['topic-key'] = params.topic_key;
        }

        const result = await deps.mem('update', args);
        if (!result || result.error) {
          return {
            content: [
              { type: 'text', text: `Failed to update memory #${params.id}: ${result?.error || 'unknown error'}` },
            ],
            details: {},
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: `✅ Memory updated: [#${result.id}] ${result.title}` }],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-delete',
    label: 'Delete Memory',
    description: 'Soft-delete a stale, incorrect, or duplicate memory.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Memory ID' }),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await deps.mem('delete', { id: String(params.id) });
        if (!result || result.error) {
          return {
            content: [
              { type: 'text', text: `Failed to delete memory #${params.id}: ${result?.error || 'unknown error'}` },
            ],
            details: {},
            isError: true,
          };
        }
        return {
          content: [
            { type: 'text', text: `🗑️ Memory #${params.id} deleted${result.hardDeleted ? ' (hard)' : ' (soft)'}` },
          ],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-related',
    label: 'Find Related Memories',
    description: 'Find memories linked to the same code symbols.',
    parameters: Type.Object({
      id: Type.Number({ description: 'Memory ID' }),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await deps.mem('related', { id: String(params.id) });
        if (!result) {
          return { content: [{ type: 'text', text: 'Failed to find related memories.' }], details: {}, isError: true };
        }
        const related = (result.related as any[]) || [];
        if (related.length === 0) {
          return { content: [{ type: 'text', text: 'No related memories found.' }], details: result ?? {} };
        }
        const lines = related.flatMap((r: any) => [
          `### ${r.symbol}`,
          ...(r.memories || []).map((m: any) => `- [#${m.id}] [${m.type}] ${m.title}`),
        ]);
        return {
          content: [{ type: 'text', text: `Related memories for #${params.id}:\n${lines.join('\n')}` }],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-load-context',
    label: 'Load Topic Context',
    description: 'Load deeper memory context for a topic.',
    parameters: Type.Object({
      query: Type.String({ description: 'Topic or keyword' }),
      deep: Type.Optional(Type.Boolean({ description: 'More results', default: false })),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        if (!deps.state.currentProject) {
          return {
            content: [{ type: 'text', text: "No project detected — can't load context." }],
            details: {},
            isError: true,
          };
        }
        const result = await deps.mem('context', {
          project: deps.state.currentProject,
          query: params.query,
          limit: '30',
          deep: params.deep ? 'true' : 'false',
          ...(deps.state.sessionId ? { 'session-id': String(deps.state.sessionId) } : {}),
        });

        if (!result) {
          return { content: [{ type: 'text', text: 'Failed to load context.' }], details: {}, isError: true };
        }

        const observations = (result.observations as any[]) || [];
        if (observations.length === 0) {
          return {
            content: [{ type: 'text', text: `No memories found for topic "${params.query}".` }],
            details: result ?? {},
          };
        }

        const lines = observations.map((o: any) => {
          const trust = deps.trustIcon(o.trust_score);
          return `- [#${o.id}] [${o.type}] ${o.title}${trust}`;
        });

        const totalMemories = result.stats?.total_memories ?? observations.length;
        return {
          content: [
            {
              type: 'text',
              text: `## Topic Context: "${params.query}"\n**${totalMemories}** total memories in **${deps.state.currentProject}**, showing ${observations.length} matching "${params.query}":\n\n${lines.join('\n')}`,
            },
          ],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'memory-sync-code-trust',
    label: 'Sync Trust w/ Code Changes',
    description: 'Sync memory trust scores with changed code after pull, checkout, merge, or rebase.',
    parameters: Type.Object({
      repo: Type.String({ description: 'Indexed repo name' }),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await deps.mem('sync-code-trust', {
          repo: params.repo,
        });

        if (!result) {
          return { content: [{ type: 'text', text: 'Failed to sync trust scores.' }], details: {}, isError: true };
        }

        if (result.message) {
          return {
            content: [{ type: 'text', text: result.message }],
            details: result ?? {},
          };
        }

        const lines: string[] = [];
        if ((result.adjusted as any[])?.length) {
          lines.push(`### ⚠️ Trust reduced (symbols changed): ${result.adjusted.length}`);
          (result.adjusted as any[]).forEach((a: any) => {
            lines.push(`- memory #${a.memory_id} (symbol: ${a.symbol_id}): ${a.old_trust} → ${a.new_trust}`);
          });
        }
        if ((result.survived as any[])?.length) {
          lines.push(`\n### ✅ Trust increased (symbols survived): ${result.survived.length}`);
          (result.survived as any[]).slice(0, 10).forEach((s: any) => {
            lines.push(`- memory #${s.memory_id}: ${s.old_trust} → ${s.new_trust}`);
          });
        }
        if ((result.unchanged as any[])?.length) {
          lines.push(`\n### 🔒 Unchanged (already max trust): ${result.unchanged.length}`);
        }

        lines.push(`\n**Total links checked:** ${result.total ?? 0}`);

        return {
          content: [{ type: 'text', text: lines.join('\n') || 'No changes detected.' }],
          details: result ?? {},
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerCommand('memory-stats', {
    description: 'Show memory layer statistics',
    handler: async (_args, ctx) => {
      const result = await deps.memCmd('stats');
      if (result) {
        ctx.ui.notify(
          `🧠 ${result.total_observations} observations | ${result.total_sessions} sessions | ${result.total_symbol_links} symbol links`,
          'info',
        );
      }
    },
  });

  pi.registerCommand('memory-dream', {
    description: 'Manually trigger the Dream Cycle — clean stale (not just old) memories',
    handler: async (_args, ctx) => {
      try {
        const result = await deps.memCmd('dream');
        if (result) {
          const phases = Object.entries((result as any).phases || {})
            .filter(([k, v]) => k !== 'compact' && (v as any).count > 0)
            .map(([k, v]) => `${k}: ${(v as any).count}`)
            .join(', ');
          ctx.ui.notify(
            `💤 Dream Cycle complete: ${(result as any).totalCleaned} memories cleaned (${phases || 'nothing to clean'})`,
            'info',
          );
        }
      } catch (e) {
        ctx.ui.notify(`Dream Cycle failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
  });

  pi.registerCommand('memory-context', {
    description: 'Reload memory context for current project',
    handler: async (_args, ctx) => {
      if (!deps.state.currentProject) {
        ctx.ui.notify('No project detected', 'error');
        return;
      }
      const result = await deps.mem('context', { project: deps.state.currentProject, limit: '10' });
      if (result) {
        const obs = (result.observations as any[]) || [];
        ctx.ui.notify(`🧠 ${obs.length} observations loaded for ${deps.state.currentProject}`, 'info');
      }
    },
  });
}
