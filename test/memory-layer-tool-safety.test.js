import { describe, expect, it, vi } from 'vitest';
import { normalizeToolResult, toolTextResult } from '../extensions/memory-layer/tools/tool-result.ts';
import { registerCodeTools } from '../extensions/memory-layer/tools/code-tools.ts';
import { registerDocTools } from '../extensions/memory-layer/tools/doc-tools.ts';

function captureTool(register, deps) {
  let registered;
  register(
    {
      registerTool(tool) {
        registered = tool;
      },
    },
    deps,
  );
  if (!registered) {
    throw new Error('tool was not registered');
  }
  return registered;
}

function expectRenderable(result) {
  expect(result).toBeTruthy();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content.every((item) => item && typeof item === 'object')).toBe(true);
  expect(result.content.filter((item) => item.type === 'text').every((item) => typeof item.text === 'string')).toBe(
    true,
  );
  expect(result.details).toBeTruthy();
  expect(typeof result.details).toBe('object');
}

describe('memory tool renderer safety', () => {
  it('normalizes malformed results into Pi-renderable text results', () => {
    expectRenderable(normalizeToolResult(undefined));
    expectRenderable(normalizeToolResult({}));
    expectRenderable(normalizeToolResult({ content: undefined, details: undefined }));
    expectRenderable(toolTextResult(null));
  });

  it.each([
    ['bare command', {}],
    ['unknown mode', { mode: 'wat' }],
    ['missing repo', { mode: 'outline' }],
    ['missing symbol', { mode: 'callers', repo: 'app' }],
    ['missing file', { mode: 'outline', repo: 'app' }],
    ['missing index path', { mode: 'index-repo' }],
  ])('keeps memory-code renderable for %s', async (_name, params) => {
    const tool = captureTool(registerCodeTools, {
      mem: vi.fn(),
      memStreaming: vi.fn(),
      getKnownRepos: vi.fn().mockResolvedValue([]),
      formatCodeResult: vi.fn(),
    });

    const result = await tool.execute('id', params, undefined, vi.fn(), {});
    expectRenderable(result);
  });

  it('keeps memory-code renderable for unindexed repos, empty backend output, backend errors, formatter failures, and thrown exceptions', async () => {
    const cases = [
      {
        name: 'unindexed repo',
        deps: {
          mem: vi.fn(),
          memStreaming: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([]),
          formatCodeResult: vi.fn(),
        },
        params: { mode: 'deps', repo: 'app' },
      },
      {
        name: 'empty backend output',
        deps: {
          mem: vi.fn().mockResolvedValue(undefined),
          memStreaming: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'app' }]),
          formatCodeResult: vi.fn(),
        },
        params: { mode: 'deps', repo: 'app' },
      },
      {
        name: 'backend error',
        deps: {
          mem: vi.fn().mockResolvedValue({ error: 'boom' }),
          memStreaming: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'app' }]),
          formatCodeResult: vi.fn(),
        },
        params: { mode: 'deps', repo: 'app' },
      },
      {
        name: 'formatter failure',
        deps: {
          mem: vi.fn().mockResolvedValue({ edges: [] }),
          memStreaming: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'app' }]),
          formatCodeResult: vi.fn(() => {
            throw new Error('format failed');
          }),
        },
        params: { mode: 'deps', repo: 'app' },
      },
      {
        name: 'backend throw',
        deps: {
          mem: vi.fn(() => {
            throw new Error('db locked');
          }),
          memStreaming: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'app' }]),
          formatCodeResult: vi.fn(),
        },
        params: { mode: 'deps', repo: 'app' },
      },
      {
        name: 'indexing empty output',
        deps: {
          mem: vi.fn(),
          memStreaming: vi.fn().mockResolvedValue(undefined),
          getKnownRepos: vi.fn(),
          formatCodeResult: vi.fn(),
        },
        params: { mode: 'reindex-repo', path: '.', name: 'app' },
      },
    ];

    const results = await Promise.all(
      cases.map((testCase) => {
        const tool = captureTool(registerCodeTools, testCase.deps);
        return tool.execute('id', testCase.params, undefined, vi.fn(), {});
      }),
    );

    results.forEach(expectRenderable);
  });

  it.each([
    ['bare command', {}],
    ['unknown mode', { mode: 'wat' }],
    ['missing repo', { mode: 'search' }],
    ['missing query', { mode: 'search', repo: 'docs' }],
    ['missing backlinks path', { mode: 'backlinks', repo: 'docs' }],
    ['missing index path', { mode: 'index-docs' }],
  ])('keeps memory-doc renderable for %s', async (_name, params) => {
    const tool = captureTool(registerDocTools, {
      mem: vi.fn(),
      getKnownRepos: vi.fn().mockResolvedValue([]),
      formatDocResult: vi.fn(),
    });

    const result = await tool.execute('id', params, undefined, vi.fn(), {});
    expectRenderable(result);
  });

  it('keeps memory-doc renderable for unindexed repos, empty backend output, backend errors, formatter failures, and thrown exceptions', async () => {
    const cases = [
      {
        deps: {
          mem: vi.fn(),
          getKnownRepos: vi.fn().mockResolvedValue([]),
          formatDocResult: vi.fn(),
        },
        params: { mode: 'outline', repo: 'docs' },
      },
      {
        deps: {
          mem: vi.fn().mockResolvedValue(undefined),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'docs' }]),
          formatDocResult: vi.fn(),
        },
        params: { mode: 'outline', repo: 'docs' },
      },
      {
        deps: {
          mem: vi.fn().mockResolvedValue({ error: 'boom' }),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'docs' }]),
          formatDocResult: vi.fn(),
        },
        params: { mode: 'outline', repo: 'docs' },
      },
      {
        deps: {
          mem: vi.fn().mockResolvedValue({ headings: [] }),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'docs' }]),
          formatDocResult: vi.fn(() => {
            throw new Error('format failed');
          }),
        },
        params: { mode: 'outline', repo: 'docs' },
      },
      {
        deps: {
          mem: vi.fn(() => {
            throw new Error('db locked');
          }),
          getKnownRepos: vi.fn().mockResolvedValue([{ name: 'docs' }]),
          formatDocResult: vi.fn(),
        },
        params: { mode: 'outline', repo: 'docs' },
      },
      {
        deps: {
          mem: vi.fn().mockResolvedValue(undefined),
          getKnownRepos: vi.fn(),
          formatDocResult: vi.fn(),
        },
        params: { mode: 'reindex-docs', path: 'docs', name: 'docs' },
      },
    ];

    const results = await Promise.all(
      cases.map((testCase) => {
        const tool = captureTool(registerDocTools, testCase.deps);
        return tool.execute('id', testCase.params, undefined, vi.fn(), {});
      }),
    );

    results.forEach(expectRenderable);
  });
});
