import { registerBeforeAgentStart } from '../extensions/memory-layer/hooks/context-injection.ts';

/**
 * Extract the handler registered by registerBeforeAgentStart
 */
function extractHandler(deps) {
  let handler;
  const pi = {
    on: vi.fn((_eventName, callback) => {
      handler = callback;
    }),
  };
  registerBeforeAgentStart(pi, deps);
  return handler;
}

function buildDeps(overrides = {}) {
  return {
    state: { currentProject: 'TestProject', hasInjectedContext: false, sessionId: 1 },
    mem: vi.fn().mockResolvedValue({
      observations: [],
      personal: [],
      stats: { total_memories: 42, total_personal: 1, active_workflows: 0 },
      topic: null,
    }),
    getKnownRepos: vi.fn().mockResolvedValue([]),
    isRepoStale: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('rich context injection', () => {
  test('produces structured format with Memory Context heading', async () => {
    const deps = buildDeps();
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('## Memory Context (auto-loaded)');
    expect(content).toContain('### Project Context');
    expect(content).toContain('Project: **TestProject**');
  });

  test('includes project summary from package.json', async () => {
    const deps = buildDeps();
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    // LaPis package.json has a description
    expect(content).toContain('LaPis');
  });

  test('includes code index details when repo is known', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-29T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(false),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('Code index: `TestRepo`');
    expect(content).toContain('100 files');
    expect(content).toContain('500 symbols');
  });

  test('shows stale label when index is stale', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('(stale)');
  });

  test('injects prompt-matched memory with inline content', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'decision',
            title: 'Use SQLite FTS5',
            trust_score: 0.95,
            content: '**What**: Use FTS5\n**Why**: No external deps\n**Where**: search.js',
          },
        ],
        personal: [],
        stats: { total_memories: 10, total_personal: 0, active_workflows: 0 },
        topic: 'fts5',
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'why fts5' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('### Prompt-Matched Memory');
    expect(content).toContain('[decision] Use SQLite FTS5');
    expect(content).toContain('What: Use FTS5 Why: No external deps Where: search.js');
  });

  test('suppresses stale warning for historical prompts', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'architecture',
            title: 'FTS5 rationale',
            trust_score: 0.95,
            content: '**Why**: Performance',
          },
        ],
        personal: [],
        stats: { total_memories: 10, total_personal: 0, active_workflows: 0 },
        topic: 'fts5',
      }),
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'Why did we choose SQLite?' }, { cwd: process.cwd() });
    const content = result.message.content;

    // (stale) label is shown in Project Context, but STALE_GUIDANCE block is suppressed
    expect(content).toContain('(stale)');
    expect(content).not.toContain('Stale code index');
    expect(content).not.toContain('reindex');
  });

  test('shows stale guidance block for non-historical prompts', async () => {
    const deps = buildDeps({
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'TestRepo',
          path: process.cwd(),
          file_count: 100,
          symbol_count: 500,
          indexed_at: '2026-05-01T00:00:00Z',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'refactor the context module' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('Stale code index');
    expect(content).toContain('reindex');
  });

  test('new project format shows cross-project context', async () => {
    const callCount = { n: 0 };
    const deps = buildDeps({
      mem: vi.fn().mockImplementation(() => {
        callCount.n++;
        // First call (project-specific) returns null → triggers cross-project
        if (callCount.n === 1) {
          return null;
        }
        return {
          observations: [],
          personal: [],
          stats: { total_memories: 5, total_personal: 0, active_workflows: 0 },
          topic: null,
        };
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('new project');
  });

  test('personal preferences are not injected when PERSONAL_INJECT_LIMIT is 0', async () => {
    const deps = buildDeps({
      mem: vi.fn().mockResolvedValue({
        observations: [],
        personal: [{ id: 1, title: 'Use tabs not spaces', type: 'preference' }],
        stats: { total_memories: 10, total_personal: 1, active_workflows: 0 },
        topic: null,
      }),
    });
    const handler = extractHandler(deps);

    const result = await handler({ prompt: 'format code' }, { cwd: process.cwd() });
    const content = result.message.content;

    // PERSONAL_INJECT_LIMIT = 0, so no personal section appears
    expect(content).not.toContain('### Personal Preferences');
    expect(content).not.toContain('Use tabs not spaces');
  });
});
