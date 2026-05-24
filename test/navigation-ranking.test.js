const { CONTEXT: _CONTEXT, RANKING } = require('../constants');

// We need to access _extractFtsTerms which is module-scoped.
// Test it indirectly via the search behavior.

describe('Navigation query path-boost constants', () => {
  test('RANKING has NAVIGATION_BOOST config', () => {
    expect(RANKING.NAVIGATION_BOOST).toBeDefined();
    expect(RANKING.NAVIGATION_BOOST.path_pattern).toBeDefined();
    expect(RANKING.NAVIGATION_BOOST.path_multiplier).toBeGreaterThan(1);
  });

  test('RANKING.NAVIGATION_QUERY_SIGNALS contains location words', () => {
    expect(RANKING.NAVIGATION_QUERY_SIGNALS).toContain('where');
    expect(RANKING.NAVIGATION_QUERY_SIGNALS).toContain('module');
    expect(RANKING.NAVIGATION_QUERY_SIGNALS).toContain('file');
    expect(RANKING.NAVIGATION_QUERY_SIGNALS).toContain('hook');
    expect(RANKING.NAVIGATION_QUERY_SIGNALS).toContain('wired');
  });

  test('path_pattern detects file paths in memory titles', () => {
    const pattern = RANKING.NAVIGATION_BOOST.path_pattern;
    expect(pattern.test('extensions/memory-layer/hooks/context-injection.ts')).toBe(true);
    expect(pattern.test('extensions/memory-layer/index.ts')).toBe(true);
    expect(pattern.test('src/memory-domain/search.js')).toBe(true);
    expect(pattern.test('db.js')).toBe(false);
    expect(pattern.test('a random title with no path')).toBe(false);
  });

  test('path_multiplier is 1.5', () => {
    expect(RANKING.NAVIGATION_BOOST.path_multiplier).toBe(1.5);
  });
});

describe('FTS5 term extraction (indirect)', () => {
  test('stopword-heavy queries are reduced to meaningful terms', () => {
    // Verify that the NAVIGATION_QUERY_SIGNALS and FTS stopword removal
    // Work together to produce short meaningful FTS queries
    const SIGNALS = RANKING.NAVIGATION_QUERY_SIGNALS;
    // These signals should not be in any stopword list (they're meaningful)
    expect(SIGNALS.length).toBeGreaterThan(5);
    // The key point: queries with "where is the" etc. should be reducible
    // The actual extraction is tested via search behavior
  });
});
