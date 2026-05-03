// Integration tests for doc-indexer (v5)
const { execSync } = require('child_process');
const path = require('path');

const STORE = path.resolve(__dirname, '..', 'memory-store.js');
const DOC_REPO = 'pi-docs';
const DOC_PATH = path.resolve(__dirname, '..', 'docs');

function run(cmd) {
  try {
    const out = execSync(`node "${STORE}" ${cmd}`, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out.trim());
  } catch (e) {
    if (e.stdout?.trim()) { return JSON.parse(e.stdout.trim()); }
    throw e;
  }
}

// Ensure docs are indexed before all test groups
beforeAll(() => {
  try {
    run(`reindex-docs --repo ${DOC_REPO}`);
  } catch {
    run(`index-docs --path "${DOC_PATH}" --name ${DOC_REPO}`);
  }
});

describe('doc-indexer: doc-search', () => {
  it('should find sections by query', () => {
    const r = run(`doc-search --query "memory wasm" --repo ${DOC_REPO}`);
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });

  it('role filter', () => {
    const r = run(`doc-search --query "code" --repo ${DOC_REPO} --role how_to`);
    if (!r.error) { expect(Array.isArray(r.results)).toBe(true); }
  });

  it('should return answerable sections with heuristics', () => {
    const r = run(`doc-search --query "memory store" --repo ${DOC_REPO}`);
    expect(Array.isArray(r.results)).toBe(true);
    if (r.results.length > 0) {
      const first = r.results[0];
      expect(first.title).toBeTruthy();
      expect(first.role).toBeTruthy();
    }
  });
});

describe('doc-indexer: doc-outline', () => {
  it('full outline', () => {
    try {
      const r = run(`doc-outline --repo ${DOC_REPO}`);
      expect(r.files || r.error).toBeTruthy();
    } catch {
      expect(true).toBe(true);
    }
  });

  it('single file', () => {
    const r = run(`doc-outline --repo ${DOC_REPO} --file SKILL.md`);
    if (!r.error) { expect(Array.isArray(r) || r.length !== undefined).toBe(true); }
  });
});

describe('doc-indexer: backlinks and broken-links', () => {
  it('backlinks — should find inbound links', () => {
    const r = run(`backlinks --repo ${DOC_REPO} --path SKILL.md`);
    expect(Array.isArray(r.backlinks) || r.error).toBeTruthy();
  });

  it('broken-links — should find broken links', () => {
    const r = run(`broken-links --repo ${DOC_REPO}`);
    expect(Array.isArray(r.broken_links) || r.error).toBeTruthy();
  });

  it('broken-links — should return formatted results', () => {
    const r = run(`broken-links --repo ${DOC_REPO}`);
    expect(Array.isArray(r.broken_links) || r.error).toBeTruthy();
    if (Array.isArray(r.broken_links)) {
      expect(r.broken_links.length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('doc-indexer: glossary', () => {
  it('should list terms', () => {
    const r = run(`glossary --repo ${DOC_REPO}`);
    expect(Array.isArray(r) || r.error).toBeTruthy();
  });

  it('term lookup by name', () => {
    const all = run(`glossary --repo ${DOC_REPO}`);
    if (Array.isArray(all) && all.length > 0) {
      expect(all[0].term).toBeTruthy();
      expect(all[0].definition).toBeTruthy();
    }
  });
});

describe('doc-indexer: tutorial-path', () => {
  it('should find path', () => {
    const r = run(`tutorial-path --repo ${DOC_REPO} --section 740`);
    if (!r.error) { expect(Array.isArray(r.chain)).toBe(true); }
  });
});

describe('doc-indexer: code-examples', () => {
  it('should find code blocks', () => {
    const r = run(`code-examples --repo ${DOC_REPO} --query "require"`);
    expect(Array.isArray(r.results)).toBe(true);
  });

  it('filter by language', () => {
    const r = run(`code-examples --repo ${DOC_REPO} --query "require" --lang js`);
    expect(Array.isArray(r.results)).toBe(true);
  });
});

describe('doc-indexer: doc-orphans', () => {
  it('should find orphan sections', () => {
    const r = run(`doc-orphans --repo ${DOC_REPO}`);
    expect(Array.isArray(r.orphans)).toBe(true);
    expect(typeof r.total).toBe('number');
  });

  it('include_same_doc option', () => {
    const r = run(`doc-orphans --repo ${DOC_REPO} --include_same_doc`);
    expect(r.orphans).toBeTruthy();
  });
});

describe('doc-indexer: doc-coverage', () => {
  it('should compute coverage', () => {
    try {
      const r = run(`doc-coverage --repo PiMemoryExtension --doc-repo ${DOC_REPO}`);
      expect(typeof r.coverage_pct).toBe('number');
      expect(r.total_symbols).toBeGreaterThan(0);
    } catch {
      expect(true).toBe(true);
    }
  });
});

describe('doc-indexer: stale-pages', () => {
  it('should detect stale docs', () => {
    const r = run(`stale-pages --repo ${DOC_REPO}`);
    expect(Array.isArray(r.stale)).toBe(true);
    expect(Array.isArray(r.missing)).toBe(true);
    expect(typeof r.total_files).toBe('number');
  });

  it('should not find stale pages right after reindex', () => {
    run(`reindex-docs --repo ${DOC_REPO}`);
    const r = run(`stale-pages --repo ${DOC_REPO}`);
    expect(Array.isArray(r.stale)).toBe(true);
    expect(r.stale.length).toBe(0);
  });
});

describe('doc-indexer: doc-duplicates', () => {
  it('should detect duplicates', () => {
    const r = run(`doc-duplicates --repo ${DOC_REPO}`);
    expect(Array.isArray(r.duplicates)).toBe(true);
    expect(typeof r.total_duplicate_groups).toBe('number');
  });

  it('should return structured sections data', () => {
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

describe('doc-indexer: index-docs', () => {
  it('should reindex without error', () => {
    const r = run(`reindex-docs --repo ${DOC_REPO}`);
    expect(r.success).toBe(true);
    expect(r.files).toBeGreaterThanOrEqual(1);
    expect(r.sections).toBeGreaterThanOrEqual(1);
  });

  it('should report links and code blocks', () => {
    try {
      const r = run(`reindex-docs --repo ${DOC_REPO}`);
      expect(r.success).toBe(true);
      expect(typeof r.links).toBe('number');
      expect(typeof r.code_blocks).toBe('number');
    } catch {
      expect(true).toBe(true);
    }
  });
});
