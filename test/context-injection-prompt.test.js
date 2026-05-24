import {
  extractUserPrompt,
  isHistoricalMemoryPrompt,
  isSourceAuthoritativePrompt,
  registerBeforeAgentStart,
} from '../extensions/memory-layer/hooks/context-injection.ts';

describe('context injection prompt extraction', () => {
  test('uses the latest user message content parts', () => {
    const prompt = extractUserPrompt({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: [{ type: 'text', text: 'Where is context injection wired?' }] },
      ],
    });

    expect(prompt).toBe('Where is context injection wired?');
  });

  test('falls back to prompt-like event fields', () => {
    expect(extractUserPrompt({ prompt: 'Why FTS5?' })).toBe('Why FTS5?');
  });

  test('returns null when no text prompt is available', () => {
    expect(extractUserPrompt({ messages: [{ role: 'assistant', content: 'Nope' }] })).toBeNull();
  });

  test('detects prompts that should inspect current source instead of auto memory', () => {
    expect(
      isSourceAuthoritativePrompt(
        'In the current source, what does rankObservations multiply by typeBoost? Answer from the code.',
      ),
    ).toBe(true);
    expect(isSourceAuthoritativePrompt('Where is automatic project memory context wired into the Pi extension?')).toBe(
      false,
    );
  });

  test('detects historical memory prompts', () => {
    expect(isHistoricalMemoryPrompt('Why did LaPis choose SQLite FTS5?')).toBe(true);
    expect(isHistoricalMemoryPrompt('What bug led to the createDb pattern?')).toBe(true);
    expect(isHistoricalMemoryPrompt('In the current source, what does rankObservations multiply?')).toBe(false);
  });

  test('source-authoritative prompts bypass memory context without mutating injection state', async () => {
    let handler;
    const pi = {
      on: vi.fn((_eventName, callback) => {
        handler = callback;
      }),
    };
    const deps = {
      state: { currentProject: 'PiMemoryExtension', hasInjectedContext: false, sessionId: 1 },
      mem: vi.fn(),
      getKnownRepos: vi.fn(),
      isRepoStale: vi.fn(),
    };

    registerBeforeAgentStart(pi, deps);
    const result = await handler(
      {
        messages: [
          {
            role: 'user',
            content: 'In the current source, what fields does context return? Answer from the code.',
          },
        ],
      },
      { cwd: process.cwd() },
    );

    expect(deps.mem).not.toHaveBeenCalled();
    expect(deps.state.hasInjectedContext).toBe(false);
    expect(result).toBeUndefined();
  });

  test('promptless startup injects project summary without memory titles', async () => {
    let handler;
    const pi = {
      on: vi.fn((_eventName, callback) => {
        handler = callback;
      }),
    };
    const deps = {
      state: { currentProject: 'PiMemoryExtension', hasInjectedContext: false, sessionId: 1 },
      mem: vi.fn().mockResolvedValue({
        observations: [{ type: 'decision', title: 'Noisy prior decision', trust_score: 0.95 }],
        personal: [{ title: 'Personal preference' }],
        stats: { total_memories: 42, total_personal: 1, active_workflows: 0 },
        topic: null,
      }),
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'PiMemoryExtension',
          path: process.cwd(),
          file_count: 292,
          symbol_count: 6913,
          indexed_at: '2026-05-24 00:00:00',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(false),
    };

    registerBeforeAgentStart(pi, deps);
    const result = await handler({}, { cwd: process.cwd() });
    const content = result.message.content;

    expect(deps.mem).toHaveBeenCalledWith(
      'context',
      expect.objectContaining({ project: 'PiMemoryExtension', limit: '1' }),
    );
    expect(content).toContain('### Project Context');
    expect(content).toContain('Code index: `PiMemoryExtension`');
    expect(content).not.toContain('Noisy prior decision');
    expect(content).not.toContain('Personal preference');
  });

  test('prompt-matched startup caps injected memories', async () => {
    let handler;
    const pi = {
      on: vi.fn((_eventName, callback) => {
        handler = callback;
      }),
    };
    const deps = {
      state: { currentProject: 'PiMemoryExtension', hasInjectedContext: false, sessionId: 1 },
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'decision',
            title: 'Matched decision 1',
            trust_score: 0.95,
            content: '**What**: Use SQLite FTS5\n**Why**: Avoid external search services\n**Where**: src/search.js',
          },
          {
            type: 'bugfix',
            title: 'Matched bugfix 2',
            trust_score: 0.95,
            content: '**What**: Fixed config leak',
          },
          {
            type: 'pattern',
            title: 'Matched pattern 3',
            trust_score: 0.95,
            content: '**What**: Should not be injected',
          },
        ],
        personal: [],
        stats: { total_memories: 42, total_personal: 0, active_workflows: 0 },
        topic: 'benchmark',
      }),
      getKnownRepos: vi.fn().mockResolvedValue([]),
      isRepoStale: vi.fn().mockReturnValue(false),
    };

    registerBeforeAgentStart(pi, deps);
    const result = await handler({ prompt: 'benchmark memory context' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(deps.mem).toHaveBeenCalledWith(
      'context',
      expect.objectContaining({ project: 'PiMemoryExtension', limit: '5', query: 'benchmark memory context' }),
    );
    expect(content).toContain('### Prompt-Matched Memory');
    expect(content).toContain('Matched decision 1');
    expect(content).toContain('What: Use SQLite FTS5 Why: Avoid external search services Where: src/search.js');
    expect(content).toContain('Matched bugfix 2');
    expect(content).not.toContain('Matched pattern 3');
    expect(content).not.toContain('Should not be injected');
  });

  test('historical prompt suppresses stale code verification warning', async () => {
    let handler;
    const pi = {
      on: vi.fn((_eventName, callback) => {
        handler = callback;
      }),
    };
    const deps = {
      state: { currentProject: 'PiMemoryExtension', hasInjectedContext: false, sessionId: 1 },
      mem: vi.fn().mockResolvedValue({
        observations: [
          {
            type: 'architecture',
            title: 'SQLite FTS5 rationale',
            trust_score: 0.95,
            content: '**Why**: Avoid external services\n**Where**: src/memory-domain/search.js',
          },
        ],
        personal: [],
        stats: { total_memories: 42, total_personal: 0, active_workflows: 0 },
        topic: 'why fts5',
      }),
      getKnownRepos: vi.fn().mockResolvedValue([
        {
          name: 'PiMemoryExtension',
          path: process.cwd(),
          file_count: 292,
          symbol_count: 6913,
          indexed_at: '2026-05-24 00:00:00',
        },
      ]),
      isRepoStale: vi.fn().mockReturnValue(true),
    };

    registerBeforeAgentStart(pi, deps);
    const result = await handler({ prompt: 'Why did LaPis choose SQLite FTS5?' }, { cwd: process.cwd() });
    const content = result.message.content;

    expect(content).toContain('Code index: `PiMemoryExtension`');
    expect(content).not.toContain('Stale code index');
    expect(content).toContain('Why: Avoid external services Where: src/memory-domain/search.js');
  });
});
