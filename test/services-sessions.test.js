const { sessionStart, sessionEnd } = require('../services/sessions');

describe('services/sessions', () => {
  describe('sessionStart', () => {
    it('should return error when project is missing', () => {
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const result = sessionStart({ sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit, withTransaction: (fn) => fn() }, {});
      expect(result.error).toContain('project');
    });

    it('should create session and return session info', () => {
      const sqlJson = vi.fn((query, _params) => {
        if (query.includes('INSERT INTO session_log')) {
          return [{ id: 42, started_at: '2025-01-01T00:00:00' }];
        }
        if (query.includes('COUNT(*)')) {
          return [{ cnt: 3 }];
        }
        if (query.includes('ended_at IS NULL')) {
          return [];
        }
        if (query.includes('archive')) {
          return [];
        }
        return [];
      });
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const autoRecoverInternal = vi.fn(() => null);
      const runCompact = vi.fn(() => ({ ok: true }));
      const _readTierConfig = vi.fn(() => ({ tier: 'full' }));
      const TOOL_TIERS = { full: null };
      const commands = { search: vi.fn(), save: vi.fn() };

      const result = sessionStart(
        { sqlJson, sqlRun, jsonErrNoExit, autoRecoverInternal, runCompact, _readTierConfig, TOOL_TIERS, commands, withTransaction: (fn) => fn() },
        { project: 'my-project' },
      );
      expect(result.sessionId).toBe(42);
      expect(result.sessionCount).toBe(3);
      expect(result.tool_tier).toBe('full');
    });

    it('should detect incomplete previous session', () => {
      const sqlJson = vi.fn((query, _params) => {
        if (query.includes('INSERT INTO session_log')) {
          return [{ id: 5, started_at: '2025-01-01' }];
        }
        if (query.includes('COUNT(*)')) {
          return [{ cnt: 1 }];
        }
        if (query.includes('ended_at IS NULL')) {
          return [{ id: 4 }];
        }
        if (query.includes('archive')) {
          return [];
        }
        return [];
      });
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const autoRecoverInternal = vi.fn(() => ({ status: 'recovered', observations_processed: 2 }));
      const runCompact = vi.fn(() => ({ ok: true }));
      const _readTierConfig = vi.fn(() => ({ tier: 'full' }));
      const TOOL_TIERS = { full: null };
      const commands = { search: vi.fn() };

      const result = sessionStart(
        { sqlJson, sqlRun, jsonErrNoExit, autoRecoverInternal, runCompact, _readTierConfig, TOOL_TIERS, commands, withTransaction: (fn) => fn() },
        { project: 'my-project' },
      );
      expect(result.hasIncompletePreviousSession).toBe(true);
      expect(result.incompleteSessionId).toBe(4);
      expect(autoRecoverInternal).toHaveBeenCalledWith('4');
    });
  });

  describe('sessionEnd', () => {
    it('should return error when id is missing', () => {
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const result = sessionEnd({ sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit }, {});
      expect(result.error).toContain('id');
    });

    it('should update session_log with ended_at', () => {
      const sqlJson = vi.fn();
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const trustRecovery = vi.fn(() => ({ ok: true }));
      const result = sessionEnd({ sqlJson, sqlRun, jsonErrNoExit, trustRecovery }, { id: '10', memories: '5' });
      expect(result.ok).toBe(true);
      expect(result.sessionId).toBe(10);
      expect(sqlRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE session_log'),
        expect.arrayContaining([5, 10]),
      );
    });

    it('should run trustRecovery when auto is true', () => {
      const sqlJson = vi.fn();
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const trustRecovery = vi.fn(() => ({ ok: true, memoriesRecovered: 2 }));
      const result = sessionEnd({ sqlJson, sqlRun, jsonErrNoExit, trustRecovery }, { id: '10', auto: 'true' });
      expect(trustRecovery).toHaveBeenCalledWith({ session: '10' });
      expect(result.trustRecovery).toBeDefined();
    });

    it('should not run trustRecovery when auto is not set', () => {
      const sqlJson = vi.fn();
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const trustRecovery = vi.fn();
      const result = sessionEnd({ sqlJson, sqlRun, jsonErrNoExit, trustRecovery }, { id: '10', memories: '5' });
      expect(trustRecovery).not.toHaveBeenCalled();
      expect(result.trustRecovery).toBeUndefined();
    });

    it('should run compact at session end when runCompact is provided', () => {
      const sqlJson = vi.fn();
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const trustRecovery = vi.fn(() => ({ ok: true }));
      const runCompact = vi.fn(() => ({ ok: true, pruned: 3 }));
      const result = sessionEnd(
        { sqlJson, sqlRun, jsonErrNoExit, trustRecovery, runCompact },
        { id: '10', memories: '5' },
      );
      expect(runCompact).toHaveBeenCalled();
      expect(result.compacted).toEqual({ ok: true, pruned: 3 });
    });

    it('should not fail when runCompact is not provided', () => {
      const sqlJson = vi.fn();
      const sqlRun = vi.fn();
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const trustRecovery = vi.fn(() => ({ ok: true }));
      const result = sessionEnd(
        { sqlJson, sqlRun, jsonErrNoExit, trustRecovery },
        { id: '10', memories: '5' },
      );
      expect(result.ok).toBe(true);
      expect(result.compacted).toBeUndefined();
    });
  });
});
