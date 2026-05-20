describe('gateway dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should return error for unknown command after init', async () => {
    vi.doMock('../../db', () => ({
      ensureDb: vi.fn(),
      getDb: vi.fn(() => ({})),
      sqlJson: vi.fn(() => []),
      sqlRun: vi.fn(),
      sqlRaw: vi.fn(),
      jsonErrNoExit: vi.fn((msg) => ({ error: msg })),
      DB_PATH: ':memory:',
      getEngine: vi.fn(() => 'sqlite'),
    }));

    vi.doMock('../../data-access/observations', () => ({ softDeleteObservation: vi.fn() }));
    vi.doMock('../../platform/storage/repositories', () => ({ createRepositories: vi.fn(() => ({})) }));
    vi.doMock('../../config', () => ({ getConfig: vi.fn(() => ({ tier_config_path: '/nonexistent' })) }));
    vi.doMock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no tier config'); }) }));

    const { dispatch } = require('../src/cli/gateway');
    const result = await dispatch('nonexistent-command', {});
    expect(result).toBeDefined();
    expect(result.error).toContain('Unknown command');
  });
});
