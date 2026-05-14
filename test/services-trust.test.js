const { syncCodeTrust } = require('../services/trust');
const { TRUST_DELTA } = require('../constants');

describe('services/trust: syncCodeTrust', () => {
  it('should require repo and changed-symbols-json', () => {
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
    const result = syncCodeTrust(deps, {});
    expect(result.error).toContain('Missing');
  });

  it('should require changed-symbols-json', () => {
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
    const result = syncCodeTrust(deps, { repo: 'my-repo' });
    expect(result.error).toContain('Missing');
  });

  it('should reject invalid JSON for changed-symbols-json', () => {
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': '{invalid' });
    expect(result.error).toContain('Invalid JSON');
  });

  it('should reject empty symbol set', () => {
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': '[]' });
    expect(result.error).toContain('No changed symbols');
  });

  it('should adjust trust for changed symbols', () => {
    const getAnchoredLinks = vi.fn(() => [
      { memory_id: '1', symbol_id: 'myFunc', trust_score: 0.7 },
      { memory_id: '2', symbol_id: 'otherFunc', trust_score: 0.9 },
    ]);
    const updateLinkTrust = vi.fn();
    const insertTrustAdjustment = vi.fn();
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })), getAnchoredLinks, updateLinkTrust, insertTrustAdjustment };
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': '["myFunc"]' });
    expect(result.adjusted.length).toBe(1);
    expect(result.adjusted[0].symbol_id).toBe('myFunc');
    expect(updateLinkTrust).toHaveBeenCalled();
  });

  it('should increment trust for unchanged symbols below MAX_SURVIVED', () => {
    const getAnchoredLinks = vi.fn(() => [
      { memory_id: '1', symbol_id: 'unchangedFunc', trust_score: 0.5 },
    ]);
    const updateLinkTrust = vi.fn();
    const insertTrustAdjustment = vi.fn();
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })), getAnchoredLinks, updateLinkTrust, insertTrustAdjustment };
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': '["someOther"]' });
    expect(result.survived.length).toBe(1);
    expect(result.unchanged.length).toBe(0);
  });

  it('should leave unchanged symbols above MAX_SURVIVED as-is', () => {
    const getAnchoredLinks = vi.fn(() => [
      { memory_id: '1', symbol_id: 'stableFunc', trust_score: TRUST_DELTA.MAX_SURVIVED },
    ]);
    const updateLinkTrust = vi.fn();
    const insertTrustAdjustment = vi.fn();
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })), getAnchoredLinks, updateLinkTrust, insertTrustAdjustment };
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': '["changedFunc"]' });
    expect(result.unchanged.length).toBe(1);
    expect(result.unchanged[0].symbol_id).toBe('stableFunc');
    expect(updateLinkTrust).not.toHaveBeenCalled();
  });

  it('should handle object-style changed-symbols-json with added/modified keys', () => {
    const getAnchoredLinks = vi.fn(() => []);
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })), getAnchoredLinks, updateLinkTrust: vi.fn(), insertTrustAdjustment: vi.fn() };
    const changedJson = JSON.stringify({ added: ['funcA'], modified: ['funcB'] });
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': changedJson });
    expect(result.total).toBe(0);
    expect(getAnchoredLinks).toHaveBeenCalledWith('my-repo');
  });

  it('should handle object-style changed-symbols with symbol_id fields', () => {
    const getAnchoredLinks = vi.fn(() => [
      { memory_id: '1', symbol_id: 'ns::funcA', trust_score: 0.8 },
    ]);
    const updateLinkTrust = vi.fn();
    const insertTrustAdjustment = vi.fn();
    const deps = { jsonErrNoExit: vi.fn((msg) => ({ error: msg })), getAnchoredLinks, updateLinkTrust, insertTrustAdjustment };
    const changedJson = JSON.stringify([{ symbol_id: 'funcA' }]);
    const result = syncCodeTrust(deps, { repo: 'my-repo', 'changed-symbols-json': changedJson });
    expect(result.adjusted.length).toBe(1);
  });
});