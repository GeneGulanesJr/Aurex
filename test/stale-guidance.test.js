const { CONTEXT } = require('../constants');

describe('Stale index guidance', () => {
  test('CONTEXT has STALE_GUIDANCE compact text', () => {
    expect(CONTEXT.STALE_GUIDANCE).toBeDefined();
    expect(typeof CONTEXT.STALE_GUIDANCE).toBe('string');
    expect(CONTEXT.STALE_GUIDANCE).toContain('reindex-repo');
    expect(CONTEXT.STALE_GUIDANCE).toContain('{repo}');
    expect(CONTEXT.STALE_GUIDANCE).toContain('Verify');
    expect(CONTEXT.STALE_GUIDANCE.length).toBeLessThan(300);
  });

  test('STALE_GUIDANCE replaces {repo} placeholder', () => {
    const result = CONTEXT.STALE_GUIDANCE.replace('{repo}', 'TestRepo');
    expect(result).toContain('TestRepo');
    expect(result).not.toContain('{repo}');
    expect(result).toContain('reindex-repo');
  });
});
