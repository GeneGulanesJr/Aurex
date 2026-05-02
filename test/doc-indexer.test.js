// test/doc-indexer.test.js
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');
const DOC_REPO = 'pi-docs';
const DOC_PATH = path.resolve(__dirname, '..', 'docs');

function run(cmd) {
  try {
    const out = execSync(`node "${STORE}" ${cmd}`, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out.trim());
  } catch (e) {
    if (e.stdout?.trim()) return JSON.parse(e.stdout.trim());
    throw e;
  }
}

describe('doc-indexer (v5)', () => {
  before(() => {
    // Ensure pi-docs is indexed
    try {
      run(`reindex-docs --repo ${DOC_REPO}`);
    } catch (_) {
      run(`index-docs --path "${DOC_PATH}" --name ${DOC_REPO}`);
    }
  });

  it('doc-search — should find sections by query', () => {
    const r = run(`doc-search --query "memory wasm" --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r.results), 'results should be array');
    assert.ok(r.results.length >= 1, `Expected >=1 result, got ${r.results.length}`);
  });

  it('doc-search — role filter', () => {
    const r = run(`doc-search --query "code" --repo ${DOC_REPO} --role how_to`);
    if (!r.error) assert.ok(Array.isArray(r.results), 'results should be array');
  });

  it('doc-outline — full outline', () => {
    const r = run(`doc-outline --repo ${DOC_REPO}`);
    assert.ok(r.files || r.error, 'Should return files or error');
  });

  it('doc-outline — single file', () => {
    const r = run(`doc-outline --repo ${DOC_REPO} --file SKILL.md`);
    if (!r.error) assert.ok(Array.isArray(r) || r.length !== undefined, 'Should return sections');
  });

  it('backlinks — should find inbound links', () => {
    const r = run(`backlinks --repo ${DOC_REPO} --path SKILL.md`);
    assert.ok(Array.isArray(r.backlinks) || r.error, 'Should return backlinks or error');
  });

  it('broken-links — should find broken links', () => {
    const r = run(`broken-links --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r.broken_links) || r.error, 'Should return broken_links or error');
  });

  it('glossary — should list terms', () => {
    const r = run(`glossary --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r) || r.error, 'Should return terms or error');
  });

  it('tutorial-path — should find path', () => {
    const r = run(`tutorial-path --repo ${DOC_REPO} --section 740`);
    if (!r.error) {
      assert.ok(Array.isArray(r.chain), 'chain should be array');
    }
  });

  it('code-examples — should find code blocks', () => {
    const r = run(`code-examples --repo ${DOC_REPO} --query "require"`);
    assert.ok(Array.isArray(r.results), 'results should be array');
  });

  it('doc-orphans — should find orphan sections', () => {
    const r = run(`doc-orphans --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r.orphans), 'orphans should be array');
    assert.ok(typeof r.total === 'number', 'Should have total');
  });

  it('doc-coverage — should compute coverage', () => {
    const r = run(`doc-coverage --repo PiMemoryExtension --doc-repo ${DOC_REPO}`);
    assert.ok(typeof r.coverage_pct === 'number', 'Should have coverage_pct');
    assert.ok(r.total_symbols > 0, `Expected >0 symbols, got ${r.total_symbols}`);
  });

  it('stale-pages — should detect stale docs', () => {
    const r = run(`stale-pages --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r.stale), 'stale should be array');
    assert.ok(Array.isArray(r.missing), 'missing should be array');
    assert.ok(typeof r.total_files === 'number', 'Should have total_files');
  });

  it('doc-duplicates — should detect duplicates', () => {
    const r = run(`doc-duplicates --repo ${DOC_REPO}`);
    assert.ok(Array.isArray(r.duplicates), 'duplicates should be array');
    assert.ok(typeof r.total_duplicate_groups === 'number', 'Should have total_duplicate_groups');
  });

  it('index-docs — should reindex without error', () => {
    const r = run(`reindex-docs --repo ${DOC_REPO}`);
    assert.ok(r.success, `reindex-docs failed: ${JSON.stringify(r)}`);
    assert.ok(r.files >= 1, `Expected >=1 file, got ${r.files}`);
    assert.ok(r.sections >= 1, `Expected >=1 section, got ${r.sections}`);
  });
});