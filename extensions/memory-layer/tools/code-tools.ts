import { mem, memStreaming } from '../host/memory-client';
import { normalizeToolResult, stringifyToolError, toolProgressResult, toolTextResult } from './tool-result';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from './schema';
import { formatCodeResult } from './format-code-result';
import { getKnownRepos } from '../host/project-detector';
import { renderCompactToolResult } from './render';

interface CodeDeps {
  mem: typeof mem;
  memStreaming: typeof memStreaming;
  getKnownRepos: typeof getKnownRepos;
  formatCodeResult: typeof formatCodeResult;
  invalidateRepoCache: () => void;
}

export function registerCodeTools(pi: ExtensionAPI, deps: CodeDeps) {
  pi.registerTool({
    name: 'memory-code',
    label: 'Code Analysis',
    description:
      'Analyze code in indexed repos — import graphs, call hierarchies, blast radius, dead code, complexity, hotspots, cycles, ' +
      'importance, coupling, extraction candidates, class hierarchy, file outlines, churn, and signal chains. ' +
      'Requires the repo to be indexed first (use mode `index-repo`). ' +
      'Modes: callers, callees, blast-radius, dead-code, complexity, deps, outline, churn, hotspots, cycles, importance, coupling, extractable, hierarchy, signal-chains, layer-violations, health, index-repo, reindex-repo.',
    parameters: Type.Object({
      mode: Type.Optional(
        Type.String({
          description:
            'Analysis mode: callers|callees|blast-radius|dead-code|complexity|deps|outline|churn|hotspots|cycles|importance|coupling|extractable|hierarchy|signal-chains|layer-violations|health|index-repo|reindex-repo',
          enum: [
            'callers',
            'callees',
            'blast-radius',
            'dead-code',
            'complexity',
            'deps',
            'outline',
            'churn',
            'hotspots',
            'cycles',
            'importance',
            'coupling',
            'extractable',
            'hierarchy',
            'signal-chains',
            'layer-violations',
            'health',
            'index-repo',
            'reindex-repo',
          ],
        }),
      ),
      repo: Type.Optional(
        Type.String({ description: 'Indexed repo name (required for analysis modes, optional for index-repo)' }),
      ),
      symbol: Type.Optional(
        Type.String({ description: 'Symbol name (required for callers, callees, blast-radius, complexity)' }),
      ),
      file: Type.Optional(Type.String({ description: 'File path (required for outline, churn; optional for deps)' })),
      depth: Type.Optional(Type.Number({ description: 'Graph traversal depth 1-5 (default 3)', default: 3 })),
      direction: Type.Optional(
        Type.String({ description: 'Import direction for deps: imports|importers|both', default: 'both' }),
      ),
      min_confidence: Type.Optional(
        Type.Number({ description: 'Min confidence for dead-code (0-1, default 0.5)', default: 0.5 }),
      ),
      days: Type.Optional(
        Type.Number({ description: 'Churn/hotspot lookback window in days (default 90)', default: 90 }),
      ),
      refresh: Type.Optional(Type.Boolean({ description: 'Force refresh churn cache', default: false })),
      top: Type.Optional(Type.Number({ description: 'Max results (default 20)', default: 20 })),
      scope: Type.Optional(Type.String({ description: "Scope importance to subdirectory (e.g. 'src/core')" })),
      sort_by: Type.Optional(
        Type.String({ description: 'Sort coupling by: instability|afferent|efferent', default: 'instability' }),
      ),
      min_complexity: Type.Optional(
        Type.Number({ description: 'Min cyclomatic complexity for extractable (default 5)', default: 5 }),
      ),
      min_callers: Type.Optional(
        Type.Number({ description: 'Min caller files for extractable (default 2)', default: 2 }),
      ),
      direction_hier: Type.Optional(
        Type.String({ description: 'Hierarchy direction: both|ancestors|descendants', default: 'both' }),
      ),
      kind: Type.Optional(Type.String({ description: 'Gateway kind: http, cli, or omit for all' })),
      symbol_chain: Type.Optional(Type.String({ description: 'Trace which signal chain a symbol participates in' })),
      path: Type.Optional(Type.String({ description: 'Local path to repo directory (required for index-repo mode)' })),
      name: Type.Optional(Type.String({ description: 'Repo name for indexing (defaults to directory basename)' })),
      rules: Type.Optional(
        Type.String({ description: 'JSON layer rules config (or use .pimemory-layers.jsonc file)' }),
      ),
    }),
    renderResult: renderCompactToolResult,
    async execute(_id, params, _signal, onUpdate, ctx) {
      params = params ?? {};
      try {
        const cmdMap: Record<string, string> = {
          callers: 'call-hierarchy',
          callees: 'call-hierarchy',
          'blast-radius': 'blast-radius',
          'dead-code': 'dead-code',
          complexity: 'complexity',
          deps: 'import-graph',
          outline: 'outline',
          churn: 'churn',
          hotspots: 'hotspots',
          cycles: 'cycles',
          importance: 'importance',
          coupling: 'coupling',
          extractable: 'extractable',
          hierarchy: 'hierarchy',
          'signal-chains': 'signal-chains',
          'layer-violations': 'layer-violations',
          health: 'health-code-repo',
          'index-repo': 'index-repo',
          'reindex-repo': 'reindex-repo',
        };
        const mode = typeof params.mode === 'string' ? params.mode : '';
        if (!mode) {
          return toolTextResult(codeHelpText());
        }

        const cmd = cmdMap[mode];
        if (!cmd) {
          return toolTextResult(`Unknown memory-code mode: ${mode}\n\n${codeHelpText()}`, {}, true);
        }

        const validationError = validateCodeParams(mode, params);
        if (validationError) {
          return toolTextResult(validationError, {}, true);
        }

        const args: Record<string, string> = {};
        if (params.repo) {
          args.repo = params.repo;
        }
        if (params.symbol) {
          args.symbol = params.symbol;
        }
        if (params.file) {
          args.file = params.file;
        }
        if (params.depth) {
          args.depth = String(params.depth);
        }
        if (params.direction) {
          args.direction = params.direction;
        }
        if (cmd === 'call-hierarchy') {
          args.direction = mode === 'callers' ? 'callers' : 'callees';
        }
        if (params.min_confidence) {
          args['min-confidence'] = String(params.min_confidence);
        }
        if (params.days) {
          args.days = String(params.days);
        }
        if (params.refresh) {
          args.refresh = 'true';
        }
        if (params.top) {
          args.top = String(params.top);
        }
        if (params.scope) {
          args.scope = params.scope;
        }
        if (params.sort_by) {
          args['sort-by'] = params.sort_by;
        }
        if (params.min_complexity) {
          args['min-complexity'] = String(params.min_complexity);
        }
        if (params.min_callers) {
          args['min-callers'] = String(params.min_callers);
        }
        if (params.direction_hier) {
          args.direction = params.direction_hier;
        }
        if (params.kind) {
          args.kind = params.kind;
        }
        if (params.symbol_chain) {
          args.symbol = String(params.symbol_chain);
        }
        if (params.path) {
          args.path = params.path;
        }
        if (params.name) {
          args.name = params.name;
        }
        if (params.rules) {
          args.rules = typeof params.rules === 'string' ? params.rules : JSON.stringify(params.rules);
        }

        if (mode === 'index-repo' || mode === 'reindex-repo') {
          const ui = (ctx as any)?.ui;
          const result = await deps.memStreaming(cmd, args, (msg: string) => {
            try {
              onUpdate(toolProgressResult(msg, { progress: true }));
            } catch {}
            if (ui?.setStatus) {
              try {
                ui.setStatus('memory-index', `📦 ${msg}`);
              } catch {}
            }
          });
          if (ui?.setStatus) {
            try {
              if (ui.clearStatus) {
                ui.clearStatus('memory-index');
              } else {
                ui.setStatus('memory-index', '');
              }
            } catch {}
          }
          if (!result) {
            return toolTextResult('Indexing failed or timed out.', {}, true);
          }
          if (result.error) {
            return toolTextResult(`Error: ${result.error}`, result ?? {}, true);
          }
          // Invalidate repo cache so guardrails immediately recognize the new/updated repo
          deps.invalidateRepoCache();
          let fmt: string | undefined | null;
          try {
            fmt = deps.formatCodeResult(mode, result);
          } catch {
            fmt = '';
          }
          return toolTextResult(fmt || 'Indexing completed.', result ?? {});
        }

        if (mode === 'health') {
          const result = await deps.mem(cmd, args);
          if (!result) {
            return toolTextResult('Index health check failed.', {}, true);
          }
          if (result.error) {
            return toolTextResult(`Error: ${result.error}`, result ?? {}, true);
          }
          return toolTextResult(formatHealthResult(result), result ?? {});
        }

        const codeRepos = await deps.getKnownRepos();
        const repoMatch = codeRepos.find((r) => r.name.toLowerCase() === params.repo?.toLowerCase());
        if (!repoMatch) {
          const available = codeRepos.map((r) => r.name).join(', ') || 'none';
          const cwd = process.cwd();
          return normalizeToolResult({
            content: [
              {
                type: 'text',
                text: `❌ Repo \"${params.repo}\" is not indexed. Available repos: ${available}\n\nTo index this repo, run:\n\`memory-code index-repo --path ${cwd} --name ${params.repo}\``,
              },
            ],
            details: {},
            isError: true,
          });
        }

        const result = await deps.mem(cmd, args);
        if (!result) {
          if (
            cmd === 'dead-code' ||
            cmd === 'cycles' ||
            cmd === 'importance' ||
            cmd === 'coupling' ||
            cmd === 'signal-chains' ||
            cmd === 'import-graph'
          ) {
            return normalizeToolResult({
              content: [
                {
                  type: 'text',
                  text: `Analysis timed out or failed for \"${mode}\". Try reducing scope or depth, or re-index the repo.\nCommand: ${cmd} on repo \"${params.repo}\"`,
                },
              ],
              details: {},
              isError: true,
            });
          }
          return toolTextResult('Analysis failed.', {}, true);
        }
        if (result.error) {
          return toolTextResult(`Error: ${result.error}`, result ?? {}, true);
        }

        let fmt: string | undefined | null;
        try {
          fmt = deps.formatCodeResult(mode, result);
        } catch {
          fmt = '';
        }
        return toolTextResult(fmt || `No ${mode} results found.`, result ?? {});
      } catch (err) {
        return toolTextResult(`Unexpected error: ${stringifyToolError(err)}`, {}, true);
      }
    },
  });
}

