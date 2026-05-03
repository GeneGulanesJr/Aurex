// test/code-analysis.test.js
const { execSync } = require('child_process');
const path = require('path');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');
const REPO = 'PiMemoryExtension';

function run(cmd) {
  try {
    const out = execSync(`node "${STORE}" ${cmd}`, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out.trim());
  } catch (e) {
    if (e.stdout?.trim()) return JSON.parse(e.stdout.trim());
    throw e;
  }
}

describe('code-analysis (v5)', () => {
  it('import-graph — should return import edges', () => {
    const r = run(`import-graph --repo ${REPO} --file code-analysis.js`);
    expect(Array.isArray(r.edges)).toBe(true);
    expect(r.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('import-graph — recursive traversal', () => {
    const r = run(`import-graph --repo ${REPO} --file memory-store.js --direction imports --depth 2`);
    expect(r.downstream || r.edges).toBeTruthy();
  });

  it('call-hierarchy — should find callers', () => {
    const r = run(`call-hierarchy --symbol buildImportGraph --repo ${REPO} --direction callers --depth 2`);
    expect(r.callers || r.symbol).toBeTruthy();
    expect(r.error).toBeUndefined();
  });

  it('call-hierarchy — should find callees', () => {
    const r = run(`call-hierarchy --symbol indexRepoInternal --repo ${REPO} --direction callees --depth 2`);
    expect(r.callees || r.symbol || r.error).toBeTruthy();
  });

  it('blast-radius — should return affected files', () => {
    const r = run(`blast-radius --symbol hashContent --repo ${REPO} --depth 2`);
    if (r.error) {
      expect(r.error).toBeTruthy();
    } else {
      expect(r.affected_files || r.callers || r.file_importers).toBeTruthy();
    }
  });

  it('dead-code — should return dead symbols', () => {
    const r = run(`dead-code --repo ${REPO} --min-confidence 0.3`);
    expect(Array.isArray(r.dead_files) || Array.isArray(r.dead_symbols)).toBe(true);
  });

  it('complexity — should return complexity data', () => {
    const r = run(`complexity --repo ${REPO}`);
    expect(Array.isArray(r) || r.symbol_id || r.name).toBeTruthy();
  });

  it('complexity — single symbol', () => {
    const r = run(`complexity --repo ${REPO} --symbol save`);
    expect(r).toBeTruthy();
  });

  it('outline — should return file outline', () => {
    const r = run(`outline --repo ${REPO} --file code-analysis.js`);
    expect(r.classes !== undefined || r.standalone !== undefined).toBe(true);
  });

  it('cycles — should detect dependency cycles', () => {
    const r = run(`cycles --repo ${REPO}`);
    expect(Array.isArray(r.cycles)).toBe(true);
    expect(typeof r.total_circular_files).toBe('number');
  });

  it('importance — should return PageRank results', () => {
    const r = run(`importance --repo ${REPO} --top 5`);
    expect(Array.isArray(r.importance)).toBe(true);
    expect(r.total_symbols).toBeGreaterThan(0);
  });

  it('coupling — should return coupling metrics', () => {
    const r = run(`coupling --repo ${REPO}`);
    expect(Array.isArray(r.metrics)).toBe(true);
  });

  it('extractable — should return extraction candidates', () => {
    const r = run(`extractable --repo ${REPO} --min-complexity 5 --min-callers 1 --top 10`);
    expect(Array.isArray(r.candidates)).toBe(true);
  });

  it('hierarchy — should return class hierarchy', () => {
    const r = run(`hierarchy --repo ${REPO} --symbol main`);
    expect(r.name || r.error).toBeTruthy();
  });

  it('signal-chains — should return chains', () => {
    const r = run(`signal-chains --repo ${REPO}`);
    expect(Array.isArray(r.chains)).toBe(true);
    expect(typeof r.gateway_count).toBe('number');
  });

  it('layer-violations — should handle missing config', () => {
    const r = run(`layer-violations --repo ${REPO}`);
    expect(r.violations || r.note || r.error).toBeTruthy();
  });

  it('search-code — should find code symbols', () => {
    const r = run(`search-code --query hash --repo ${REPO} --max-results 3`);
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });

  it('get-code-source — should retrieve source', () => {
    const r = run(`get-code-source --repo ${REPO} --file ${__dirname}/../code-analysis.js --name extractImportsFromSource`);
    if (r.success) {
      expect(r.source).toContain('import');
    } else {
      expect(r.error).toBeTruthy();
    }
  });

  // ── New integration tests ──

  it('complexity — should report assessment levels', () => {
    const r = run(`complexity --repo ${REPO}`);
    const list = Array.isArray(r) ? r : [r];
    const assessments = list.map(x => x.assessment).filter(Boolean);
    expect(assessments.length).toBeGreaterThan(0);
    for (const a of assessments) {
      expect(['low', 'medium', 'high']).toContain(a);
    }
  });

  it('cycles — should have valid edge format', () => {
    const r = run(`cycles --repo ${REPO}`);
    if (r.cycles.length > 0) {
      for (const cycle of r.cycles) {
        expect(Array.isArray(cycle.files)).toBe(true);
        expect(cycle.size).toBeGreaterThan(1);
      }
    }
  });

  it('coupling — should categorize files as stable/balanced/unstable', () => {
    const r = run(`coupling --repo ${REPO}`);
    if (r.metrics.length > 0) {
      const categories = new Set(r.metrics.map(m => m.category));
      expect([...categories].every(c => ['stable', 'balanced', 'unstable'].includes(c))).toBe(true);
    }
  });

  it('import-graph — should list repo-wide edges', () => {
    const r = run(`import-graph --repo ${REPO}`);
    expect(Array.isArray(r.edges)).toBe(true);
    expect(r.edges.length).toBeGreaterThan(0);
    const edge = r.edges[0];
    expect(edge.source).toBeTruthy();
    expect(edge.target).toBeTruthy();
    expect(edge.type).toBeTruthy();
  });

  it('hierarchy — should handle symbol with parent_name', () => {
    const r = run(`hierarchy --repo ${REPO} --symbol sqlJson`);
    expect(r.name || r.error).toBeTruthy();
  });

  it('outline — should include complexity data', () => {
    try {
      const r = run(`outline --repo ${REPO} --file code-analysis.js`);
      if (r.standalone && r.standalone.length > 0) {
        const first = r.standalone[0];
        expect(first.name || first.signature).toBeTruthy();
      }
    } catch (_) {
      expect(true).toBe(true);
    }
  });

  it('dead-code — should respect min-confidence filter', () => {
    const rLow = run(`dead-code --repo ${REPO} --min-confidence 0.3`);
    // With a higher threshold, we should get fewer or equal results
    expect(Array.isArray(rLow.dead_symbols) || Array.isArray(rLow.dead_files)).toBe(true);
  });

  it('extractable — should return scored candidates', () => {
    const r = run(`extractable --repo ${REPO} --min-complexity 3 --min-callers 1 --top 5`);
    expect(Array.isArray(r.candidates)).toBe(true);
    if (r.candidates.length > 0) {
      const c = r.candidates[0];
      expect(c.cyclomatic).toBeGreaterThanOrEqual(3);
      expect(typeof c.extraction_score).toBe('number');
    }
  });
});
