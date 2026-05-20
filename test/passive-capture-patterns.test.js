import { describe, it, expect } from 'vitest';

const DECISION_PATTERNS = [
  {
    regex: /\b(I['']ll use|let's use|we should use|going with|switching to|using .* instead of)\b.*\b(because|since|reason|to avoid|for better)\b/i,
    type: 'decision',
    label: 'Design decision',
  },
  { regex: /\b(approach|strategy|architecture|pattern|design):\s.*\b(implement|chose|selected|decided)\b/i, type: 'decision', label: 'Architecture choice' },
  { regex: /\b(root cause|the bug was|issue is that|fixed by|workaround is to)\b/i, type: 'bugfix', label: 'Bug fix' },
  { regex: /\b(I discovered that|turns out the reason|found that .* because|note that .* limitation)\b/i, type: 'discovery', label: 'Discovery' },
  { regex: /\b(cannot .* because|constraint is|requirement is that|limitation:)\b/i, type: 'architecture', label: 'Constraint identified' },
];

function matchPattern(text) {
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.regex.test(text)) return pattern;
  }
  return null;
}

describe('passive capture patterns', () => {
  it('matches design decision with reasoning word', () => {
    expect(matchPattern("I'll use SQLite because it's simpler").type).toBe('decision');
    expect(matchPattern("Going with the cache since it's faster").type).toBe('decision');
    expect(matchPattern("Switching to Bun to avoid startup overhead").type).toBe('decision');
    expect(matchPattern("Using SQLite instead of PostgreSQL for better local dev").type).toBe('decision');
  });

  it('matches bugfix and discovery patterns', () => {
    expect(matchPattern('The root cause was a missing guard').type).toBe('bugfix');
    expect(matchPattern('I discovered that the cache never expires').type).toBe('discovery');
  });

  it('does not match unrelated text', () => {
    expect(matchPattern('I will use the helper')).toBeNull();
    expect(matchPattern('Going with option A')).toBeNull();
    expect(matchPattern('Here is the code snippet')).toBeNull();
  });
});
