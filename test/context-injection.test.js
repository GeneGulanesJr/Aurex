/**
 * Tests for lean context injection format.
 *
 * Tests the output format of buildLeanContext, which mirrors the
 * lines-building logic in context-injection.ts registerBeforeAgentStart.
 */

const CONTEXT = {
  MIN_OBSERVATION_TRUST: 0.8,
  PROMPT_INJECT_LIMIT: 1,
  PERSONAL_INJECT_LIMIT: 0,
};

function buildLeanContext({ observations, personal, isStale, projectName, stats, cwdRepo, projectSummary }) {
  const lines = [];

  // Header
  if (!cwdRepo) {
    lines.push(
      `🧠 **${projectName}** — new project · ${stats.total_memories} memories across all projects`,
    );
  } else {
    const indexPart = cwdRepo
      ? `${cwdRepo.file_count} files indexed${isStale ? ' (stale)' : ''}`
      : 'not indexed';
    lines.push(
      `🧠 **${projectName}** — ${stats.total_memories} memories · ${indexPart} · ${projectSummary}`,
    );
  }

  // Observation: max 1, trust >= 0.8, title only
  const top = observations?.[0];
  if (top && (top.trust_score ?? 0) >= CONTEXT.MIN_OBSERVATION_TRUST) {
    lines.push(`- [${top.type}] ${top.title}`);
  }

  // Footer
  const footerParts = ['`memory-search` for recall', '`memory-save` for decisions'];
  if (isStale && cwdRepo) {
    footerParts.push(`reindex: \`memory-code reindex-repo --repo ${cwdRepo.name}\``);
  }
  lines.push(footerParts.join(' · '));

  return lines;
}

describe('lean context injection', () => {
  test('basic stale project with no observations', () => {
    const result = buildLeanContext({
      observations: [],
      isStale: true,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(result.length).toBe(2);
    expect(text).toContain('🧠 **PiMemoryExtension** — 408 memories · 292 files indexed (stale) · 💎 LaPis persistent memory');
    expect(text).toContain('reindex: `memory-code reindex-repo --repo PiMemoryExtension`');
    expect(text).not.toContain('###');
    expect(text).not.toContain('Personal');
  });

  test('fresh project with no observations', () => {
    const result = buildLeanContext({
      observations: [],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(result.length).toBe(2);
    expect(text).toContain('292 files indexed');
    expect(text).not.toContain('(stale)');
    expect(text).not.toContain('reindex');
  });

  test('high-trust observation is included (title only)', () => {
    const result = buildLeanContext({
      observations: [{ type: 'decision', title: 'Architecture: context injection wiring', trust_score: 0.92 }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(result.length).toBe(3);
    expect(text).toContain('- [decision] Architecture: context injection wiring');
    expect(text).not.toContain('What:');
    expect(text).not.toContain('Why:');
  });

  test('low-trust observation is filtered out (the "lol" case)', () => {
    const result = buildLeanContext({
      observations: [{ type: 'bugfix', title: 'Bug fix: comprehensive review', trust_score: 0.35 }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(result.length).toBe(2);
    expect(text).not.toContain('Bug fix');
    expect(text).not.toContain('comprehensive review');
  });

  test('medium-trust observation (0.6) is filtered out', () => {
    const result = buildLeanContext({
      observations: [{ type: 'architecture', title: 'Some architecture note', trust_score: 0.6 }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });

    expect(result.length).toBe(2);
    expect(result.join('\n')).not.toContain('Some architecture note');
  });

  test('trust threshold boundary: 0.79 filtered, 0.80 included', () => {
    const below = buildLeanContext({
      observations: [{ type: 'decision', title: 'Below threshold', trust_score: 0.79 }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    expect(below.length).toBe(2);

    const atThreshold = buildLeanContext({
      observations: [{ type: 'decision', title: 'At threshold', trust_score: 0.80 }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    expect(atThreshold.length).toBe(3);
    expect(atThreshold.join('\n')).toContain('- [decision] At threshold');
  });

  test('only top observation is included even with multiple high-trust', () => {
    const result = buildLeanContext({
      observations: [
        { type: 'decision', title: 'First decision', trust_score: 0.95 },
        { type: 'bugfix', title: 'Second bugfix', trust_score: 0.90 },
      ],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(result.length).toBe(3);
    expect(text).toContain('First decision');
    expect(text).not.toContain('Second bugfix');
  });

  test('new project (no cwdRepo) format', () => {
    const result = buildLeanContext({
      observations: [],
      isStale: false,
      projectName: 'MyNewApp',
      stats: { total_memories: 12 },
      cwdRepo: null,
      projectSummary: '',
    });
    const text = result.join('\n');

    expect(result.length).toBe(2);
    expect(text).toContain('🧠 **MyNewApp** — new project · 12 memories across all projects');
    expect(text).not.toContain('reindex');
  });

  test('no personal preferences are ever injected', () => {
    const result = buildLeanContext({
      observations: [],
      personal: [{ title: 'My preference' }, { title: 'Another preference' }],
      isStale: false,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });
    const text = result.join('\n');

    expect(text).not.toContain('preference');
    expect(text).not.toContain('Personal');
  });

  test('lean output is significantly shorter than old format', () => {
    const lean = buildLeanContext({
      observations: [{ type: 'decision', title: 'Architecture decision', trust_score: 0.9 }],
      isStale: true,
      projectName: 'PiMemoryExtension',
      stats: { total_memories: 408 },
      cwdRepo: { name: 'PiMemoryExtension', file_count: 292 },
      projectSummary: '💎 LaPis persistent memory',
    });

    // Simulate old format size
    const oldLines = [
      '## Memory Context (auto-loaded)',
      '',
      'Project: **PiMemoryExtension** | 408 memories | 3 personal preferences | topic: something',
      '',
      '### Project Context',
      '- Directory: `/home/user/project`',
      '- Summary: 💎 LaPis persistent memory',
      '- Code index: `PiMemoryExtension` with 292 files / 6967 symbols (stale)',
      '',
      '### Prompt-Matched Memory',
      '- [decision] Architecture decision 🔎',
      '  What: The architecture was decided Where: src/something.js',
      '',
      '### Personal Preferences',
      '- Context test personal',
      '- Timestamp check',
      '',
      'Use `memory-search` for deeper recall and `memory-save` for durable decisions.',
      '',
      '📝 **Stale code index:** indexed code may not match current source files. Run `memory-code reindex-repo --repo PiMemoryExtension` to update.',
      '',
      '📂 Extension source: `extensions/memory-layer/` in this project repo.',
    ];

    const leanLen = lean.join('\n').length;
    const oldLen = oldLines.join('\n').length;
    expect(leanLen).toBeLessThan(oldLen * 0.35);
  });
});
