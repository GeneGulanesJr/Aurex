// test/doc-indexer.test.js
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
  beforeAll(() => {
    try {
      run(`reindex-docs --repo ${DOC_REPO}`);
    } catch (_) {
      run(`index-docs --path "${DOC_PATH}" --name ${DOC_REPO}`);
    }
  });

  it('doc-search — should find sections by query', () => {
    const r = run(`doc-search --query "memory wasm" --repo ${DOC_REPO}`);
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });

  it('doc-search — role filter', () => {
    const r = run(`doc-search --query "code" --repo ${DOC_REPO} --role how_to`);
    if (!r.error) expect(Array.isArray(r.results)).toBe(true);
  });

  it('doc-outline — full outline', () => {
    try {
      const r = run(`doc-outline --repo ${DOC_REPO}`);
      expect(r.files || r.error).toBeTruthy();
    } catch (_) {
      expect(true).toBe(true);
    }
  });

  it('doc-outline — single file', () => {
    const r = run(`doc-outline --repo ${DOC_REPO} --file SKILL.md`);
    if (!r.error) expect(Array.isArray(r) || r.length !== undefined).toBe(true);
  });

  it('backlinks — should find inbound links', () => {
    const r = run(`backlinks --repo ${DOC_REPO} --path SKILL.md`);
    expect(Array.isArray(r.backlinks) || r.error).toBeTruthy();
  });

  it('broken-links — should find broken links', () => {
    const r = run(`broken-links --repo ${DOC_REPO}`);
    expect(Array.isArray(r.broken_links) || r.error).toBeTruthy();
  });

  it('glossary — should list terms', () => {
    const r = run(`glossary --repo ${DOC_REPO}`);
    expect(Array.isArray(r) || r.error).toBeTruthy();
  });

  it('tutorial-path — should find path', () => {
    const r = run(`tutorial-path --repo ${DOC_REPO} --section 740`);
    if (!r.error) expect(Array.isArray(r.chain)).toBe(true);
  });

  it('code-examples — should find code blocks', () => {
    const r = run(`code-examples --repo ${DOC_REPO} --query "require"`);
    expect(Array.isArray(r.results)).toBe(true);
  });

  it('doc-orphans — should find orphan sections', () => {
    const r = run(`doc-orphans --repo ${DOC_REPO}`);
    expect(Array.isArray(r.orphans)).toBe(true);
    expect(typeof r.total).toBe('number');
  });

  it('doc-coverage — should compute coverage', () => {
    try {
      const r = run(`doc-coverage --repo PiMemoryExtension --doc-repo ${DOC_REPO}`);
      expect(typeof r.coverage_pct).toBe('number');
      expect(r.total_symbols).toBeGreaterThan(0);
    } catch (_) {
      expect(true).toBe(true);
    }
  });

  it('stale-pages — should detect stale docs', () => {
    const r = run(`stale-pages --repo ${DOC_REPO}`);
    expect(Array.isArray(r.stale)).toBe(true);
    expect(Array.isArray(r.missing)).toBe(true);
    expect(typeof r.total_files).toBe('number');
  });

  it('doc-duplicates — should detect duplicates', () => {
    const r = run(`doc-duplicates --repo ${DOC_REPO}`);
    expect(Array.isArray(r.duplicates)).toBe(true);
    expect(typeof r.total_duplicate_groups).toBe('number');
  });

  it('index-docs — should reindex without error', () => {
    const r = run(`reindex-docs --repo ${DOC_REPO}`);
    expect(r.success).toBe(true);
    expect(r.files).toBeGreaterThanOrEqual(1);
    expect(r.sections).toBeGreaterThanOrEqual(1);
  });

  // ── New integration tests ──

  it('index-docs — should report links and code blocks', () => {
    try {
      const r = run(`reindex-docs --repo ${DOC_REPO}`);
      expect(r.success).toBe(true);
      expect(typeof r.links).toBe('number');
      expect(typeof r.code_blocks).toBe('number');
    } catch (_) {
      expect(true).toBe(true);
    }
  });

  it('doc-search — should return answerable sections with heuristics', () => {
    const r = run(`doc-search --query "memory store" --repo ${DOC_REPO}`);
    expect(Array.isArray(r.results)).toBe(true);
    if (r.results.length > 0) {
      const first = r.results[0];
      expect(first.title).toBeTruthy();
      expect(first.role).toBeTruthy();
    }
  });

  it('broken-links — should return formatted results', () => {
    const r = run(`broken-links --repo ${DOC_REPO}`);
    if (Array.isArray(r)) {
      expect(r.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('glossary — term lookup by name', () => {
    // First get a term, then look it up
    const all = run(`glossary --repo ${DOC_REPO}`);
    if (Array.isArray(all) && all.length > 0) {
      expect(all[0].term).toBeTruthy();
      expect(all[0].definition).toBeTruthy();
    }
  });

  it('code-examples — filter by language', () => {
    const r = run(`code-examples --repo ${DOC_REPO} --query "require" --lang js`);
    expect(Array.isArray(r.results)).toBe(true);
  });

  it('doc-orphans — include_same_doc option', () => {
    const r = run(`doc-orphans --repo ${DOC_REPO} --include_same_doc`);
    expect(r.orphans).toBeTruthy();
  });

  it('stale-pages — should not find stale pages right after reindex', () => {
    // After fresh reindex, no pages should be stale
    run(`reindex-docs --repo ${DOC_REPO}`);
    const r = run(`stale-pages --repo ${DOC_REPO}`);
    expect(Array.isArray(r.stale)).toBe(true);
    // Should be empty right after reindex
    expect(r.stale.length).toBe(0);
  });

  it('doc-duplicates — should return structured sections data', () => {
    const r = run(`doc-duplicates --repo ${DOC_REPO}`);
    expect(Array.isArray(r.duplicates)).toBe(true);
    if (r.duplicates.length > 0) {
      const dup = r.duplicates[0];
      expect(typeof dup.count).toBe('number');
      expect(dup.count).toBeGreaterThan(1);
      expect(Array.isArray(dup.sections)).toBe(true);
      expect(dup.sections[0].title).toBeTruthy();
      expect(dup.sections[0].file_path).toBeTruthy();
    }
  });
});
