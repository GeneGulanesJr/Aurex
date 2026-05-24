import { extractUserPrompt } from '../extensions/memory-layer/hooks/context-injection.ts';

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
});
