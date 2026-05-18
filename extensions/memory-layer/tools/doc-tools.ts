import { normalizeToolResult, stringifyToolError, toolTextResult } from './tool-result';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatDocResult } from './format-doc-result';
import { getKnownRepos } from '../host/project-detector';
import { mem } from '../host/memory-client';

interface DocDeps {
  mem: typeof mem;
  getKnownRepos: typeof getKnownRepos;
  formatDocResult: typeof formatDocResult;
}

export function registerDocTools(pi: ExtensionAPI, deps: DocDeps) {
  pi.registerTool({
    name: 'memory-doc',
    label: 'Doc Index',
    description:
      'Search and query indexed documentation — full-text search, outlines, backlinks, broken links, glossary terms, tutorial paths, code examples, and stale page detection. ' +
      'Requires docs to be indexed first (use mode `index-docs`). ' +
      'Modes: search, outline, backlinks, broken-links, glossary, tutorial-path, code-examples, orphans, coverage, stale-pages, duplicates, index-docs, reindex-docs.',
    parameters: Type.Object({
      mode: Type.Optional(
        Type.String({
          description:
            'Query mode: search|outline|backlinks|broken-links|glossary|tutorial-path|code-examples|orphans|coverage|stale-pages|duplicates|index-docs|reindex-docs',
          enum: [
            'search',
            'outline',
            'backlinks',
            'broken-links',
            'glossary',
            'tutorial-path',
            'code-examples',
            'orphans',
            'coverage',
            'stale-pages',
            'duplicates',
            'index-docs',
            'reindex-docs',
          ],
        }),
      ),
      repo: Type.Optional(
        Type.String({ description: 'Indexed doc repo name (required for query modes, optional for index-docs)' }),
      ),
      query: Type.Optional(Type.String({ description: 'Search query (required for search, code-examples)' })),
      file: Type.Optional(Type.String({ description: 'Doc file path (optional for outline)' })),
      doc_path: Type.Optional(Type.String({ description: 'Doc file path (for backlinks, required)' })),
      term: Type.Optional(Type.String({ description: 'Glossary term to look up (optional)' })),
      section: Type.Optional(Type.Number({ description: 'Section ID for tutorial-path' })),
      level: Type.Optional(Type.Number({ description: 'Heading level filter for search' })),
      role: Type.Optional(
        Type.String({
          description: 'Role filter for search: concept, tutorial, how_to, api, example, troubleshooting, faq',
        }),
      ),
      lang: Type.Optional(Type.String({ description: "Language filter for code-examples (e.g. 'js', 'python')" })),
      include_same_doc: Type.Optional(
        Type.Boolean({ description: 'Include intra-document links when finding orphans (default: false)' }),
      ),
      doc_repo: Type.Optional(Type.String({ description: 'Code repo name for coverage mode. Defaults to repo.' })),
      path: Type.Optional(Type.String({ description: 'Local path to docs directory (required for index-docs mode)' })),
      name: Type.Optional(Type.String({ description: 'Doc repo name (required for index-docs mode)' })),
      ignore: Type.Optional(Type.String({ description: 'Glob pattern to ignore during doc indexing' })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      params = params ?? {};
      try {
        const cmdMap: Record<string, string> = {
          search: 'doc-search',
          outline: 'doc-outline',
          backlinks: 'backlinks',
          'broken-links': 'broken-links',
          glossary: 'glossary',
          'tutorial-path': 'tutorial-path',
          'code-examples': 'code-examples',
          orphans: 'doc-orphans',
          coverage: 'doc-coverage',
          'stale-pages': 'stale-pages',
          duplicates: 'doc-duplicates',
          'index-docs': 'index-docs',
          'reindex-docs': 'reindex-docs',
        };
        const mode = typeof params.mode === 'string' ? params.mode : '';
        if (!mode) {
          return toolTextResult(docHelpText());
        }

        const cmd = cmdMap[mode];
        if (!cmd) {
          return toolTextResult(`Unknown memory-doc mode: ${mode}\n\n${docHelpText()}`, {}, true);
        }

        const validationError = validateDocParams(mode, params);
        if (validationError) {
          return toolTextResult(validationError, {}, true);
        }

        const args: Record<string, string> = {};
        if (params.repo) {
          args.repo = params.repo;
        }
        if (params.query) {
          args.query = params.query;
        }
        if (params.file) {
          args.file = params.file;
        }
        if (params.doc_path) {
          args.path = params.doc_path;
        }
        if (params.term) {
          args.term = params.term;
        }
        if (params.section) {
          args.section = String(params.section);
        }
        if (params.level) {
          args.level = String(params.level);
        }
        if (params.role) {
          args.role = params.role;
        }
        if (params.lang) {
          args.lang = params.lang;
        }
        if (params.include_same_doc) {
          args['include-same-doc'] = 'true';
        }
        if (params.doc_repo) {
          args['doc-repo'] = params.doc_repo;
        }
        if (params.path) {
          args.path = params.path;
        }
        if (params.name) {
          args.name = params.name;
        }
        if (params.ignore) {
          args.ignore = params.ignore;
        }

        if (mode === 'index-docs' || mode === 'reindex-docs') {
          const result = await deps.mem(cmd, args);
          if (!result) {
            return toolTextResult('Doc indexing failed or timed out.', {}, true);
          }
          if (result.error) {
            return toolTextResult(`Error: ${result.error}`, result ?? {}, true);
          }
          let fmt: string | undefined | null;
          try {
            fmt = deps.formatDocResult(mode, result);
          } catch {
            fmt = '';
          }
          return toolTextResult(fmt || 'Doc indexing completed.', result ?? {});
        }

        const docRepos = await deps.getKnownRepos();
        const docRepoMatch = docRepos.find((r) => r.name.toLowerCase() === params.repo?.toLowerCase());
        if (!docRepoMatch) {
          const available = docRepos.map((r) => r.name).join(', ') || 'none';
          const cwd = process.cwd();
          return normalizeToolResult({
            content: [
              {
                type: 'text',
                text: `❌ Doc repo \"${params.repo}\" is not indexed. Available repos: ${available}\n\nTo index these docs, run:\n\`memory-doc index-docs --path ${cwd} --name ${params.repo}\``,
              },
            ],
            details: {},
            isError: true,
          });
        }

        const result = await deps.mem(cmd, args);
        if (!result) {
          return toolTextResult('Doc query failed.', {}, true);
        }
        if (result.error) {
          return toolTextResult(`Error: ${result.error}`, result ?? {}, true);
        }

        let fmt: string | undefined | null;
        try {
          fmt = deps.formatDocResult(mode, result);
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

function docHelpText(): string {
  return [
    'memory-doc requires a mode.',
    '',
    'Examples:',
    '- memory-doc search --repo <repo> --query "getting started"',
    '- memory-doc outline --repo <repo> --file docs/guide.md',
    '- memory-doc reindex-docs --path docs --name <repo>',
    '',
    'Modes: search, outline, backlinks, broken-links, glossary, tutorial-path, code-examples, orphans, coverage, stale-pages, duplicates, index-docs, reindex-docs.',
  ].join('\n');
}

function validateDocParams(mode: string, params: Record<string, any>): string | null {
  if (mode === 'index-docs' && !params.path) {
    return 'index-docs requires --path.\n\nExample:\nmemory-doc index-docs --path docs --name <repo>';
  }

  if (mode === 'reindex-docs' && !params.path && !params.repo) {
    return 'reindex-docs requires --path or --repo.\n\nExamples:\nmemory-doc reindex-docs --path docs --name <repo>\nmemory-doc reindex-docs --repo <repo>';
  }

  if (mode !== 'index-docs' && mode !== 'reindex-docs' && !params.repo) {
    return `${mode} requires --repo.\n\nExample:\nmemory-doc ${mode} --repo <repo>`;
  }

  if (['search', 'code-examples'].includes(mode) && !params.query) {
    return `${mode} requires --query.\n\nExample:\nmemory-doc ${mode} --repo ${params.repo || '<repo>'} --query "getting started"`;
  }

  if (mode === 'backlinks' && !params.doc_path) {
    return 'backlinks requires --doc-path.\n\nExample:\nmemory-doc backlinks --repo <repo> --doc-path docs/guide.md';
  }

  return null;
}
