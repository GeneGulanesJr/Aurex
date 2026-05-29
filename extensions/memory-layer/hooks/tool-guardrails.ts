// oxlint-disable sort-imports
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isCodeFile, state } from '../state';
import { isPipedOutputFilter, isTargetedSymbolLookup } from './guardrail-utils';
import { getKnownRepos } from '../host/project-detector';
import path from 'node:path';

const CONFIG_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.node.json',
  'vitest.config.ts',
  'vitest.config.mjs',
  'vitest.config.js',
  'jest.config.ts',
  'jest.config.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  'tailwind.config.ts',
  'tailwind.config.js',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'rollup.config.js',
  'babel.config.js',
  'babel.config.json',
  '.babelrc',
  'composer.json',
  'Cargo.toml',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
]);

const RAW_CODE_DISCOVERY_RE = /\b(rg|grep|ag|ack|find)\b/i;
const CODE_PATH_HINT_RE =
  /\.(ts|js|tsx|jsx|mjs|cjs|py|go|rs|java)\b|(^|\s)(src|lib|app|test|tests|extensions|commands|data-access|services)\b/i;

interface GuardrailsDeps {
  state: typeof state;
  getKnownRepos: typeof getKnownRepos;
  isCodeFile: typeof isCodeFile;
}

export function registerToolGuardrails(pi: ExtensionAPI, deps: GuardrailsDeps) {
  pi.on('tool_call', async (event, ctx) => {
    const toolName = event.toolName;
    const input = event.input as Record<string, unknown>;

    if (toolName === 'memory-code') {
      deps.state.lastMemoryToolCall = Date.now();
      deps.state.callsSinceLastMemory = 0;
      const file = String(input?.file || '');
      if (file) {
        deps.state.exploredFiles.add(file.toLowerCase());
        deps.state.exploredFiles.add(path.basename(file).toLowerCase());
      }
      return;
    }
    if (toolName.startsWith('memory-')) {
      deps.state.lastMemoryToolCall = Date.now();
      deps.state.callsSinceLastMemory = 0;
      return;
    }

    if (toolName === 'bash' && typeof input?.command === 'string') {
      const cmd = input.command as string;
      if (RAW_CODE_DISCOVERY_RE.test(cmd)) {
        const repos = await deps.getKnownRepos();
        const resolvedCwd = path.resolve(process.cwd());
        const matchedRepo =
          repos.find((r) => resolvedCwd.startsWith(path.resolve(r.path))) ||
          repos.find((r) => deps.state.currentProject?.toLowerCase() === r.name.toLowerCase());
        if (matchedRepo) {
          // Allow grep/rg/etc. When they are only filtering another command's stdout,
          // Such as `npx oxlint 2>&1 | grep -i unused`.
          if (isPipedOutputFilter(cmd)) {
            return;
          }

          // Allow targeted single-symbol lookups through (e.g., grep -rn "rankObservations" src/)
          if (isTargetedSymbolLookup(cmd)) {
            return;
          }

          const searchHint = CODE_PATH_HINT_RE.test(cmd) ? 'Code search' : 'Raw repository search';
          return {
            block: true,
            reason:
              `${searchHint} detected in indexed repo "${matchedRepo.name}". Use \`memory-code\` instead:\n` +
              `• \`memory-code search --repo ${matchedRepo.name} --query <query>\` — find code symbols\n` +
              `• \`memory-code outline --repo ${matchedRepo.name} --file <path>\` — file structure\n` +
              `• \`memory-code callers --repo ${matchedRepo.name} --symbol <name>\` — call hierarchy\n` +
              `• \`memory-code deps --repo ${matchedRepo.name}\` — dependency graph\n` +
              `• \`memory-code importance --repo ${matchedRepo.name}\` — hotspots & churn`,
          };
        }
        if (deps.state.nudgeCountThisSession < deps.state.MAX_NUDGES_PER_SESSION) {
          deps.state.nudgeCountThisSession++;
          ctx.ui.notify(
            `💡 Use \`memory-code\` for structured analysis. Index this repo first: \`memory-code index-repo\``,
            'info',
          );
        }
        return;
      }
    }

    if (toolName === 'read' && typeof input?.path === 'string') {
      const filePath = input.path as string;

      if (!deps.isCodeFile(filePath)) {
        return;
      }

      if (typeof input.offset === 'number' || typeof input.limit === 'number') {
        return;
      }

      const basename = path.basename(filePath);
      if (CONFIG_FILENAMES.has(basename)) {
        return;
      }

      if (filePath.includes('node_modules')) {
        return;
      }

      const absPath = path.resolve(filePath);

      const repos = await deps.getKnownRepos();
      const matchedRepo = repos.find(
        (r) =>
          absPath.toLowerCase().startsWith(`${r.path.toLowerCase()}/`) ||
          absPath.toLowerCase() === r.path.toLowerCase(),
      );

      if (!matchedRepo) {
        if (deps.state.nudgeCountThisSession < deps.state.MAX_NUDGES_PER_SESSION) {
          deps.state.nudgeCountThisSession++;
          ctx.ui.notify(`💡 This code file isn't in an indexed repo. Index it: \`memory-code index-repo\``, 'info');
        }
        return;
      }

      const fileBase = path.basename(filePath).toLowerCase();
      const relPath = path.relative(matchedRepo.path, absPath).toLowerCase();
      if (
        deps.state.exploredFiles.has(fileBase) ||
        deps.state.exploredFiles.has(relPath) ||
        deps.state.exploredFiles.has(absPath.toLowerCase())
      ) {
        return;
      }

      return {
        block: true,
        reason:
          `Use \`memory-code\` first to understand "${path.basename(filePath)}" before reading it:\n` +
          `• \`memory-code outline --repo ${matchedRepo.name} --file ${relPath || path.basename(filePath)}\` — file structure & symbols\n` +
          `• \`memory-code callers --repo ${matchedRepo.name} --symbol <name>\` — who calls what\n` +
          `• \`memory-code deps --repo ${matchedRepo.name}\` — dependency graph\n` +
          `After reviewing the outline, use \`read\` with \`offset\`/\`limit\` for targeted editing.`,
      };
    }
  });

  // Track explored files from memory-code results (callers, deps, importance, etc.)
  pi.on('tool_result', async (event, _ctx) => {
    if (event.toolName !== 'memory-code') {
      return;
    }
    if (!event.result) {
      return;
    }

    const resultText = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);

    // Match relative file paths like "src/foo.ts" or "extensions/memory-layer/hooks/tool-guardrails.ts"
    const filePaths = resultText.match(/[\w/.-]+\.(ts|js|tsx|jsx|mjs|cjs|py|go|rs)/g) || [];
    for (const fp of filePaths) {
      deps.state.exploredFiles.add(fp.toLowerCase());
      const basename = fp.split('/').pop();
      if (basename) {
        deps.state.exploredFiles.add(basename.toLowerCase());
      }
    }
  });
}
