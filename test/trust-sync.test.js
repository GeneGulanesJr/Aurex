const { evaluateTrustSync, stripOperations } = require('../src/trust-sync/trust-policy');
const { collectChangedSymbols } = require('../src/trust-sync/change-detector');

const { TRUST_DELTA } = require('../constants');

describe('src/trust-sync trust policy', () => {
  it('evaluates changed and survived links without repository side effects', () => {
    const changedSet = new Set(['changedFunc']);
    const result = evaluateTrustSync(
      [
        { memory_id: '1', symbol_id: 'ns::changedFunc', trust_score: 0.8 },
        { memory_id: '2', symbol_id: 'stableFunc', trust_score: 0.5 },
        { memory_id: '3', symbol_id: 'maxedFunc', trust_score: TRUST_DELTA.MAX_SURVIVED },
      ],
      changedSet,
    );

    expect(result.adjusted).toEqual([
      {
        memory_id: '1',
        symbol_id: 'ns::changedFunc',
        old_trust: 0.8,
        new_trust: 0.5,
      },
    ]);
    expect(result.survived).toEqual([
      {
        memory_id: '2',
        symbol_id: 'stableFunc',
        old_trust: 0.5,
        new_trust: 0.55,
      },
    ]);
    expect(result.unchanged).toEqual([{ memory_id: '3', symbol_id: 'maxedFunc' }]);
    expect(result.operations).toHaveLength(2);
    expect(stripOperations(result).operations).toBeUndefined();
  });
});

describe('src/trust-sync change detector', () => {
  it('collects changed symbols from all supported git delta shapes', () => {
    const changed = collectChangedSymbols({
      added: ['addedFunc'],
      modified: [{ symbol_id: 'modifiedFunc' }],
      removed: [{ name: 'removedFunc' }],
      changed: [null, { ignored: true }],
    });

    expect([...changed].sort()).toEqual(['addedFunc', 'modifiedFunc', 'removedFunc']);
  });
});
