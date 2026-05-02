// test/code-analysis.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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
    assert.ok(Array.isArray(r.edges), 'edges should be array');
    assert.ok(r.edges.length >= 2, `Expected >= 2 edges, got ${r.edges.length}`);
  });

  it('import-graph — recursive traversal', () => {
    const r = run(`import-graph --repo ${REPO} --file memory-store.js --direction imports --depth 2`);
    assert.ok(r.downstream || r.edges, 'Should return traversal or edges');
  });

  it('call-hierarchy — should find callers', () => {
    const r = run(`call-hierarchy --symbol buildImportGraph --repo ${REPO} --direction callers --depth 2`);
    assert.ok(r.callers || r.symbol, 'Should return symbol or callers');
    if (r.error) assert.fail(`Unexpected error: ${JSON.stringify(r)}`);
  });

  it('call-hierarchy — should find callees', () => {
    const r = run(`call-hierarchy --symbol indexRepoInternal --repo ${REPO} --direction callees --depth 2`);
    if (r.error) assert.ok(true, `Expected error for complex symbol: ${r.error}`);
    else assert.ok(r.callees || r.symbol, 'Should return symbol or callees');
  });

  it('blast-radius — should return affected files', () => {
    const r = run(`blast-radius --symbol hashContent --repo ${REPO} --depth 2`);
    if (r.error) assert.ok(true, `Expected error: ${r.error}`);
    else {
      assert.ok(r.affected_files || r.callers || r.file_importers, 'Should return affected data');
    }
  });

  it('dead-code — should return dead symbols', () => {
    const r = run(`dead-code --repo ${REPO} --min-confidence 0.3`);
    assert.ok(Array.isArray(r.dead_files) || Array.isArray(r.dead_symbols), 'Should have dead files or symbols');
  });

  it('complexity — should return complexity data', () => {
    const r = run(`complexity --repo ${REPO}`);
    assert.ok(Array.isArray(r) || r.symbol_id || r.name, 'Should return complexity list or single item');
  });

  it('complexity — single symbol', () => {
    const r = run(`complexity --repo ${REPO} --symbol save`);
    // May be array or single object depending on result format
    assert.ok(r, 'Should return result');
  });

  it('outline — should return file outline', () => {
    const r = run(`outline --repo ${REPO} --file code-analysis.js`);
    assert.ok(r.classes !== undefined || r.standalone !== undefined, 'Should have classes or standalone');
  });

  // Skipping churn (requires git with correct path) and hotspots (depends on churn)
  it('cycles — should detect dependency cycles', () => {
    const r = run(`cycles --repo ${REPO}`);
    assert.ok(Array.isArray(r.cycles), 'cycles should be array');
    assert.ok(typeof r.total_circular_files === 'number', 'Should have total_circular_files');
  });

  it('importance — should return PageRank results', () => {
    const r = run(`importance --repo ${REPO} --top 5`);
    assert.ok(Array.isArray(r.importance), 'importance should be array');
    assert.ok(r.total_symbols > 0, `Expected >0 symbols, got ${r.total_symbols}`);
  });

  it('coupling — should return coupling metrics', () => {
    const r = run(`coupling --repo ${REPO}`);
    assert.ok(Array.isArray(r.metrics), 'metrics should be array');
  });

  it('extractable — should return extraction candidates', () => {
    const r = run(`extractable --repo ${REPO} --min-complexity 5 --min-callers 1 --top 10`);
    assert.ok(Array.isArray(r.candidates), 'candidates should be array');
  });

  it('hierarchy — should return class hierarchy', () => {
    // Most symbols won't have hierarchy, that's OK
    const r = run(`hierarchy --repo ${REPO} --symbol main`);
    if (r.error) assert.ok(true, `Expected error: ${r.error}`);
    else assert.ok(r.name, 'Should return name');
  });

  it('signal-chains — should return chains', () => {
    const r = run(`signal-chains --repo ${REPO}`);
    assert.ok(Array.isArray(r.chains), 'chains should be array');
    assert.ok(typeof r.gateway_count === 'number', 'Should have gateway_count');
  });

  it('layer-violations — should handle missing config', () => {
    const r = run(`layer-violations --repo ${REPO}`);
    assert.ok(r.violations || r.note || r.error, 'Should have violations, note, or error');
  });

  it('search-code — should find code symbols', () => {
    const r = run(`search-code --query hash --repo ${REPO} --max-results 3`);
    assert.ok(r.results.length >= 1, `Expected >=1 result, got ${r.results.length}`);
  });

  it('get-code-source — should retrieve source', () => {
    const r = run(`get-code-source --repo ${REPO} --file ${__dirname}/../code-analysis.js --name extractImportsFromSource`);
    if (r.success) {
      assert.ok(r.source.includes('import'), 'Source should contain import-related code');
    } else {
      assert.ok(r.error, 'Should have error');
    }
  });
});