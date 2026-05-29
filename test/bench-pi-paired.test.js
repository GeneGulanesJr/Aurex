import { describe, expect, it } from 'vitest';

const { buildSummary, parsePiOutput } = require('../bench/bench-pi-paired.js');

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
    expect(parsed.behavior.assistant_turns).toBe(2);
  });

  it('counts executed tools from Pi tool execution events', () => {
    const raw = [
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          responseId: 'resp_tool',
          usage: { input: 10, output: 5 },
          content: [{ type: 'toolCall', id: 'call_1', name: 'memory-code', arguments: { mode: 'search' } }],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'memory-code',
        args: { mode: 'search' },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'memory-code',
        result: { content: [] },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call_2',
        toolName: 'read',
        args: { path: 'src/memory-domain/search.js', offset: 45, limit: 40 },
      }),
    ].join('\n');

    const parsed = parsePiOutput(raw);

    expect(parsed.tool_counts).toEqual({
      'memory-code': 1,
      read: 1,
    });
    expect(parsed.behavior).toMatchObject({
      assistant_turns: 1,
      tool_calls: 2,
      failed_tool_calls: 0,
      memory_tool_calls: 1,
      code_tool_calls: 2,
    });
  });

  it('summarizes behavior counters', () => {
    const summary = buildSummary([
      {
        memory_off: {
          elapsed_ms: 10,
          usage: { active_tokens: 100, cache_read_tokens: 20 },
          grade: { matched: 1, total: 1 },
          behavior: {
            tool_calls: 2,
            failed_tool_calls: 1,
            memory_tool_calls: 0,
            code_tool_calls: 1,
            assistant_turns: 2,
          },
        },
        memory_on: {
          elapsed_ms: 5,
          usage: { active_tokens: 50, cache_read_tokens: 30 },
          grade: { matched: 1, total: 1 },
          behavior: {
            tool_calls: 1,
            failed_tool_calls: 0,
            memory_tool_calls: 1,
            code_tool_calls: 1,
            assistant_turns: 1,
          },
        },
      },
    ]);

    expect(summary.memory_off_tool_calls).toBe(2);
    expect(summary.memory_on_tool_calls).toBe(1);
    expect(summary.memory_off_failed_tool_calls).toBe(1);
    expect(summary.memory_on_failed_tool_calls).toBe(0);
    expect(summary.memory_on_memory_tool_calls).toBe(1);
    expect(summary.memory_on_code_tool_calls).toBe(1);
    expect(summary.memory_on_assistant_turns).toBe(1);
    expect(summary.memory_on_elapsed_ms).toBe(5);
  });
});