function codeHelpText(): string {
  return [
    'memory-code requires a mode.',
    '',
    'Examples:',
    '- memory-code outline --repo <repo> --file src/foo.ts',
    '- memory-code callers --repo <repo> --symbol MyClass.method',
    '- memory-code reindex-repo --path . --name <repo>',
    '',
    'Modes: callers, callees, blast-radius, dead-code, complexity, deps, outline, churn, hotspots, cycles, importance, coupling, extractable, hierarchy, signal-chains, layer-violations, health, index-repo, reindex-repo.',
  ].join('\n');
}

function formatHealthResult(result: any): string {
  const diagnostics = result.diagnostics || {};
  const lines = [
    `# Index Health: ${result.repo}`,
    '',
    `Score: ${result.health_score}`,
    `Indexed: ${result.indexed_files} files, ${result.indexed_symbols} symbols`,
    `Fresh: ${result.stale ? 'no' : 'yes'}`,
  ];
  if (result.scan) {
    const delta = result.scan.indexed_file_delta;
    lines.push(`Discovered: ${result.scan.parseable_files_found} parseable files (${delta >= 0 ? '+' : ''}${delta} vs indexed)`);
  }
  lines.push(`Diagnostics: ok=${diagnostics.ok || 0}, zero_symbols=${diagnostics.zero_symbols || 0}, error=${diagnostics.error || 0}`);
  if ((result.recommendations || []).length) {
    lines.push('', 'Recommendations:', ...(result.recommendations || []).map((r: string) => `- ${r}`));
  }
  return lines.join('\n');
}

function validateCodeParams(mode: string, params: Record<string, any>): string | null {
  if (mode === 'index-repo' && !params.path) {
    return 'index-repo requires --path.\n\nExample:\nmemory-code index-repo --path . --name <repo>';
  }

  if (mode === 'reindex-repo' && !params.path && !params.repo) {
    return 'reindex-repo requires --path or --repo.\n\nExamples:\nmemory-code reindex-repo --path . --name <repo>\nmemory-code reindex-repo --repo <repo>';
  }

  if (mode !== 'index-repo' && mode !== 'reindex-repo' && !params.repo) {
    return `${mode} requires --repo.\n\nExample:\nmemory-code ${mode} --repo <repo>`;
  }

  if (['callers', 'callees', 'blast-radius', 'complexity'].includes(mode) && !params.symbol) {
    return `${mode} requires --symbol.\n\nExample:\nmemory-code ${mode} --repo ${params.repo || '<repo>'} --symbol <symbol>`;
  }

  if (['outline', 'churn'].includes(mode) && !params.file) {
    return `${mode} requires --file.\n\nExample:\nmemory-code ${mode} --repo ${params.repo || '<repo>'} --file src/foo.ts`;
  }

  return null;
}
