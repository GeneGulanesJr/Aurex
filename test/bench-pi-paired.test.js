import { describe, expect, it } from 'vitest';

const { parsePiOutput } = require('../bench/bench-pi-paired.js');

describe('bench pi paired parser', () => {
  it('counts usage once when Pi repeats it for the same response', () => {
    const raw = [
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          responseId: 'resp_1',
          usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 0.12 } },
          content: [{ type: 'text', text: 'First final answer.' }],
        },
      }),
      JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          responseId: 'resp_1',
          usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 0.12 } },
          content: [{ type: 'text', text: 'First final answer.' }],
        },
      }),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          responseId: 'resp_2',
          usage: { input_tokens: 50, output_tokens: 10, cache_read_tokens: 5 },
          content: 'Second final answer.',
        },
      }),
    ].join('\n');

    const parsed = parsePiOutput(raw);

    expect(parsed.usage.input_tokens).toBe(150);
    expect(parsed.usage.output_tokens).toBe(30);
    expect(parsed.usage.cache_read_tokens).toBe(35);
    expect(parsed.usage.cache_write_tokens).toBe(40);
    expect(parsed.usage.active_tokens).toBe(180);
    expect(parsed.usage.total_tokens).toBe(215);
    expect(parsed.usage.cost_usd).toBe(0.12);
    expect(parsed.answer).toBe('First final answer.\nSecond final answer.');
  });
});
