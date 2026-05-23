import { describe, expect, it, vi } from 'vitest';
import {
  normalizeToolResult,
  toolProgressResult,
  toolTextResult,
} from '../extensions/memory-layer/tools/tool-result.ts';
import { registerCodeTools } from '../extensions/memory-layer/tools/code-tools.ts';
import { registerDocTools } from '../extensions/memory-layer/tools/doc-tools.ts';
import { renderCompactToolResult } from '../extensions/memory-layer/tools/render.ts';

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
  it('keeps full tool content while limiting terminal result previews', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = normalizeToolResult({ content: [{ type: 'text', text }], details: { full: true } });
    const theme = { fg: (_name, value) => value };

    const collapsed = renderCompactToolResult(result, { expanded: false }, theme).render(120).join('\n');
    const expanded = renderCompactToolResult(result, { expanded: true }, theme).render(120).join('\n');

    expect(result.content[0].text).toBe(text);
    expect(collapsed).toContain('line 1');
    expect(collapsed).toContain('line 2');
    expect(collapsed).not.toContain('line 3');
    expect(collapsed).toContain('18 more terminal lines hidden');
    expect(expanded).toContain('line 20');
  });

  it('normalizes malformed results into Pi-renderable text results', () => {
    expectRenderable(normalizeToolResult(undefined));
    expectRenderable(normalizeToolResult({}));
    expectRenderable(normalizeToolResult({ content: undefined, details: undefined }));
    expectRenderable(toolTextResult(null));
    expectRenderable(toolProgressResult('Indexing src/app.ts'));
  });

  it('keeps memory-code streaming updates renderable during indexing', async () => {
    const onUpdate = vi.fn();
    const tool = captureTool(registerCodeTools, {
      mem: vi.fn(),
      memStreaming: vi.fn(async (_cmd, _args, emit) => {
        emit('Indexing src/app.ts');
        return { name: 'app', file_count: 1, symbol_count: 2 };
      }),
      getKnownRepos: vi.fn(),
      formatCodeResult: vi.fn(() => 'Indexed app.'),
      invalidateRepoCache: vi.fn(),
    });

    const result = await tool.execute('id', { mode: 'reindex-repo', path: '.', name: 'app' }, undefined, onUpdate, {});

    expectRenderable(result);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expectRenderable(onUpdate.mock.calls[0][0]);
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

  it('caps memory-code outline details before returning them to the agent', async () => {
    const classes = Array.from({ length: 30 }, (_classItem, classIndex) => ({
      name: `Class${classIndex}`,
      methods: Array.from({ length: 40 }, (_methodItem, methodIndex) => ({
        name: `method${methodIndex}`,
        kind: 'method',
      })),
    }));
    const standalone = Array.from({ length: 120 }, (_, index) => ({ name: `fn${index}`, kind: 'function' }));
    const tool = captureTool(registerCodeTools, {
      mem: vi.fn().mockResolvedValue({ file: 'src', classes, standalone }),
      memStreaming: vi.fn(),
      getKnownRepos: vi.fn().mockResolvedValue([{ name: 'app' }]),
      formatCodeResult: vi.fn(() => 'File outline'),
      invalidateRepoCache: vi.fn(),
    });

    const result = await tool.execute('id', { mode: 'outline', repo: 'app', file: 'src' }, undefined, vi.fn(), {});

    expectRenderable(result);
    expect(result.details.classes.length).toBe(20);
    expect(result.details.classes[0].methods.length).toBe(25);
    expect(result.details.standalone.length).toBe(80);
    expect(result.details.truncated).toBe(true);
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
