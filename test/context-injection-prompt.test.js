import {
  extractUserPrompt,
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
});
