
/**
 * Tests for context-injection lightweight mode logic.
 *
 * These test the decision logic, not the full hook (which requires Pi API mocks).
 * The logic is: when the code index is stale AND there are no relevant observations
 * AND no personal preferences, emit a short stale-only context instead of the full
 * observation list.
 */

function buildLightweightContext({ observations, personal, isStale, projectName, stats, staleGuidance }) {
  const hasObservations = observations && observations.length > 0;
  const hasPersonal = personal && personal.length > 0;
  const lines = ['## Memory Context (auto-loaded)', ''];

  if (isStale && !hasObservations && !hasPersonal) {
    // Lightweight: stale-only mode
    lines.push(
      `Project: **${projectName}** | ${stats.total_memories} memories | ${stats.total_personal} personal preferences`,
    );
    lines.push('');
    lines.push(staleGuidance);
    lines.push('');
    lines.push('Use `memory-save`, `memory-search`, and `memory-get` tools to interact with memory.');
  } else {
    // Full context
    lines.push(
      `Project: **${projectName}** | ${stats.total_memories} memories | ${stats.total_personal} personal preferences`,
    );
    lines.push('');
    if (hasObservations) {
      lines.push('### Recent Relevant Memory');
      for (const o of observations) {
        let trust = '';
        if ((o.trust_score ?? 1) < 0.5) {
          trust = '⚠️';
        } else if ((o.trust_score ?? 1) < 0.8) {
          trust = '🔎';
        }
        lines.push(`- [${o.type}] ${o.title}${trust}`);
      }
      lines.push('');
    }
    if (hasPersonal) {
      lines.push('### Your Preferences (cross-project)');
      for (const p of personal.slice(0, 5)) {
        lines.push(`- ${p.title}`);
      }
      lines.push('');
    }
    lines.push('Use `memory-save`, `memory-search`, and `memory-get` tools to interact with memory.');
    if (isStale) {
      lines.push('');
      lines.push(staleGuidance);
    }
  }

  return lines;
}

const STALE_GUIDANCE =
  '📝 **Stale code index:** indexed code may not match current source files. Run `memory-code reindex-repo --repo TestRepo` to update. Verify current source before relying on code-index results.';

describe('context-injection lightweight mode', () => {
  test('stale + no observations → lightweight context', () => {
    const result = buildLightweightContext({
      observations: [],
      personal: [],
      isStale: true,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });
    const text = result.join('\n');

    expect(text).toContain('Stale code index');
    expect(text).not.toContain('Recent Relevant Memory');
    expect(text).not.toContain('Your Preferences');
    expect(result.length).toBeLessThan(8);
  });

  test('stale + has observations → full context with stale warning', () => {
    const result = buildLightweightContext({
      observations: [{ type: 'decision', title: 'Some decision', trust_score: 0.9 }],
      personal: [],
      isStale: true,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });
    const text = result.join('\n');

    expect(text).toContain('Recent Relevant Memory');
    expect(text).toContain('Stale code index');
  });

  test('stale + has personal prefs → full context', () => {
    const result = buildLightweightContext({
      observations: [],
      personal: [{ title: 'My preference' }],
      isStale: true,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });
    const text = result.join('\n');

    expect(text).toContain('Your Preferences');
    expect(text).toContain('Stale code index');
  });

  test('not stale + no observations → minimal context (no stale warning)', () => {
    const result = buildLightweightContext({
      observations: [],
      personal: [],
      isStale: false,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });
    const text = result.join('\n');

    expect(text).not.toContain('Stale code index');
    expect(text).not.toContain('Recent Relevant Memory');
  });

  test('lightweight is significantly shorter than full context', () => {
    const lightweight = buildLightweightContext({
      observations: [],
      personal: [],
      isStale: true,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });
    const full = buildLightweightContext({
      observations: [
        { type: 'decision', title: 'Decision 1', trust_score: 0.9 },
        { type: 'bugfix', title: 'Bug fix 1', trust_score: 0.8 },
        { type: 'decision', title: 'Decision 2', trust_score: 0.7 },
      ],
      personal: [{ title: 'Pref 1' }, { title: 'Pref 2' }],
      isStale: true,
      projectName: 'TestProject',
      stats: { total_memories: 300, total_personal: 3 },
      staleGuidance: STALE_GUIDANCE,
    });

    const lightLen = lightweight.join('\n').length;
    const fullLen = full.join('\n').length;
    expect(lightLen).toBeLessThan(fullLen * 0.75);
  });
});
